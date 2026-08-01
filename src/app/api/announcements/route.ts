// src/app/api/announcements/route.ts
//
// Module Annonces (nouveautés de l'app). Multi-annonces + audience + programmation.
// GET                       → annonce active la plus récente non lue & ciblée (modal /ma-paie)
// GET ?manage=1             → (superadmin) toutes les annonces + compteur de lecture
// GET ?stats=<id>           → (superadmin) détail « qui a lu » d'une annonce
// GET ?workers=1            → (superadmin) travailleurs liés (pour la sélection d'audience)
// POST {action:'seen', id}       → marque l'annonce lue par le user courant
// POST {action:'create'|'save', ...} → (superadmin) créer / éditer (+ audience, scheduled_at)
// POST {action:'toggle'|'delete', id} → (superadmin)
// POST {action:'broadcast'|'test', id} → (superadmin) envoie in-app + push natif/web maintenant

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { broadcastAnnouncement, linkedWorkerIds } from '@/lib/announcements/broadcast'

export const dynamic     = 'force-dynamic'
export const fetchCache  = 'force-no-store'

const slug = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'annonce'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const sp = req.nextUrl.searchParams

  // ── Liste de gestion (superadmin) ─────────────────────────────────────
  if (sp.get('manage') === '1') {
    if (u.role !== 'superadmin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: anns } = await sb.from('announcements').select('*').order('updated_at', { ascending: false })
    const { data: reads } = await sb.from('announcement_reads').select('announcement_id')
    const readCount = new Map<string, number>()
    for (const r of (reads || [])) readCount.set(r.announcement_id, (readCount.get(r.announcement_id) || 0) + 1)
    const total = (await linkedWorkerIds(sb)).length
    return NextResponse.json({ announcements: (anns || []).map(a => ({ ...a, read: readCount.get(a.id) || 0 })), total })
  }

  // ── Travailleurs liés (pour la sélection d'audience) ──────────────────
  if (sp.get('workers') === '1') {
    if (u.role !== 'superadmin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: pers } = await sb.from('personnel').select('name, kind, user_id').not('user_id', 'is', null).eq('active', true).order('kind').order('name')
    // dédoublonne par user_id (un user peut avoir plusieurs fiches)
    const seen = new Set<string>()
    const workers = (pers || []).filter((p: any) => { if (seen.has(p.user_id)) return false; seen.add(p.user_id); return true })
      .map((p: any) => ({ user_id: p.user_id, name: p.name, kind: p.kind }))
    return NextResponse.json({ workers })
  }

  // ── Détail « qui a lu » d'une annonce (superadmin) ────────────────────
  const statsId = sp.get('stats')
  if (statsId) {
    if (u.role !== 'superadmin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: ann } = await sb.from('announcements').select('audience, target_user_ids').eq('id', statsId).maybeSingle()
    const { data: pers } = await sb.from('personnel').select('name, user_id').not('user_id', 'is', null).eq('active', true)
    const custom = ann?.audience === 'custom' ? new Set((ann.target_user_ids || []) as string[]) : null
    const scope = (pers || []).filter((p: any) => !custom || custom.has(p.user_id))
    const { data: reads } = await sb.from('announcement_reads').select('user_id, seen_at').eq('announcement_id', statsId)
    const readMap = new Map((reads || []).map((r: any) => [r.user_id, r.seen_at]))
    const targets = scope.map((p: any) => ({ name: p.name, seen_at: readMap.get(p.user_id) || null }))
      .sort((a, b) => (a.seen_at ? 0 : 1) - (b.seen_at ? 0 : 1) || a.name.localeCompare(b.name))
    return NextResponse.json({ targets })
  }

  // ── Annonce active non lue & ciblée sur moi (pour le modal) ───────────
  const nowIso = new Date().toISOString()
  const { data: anns } = await sb.from('announcements').select('*').eq('active', true).order('updated_at', { ascending: false })
  if (!anns?.length) return NextResponse.json({ announcement: null })
  const { data: mine } = await sb.from('announcement_reads').select('announcement_id').eq('user_id', u.id)
  const seen = new Set((mine || []).map((r: any) => r.announcement_id))
  const ann = anns.find(a =>
    !seen.has(a.id) &&
    (!a.scheduled_at || a.scheduled_at <= nowIso) &&                                  // pas avant l'heure programmée
    (a.audience !== 'custom' || (a.target_user_ids || []).includes(u.id)))            // ciblage
  if (!ann) return NextResponse.json({ announcement: null })
  return NextResponse.json({ announcement: { id: ann.id, key: ann.key, emoji: ann.emoji, title: ann.title, body: ann.body, action_url: ann.action_url, cta_label: ann.cta_label } })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  // ── Marquer lu (tout user) ────────────────────────────────────────────
  if (action === 'seen') {
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id manquant' }, { status: 400 })
    await sb.from('announcement_reads').upsert({ announcement_id: id, user_id: u.id, seen_at: new Date().toISOString() }, { onConflict: 'announcement_id,user_id' })
    return NextResponse.json({ ok: true })
  }

  // ── Actions superadmin ────────────────────────────────────────────────
  if (u.role !== 'superadmin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fields = () => {
    const audience = body.audience === 'custom' ? 'custom' : 'all'
    const ids = Array.isArray(body.target_user_ids) ? body.target_user_ids.filter((x: any) => typeof x === 'string') : []
    // Programmation : datetime ISO (ou null). Si dans le futur → inactive jusqu'au cron.
    const scheduledRaw = body.scheduled_at ? new Date(body.scheduled_at) : null
    const scheduled = scheduledRaw && !isNaN(scheduledRaw.getTime()) ? scheduledRaw.toISOString() : null
    const future = scheduled ? scheduled > new Date().toISOString() : false
    return {
      emoji:      String(body.emoji || '✨').slice(0, 8),
      title:      String(body.title || '').trim(),
      body:       String(body.body || '').trim(),
      action_url: String(body.action_url || '/ma-paie').trim() || '/ma-paie',
      cta_label:  String(body.cta_label || 'Découvrir').trim() || 'Découvrir',
      audience,
      target_user_ids: audience === 'custom' ? ids : [],
      scheduled_at: scheduled,
      // Programmée dans le futur → on masque le modal jusqu'à la diffusion.
      active:     future ? false : (body.active !== false),
    }
  }

  if (action === 'create') {
    const f = fields()
    if (!f.title || !f.body) return NextResponse.json({ error: 'Titre et message requis' }, { status: 400 })
    const key = `${slug(f.title)}-${Date.now().toString(36)}`
    const { data, error } = await sb.from('announcements').insert({ key, ...f, created_by: u.id }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: data.id })
  }

  if (action === 'save') {
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id manquant' }, { status: 400 })
    const f = fields()
    if (!f.title || !f.body) return NextResponse.json({ error: 'Titre et message requis' }, { status: 400 })
    const { error } = await sb.from('announcements').update({ ...f, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'toggle') {
    const id = String(body.id || '')
    await sb.from('announcements').update({ active: body.active !== false, updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete') {
    const id = String(body.id || '')
    await sb.from('announcements').delete().eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'broadcast' || action === 'test') {
    const id = String(body.id || '')
    const { data: ann } = await sb.from('announcements').select('*').eq('id', id).maybeSingle()
    if (!ann) return NextResponse.json({ error: 'Annonce introuvable' }, { status: 404 })

    if (action === 'test') {
      const { sent, failed } = await broadcastAnnouncement(sb, { ...ann, audience: 'custom', target_user_ids: [u.id] })
      return NextResponse.json({ ok: true, mode: 'test', targeted: 1, sent, failed })
    }
    // Diffusion immédiate : active + horodate → le cron ne repassera pas dessus.
    const res = await broadcastAnnouncement(sb, ann)
    await sb.from('announcements').update({ broadcast_at: new Date().toISOString(), active: true, scheduled_at: null }).eq('id', id)
    return NextResponse.json({ ok: true, mode: 'broadcast', ...res })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
