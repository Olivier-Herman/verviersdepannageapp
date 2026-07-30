// src/app/api/fourriere/domaine/ventes-register/route.ts
//
// Registre « Vente d'épaves » (reflet des mails de Rosemarie, toutes lignes).
// GET  ?from&to                         → registre calculé (trace-based).
// POST { action, id, value }            → éditions par ligne de trace :
//        set_date_out  (value=YYYY-MM-DD|null)  Date OUT éditable
//        set_sortie    (value=YYYY-MM-DD|null)  date de sortie réelle → si la ligne
//                       est rapprochée, passe la fiche en « à facturer » (cachet
//                       Domaine). Aucun impact sur les jours facturés.
//        toggle_prepare (value=bool)            « Préparation OK »
// Accès : admin / superadmin / module fourriere. Olivier 2026-07-30.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { computeVenteEpavesRegister } from '@/lib/domaine/vente-epaves-register'

export const dynamic     = 'force-dynamic'
export const fetchCache  = 'force-no-store'
export const maxDuration = 30

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const from = (searchParams.get('from') || '').slice(0, 10)
  const to   = (searchParams.get('to')   || '').slice(0, 10)
  if (!from || !to) return NextResponse.json({ error: 'Période (from/to) requise' }, { status: 400 })
  const sb = createAdminClient()
  const result = await computeVenteEpavesRegister(sb, from, to)
  return NextResponse.json({ ok: true, ...result })
}

// Ligne rapprochée + sortie réelle → fiche « à facturer » (cachet Domaine).
async function toInvoiceIfMatched(sb: any, r: any, sortie: string, userId: string | null): Promise<boolean> {
  if (!sortie || !r.matched_mission_id) return false
  const { data: m } = await sb.from('incoming_missions')
    .select('id, status, completed_at').eq('id', r.matched_mission_id).maybeSingle()
  if (!m || !['parked', 'new', 'dispatching', 'assigned', 'accepted', 'in_progress', 'delivering'].includes(m.status)) return false
  const now = new Date().toISOString()
  await sb.from('incoming_missions').update({ status: 'to_invoice', completed_at: m.completed_at || now, updated_at: now }).eq('id', m.id)
  await sb.from('mission_logs').insert({
    mission_id: m.id, actor_id: userId, action: 'domaine_sortie',
    notes: `Sortie réelle Domaine ${sortie}${r.firm ? ` (vendu à ${r.firm})` : ''} → à facturer`,
    metadata: { source: 'vente_epaves', sortie, domaine_ref: r.numero },
  }).then(() => {}, () => {})
  return true
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const user = session!.user as any
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const sb = createAdminClient()

  // Sortie réelle au niveau de la VENTE : propage à toutes les lignes de la vente
  // (les épaves d'une même soumission partent ensemble). Éditable par ligne ensuite.
  if (action === 'set_sortie_vente') {
    const venteDate = String(body.venteDate || '').slice(0, 10)
    const value = body.value ? String(body.value).slice(0, 10) : null
    if (!venteDate) return NextResponse.json({ error: 'venteDate requis' }, { status: 400 })
    const { data: rows } = await sb.from('domaine_ventes_epaves')
      .select('id, matched_mission_id, numero, firm').eq('vente_date', venteDate)
    await sb.from('domaine_ventes_epaves').update({ sortie_reelle_date: value }).eq('vente_date', venteDate)
    let facturable = 0
    if (value) for (const r of (rows || [])) { if (await toInvoiceIfMatched(sb, r, value, user.id || null)) facturable++ }
    return NextResponse.json({ ok: true, facturable, lines: (rows || []).length })
  }

  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const { data: row } = await sb.from('domaine_ventes_epaves')
    .select('id, matched_mission_id, sortie_reelle_date, numero, firm').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Ligne introuvable' }, { status: 404 })

  if (action === 'set_date_out') {
    await sb.from('domaine_ventes_epaves').update({ date_out: body.value ? String(body.value).slice(0, 10) : null }).eq('id', id)
    return NextResponse.json({ ok: true })
  }
  if (action === 'toggle_prepare') {
    await sb.from('domaine_ventes_epaves').update({ prepare_at: body.value ? new Date().toISOString() : null }).eq('id', id)
    return NextResponse.json({ ok: true })
  }
  if (action === 'set_sortie') {
    const value = body.value ? String(body.value).slice(0, 10) : null
    await sb.from('domaine_ventes_epaves').update({ sortie_reelle_date: value }).eq('id', id)
    const facturable = value ? await toInvoiceIfMatched(sb, row, value, user.id || null) : false
    return NextResponse.json({ ok: true, facturable })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
