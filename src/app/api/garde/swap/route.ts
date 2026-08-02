// src/app/api/garde/swap/route.ts
//
// Remplacement de garde entre collègues.
// GET                         → mes demandes reçues + envoyées + collègues
// POST request {date,scope,target_id,note}  → demande à un collègue (notif)
// POST decide  {id,decision,pin}            → le collègue valide au PIN → crée une
//                                             exception journalière dans le planning
// POST cancel  {id}                         → le demandeur annule sa demande

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendNotification }  from '@/lib/notifications/send'
import bcrypt                from 'bcryptjs'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

const fmt = (d: string) => { const [y, m, j] = (d || '').split('-'); return j ? `${j}/${m}` : d }

export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: incoming } = await sb.from('garde_swap_requests').select('*').eq('target_id', u.id).eq('status', 'pending').order('date')
  const { data: outgoing } = await sb.from('garde_swap_requests').select('*').eq('requester_id', u.id).order('created_at', { ascending: false }).limit(30)
  const { data: colleagues } = await sb.from('users').select('id, name').eq('active', true).or('role.eq.driver,roles.ov.{driver,chauffeur}').neq('id', u.id).order('name')
  return NextResponse.json({ incoming: incoming || [], outgoing: outgoing || [], colleagues: colleagues || [] })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  if (action === 'request') {
    const date = String(body.date || ''), scope = String(body.scope || ''), targetId = String(body.target_id || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !['day', 'night'].includes(scope) || !targetId) return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
    if (targetId === u.id) return NextResponse.json({ error: 'Choisis un autre collègue' }, { status: 400 })
    const { data: tgt } = await sb.from('users').select('name').eq('id', targetId).maybeSingle()
    const { data: ins } = await sb.from('garde_swap_requests').insert({
      date, scope, requester_id: u.id, requester_name: u.name || null, target_id: targetId, target_name: tgt?.name || null,
      note: String(body.note || '').trim() || null,
    }).select('id').single()
    try {
      await sendNotification(targetId, 'garde_swap_requested', {
        title: 'Remplacement de garde demandé',
        body: `${u.name || 'Un collègue'} te demande de le remplacer le ${fmt(date)} (${scope === 'night' ? '1er départ nuit' : 'garde du jour'}).`,
        action_url: '/ma-paie',
      })
    } catch { /* noop */ }
    return NextResponse.json({ ok: true, id: ins?.id })
  }

  if (action === 'cancel') {
    const id = String(body.id || '')
    await sb.from('garde_swap_requests').update({ status: 'cancelled' }).eq('id', id).eq('requester_id', u.id).eq('status', 'pending')
    return NextResponse.json({ ok: true })
  }

  if (action === 'decide') {
    const id = String(body.id || ''), decision = String(body.decision || ''), pin = String(body.pin || '')
    if (!id || !['approve', 'refuse'].includes(decision)) return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
    const { data: r } = await sb.from('garde_swap_requests').select('*').eq('id', id).maybeSingle()
    if (!r || r.target_id !== u.id) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 })
    if (r.status !== 'pending') return NextResponse.json({ error: 'Demande déjà traitée' }, { status: 400 })

    const { data: me } = await sb.from('users').select('name, verify_pin_hash').eq('id', u.id).maybeSingle()

    if (decision === 'approve') {
      // PIN requis pour VALIDER (crée le changement au planning).
      if (!me?.verify_pin_hash) return NextResponse.json({ error: 'Aucun PIN configuré (Administration → PIN).' }, { status: 400 })
      if (!(await bcrypt.compare(pin, me.verify_pin_hash))) return NextResponse.json({ error: 'PIN incorrect' }, { status: 403 })
      // Écrit l'exception journalière dans la config de garde.
      const { data: cfgRow } = await sb.from('app_settings').select('value').eq('key', 'garde_config').maybeSingle()
      let cfg: any = {}
      try { cfg = cfgRow?.value ? (typeof cfgRow.value === 'string' ? JSON.parse(cfgRow.value) : cfgRow.value) : {} } catch { cfg = {} }
      cfg.exceptions = Array.isArray(cfg.exceptions) ? cfg.exceptions : []
      // Retire une éventuelle exception existante du même scope/date (on écrase).
      cfg.exceptions = cfg.exceptions.filter((e: any) => !(e.scope === r.scope && e.date === r.date))
      cfg.exceptions.push({ scope: r.scope, date: r.date, user_id: r.target_id, note: `Remplacement ${r.requester_name || ''} → ${me.name || ''}`.trim() })
      await sb.from('app_settings').upsert({ key: 'garde_config', value: JSON.stringify(cfg) }, { onConflict: 'key' })
    }
    await sb.from('garde_swap_requests').update({ status: decision === 'approve' ? 'approved' : 'refused', decided_at: new Date().toISOString() }).eq('id', id)

    try {
      await sendNotification(r.requester_id, 'garde_swap_decided', {
        title: decision === 'approve' ? 'Remplacement accepté ✅' : 'Remplacement refusé',
        body: `${me?.name || 'Ton collègue'} a ${decision === 'approve' ? 'accepté' : 'refusé'} de te remplacer le ${fmt(r.date)}.`,
        action_url: '/ma-paie',
      })
    } catch { /* noop */ }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
