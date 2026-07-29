// src/app/api/facturation/verify-invoices/route.ts
//
// POST /api/facturation/verify-invoices   { mission_ids?: string[] }
//
// « Vérification facturation Odoo » : parcourt les fiches en attente de
// facturation (status=to_invoice) qui ont une facture LIÉE dans Odoo
// (invoice_odoo_id direct, ou odoo_quote_id → facture du devis), vérifie l'état
// de la facture côté Odoo et :
//   - POSTÉE (numéro émis)  → complète la fiche (status=completed + numéro +
//     sortie parc + log), exactement comme « Facturation OK ».
//   - encore BROUILLON      → laissée, signalée « à confirmer dans Odoo ».
//   - aucune facture liée   → ignorée.
//
// Sert au lot (après avoir posté les brouillons dans Odoo) ET au quotidien
// (réconcilier ce qui a été facturé). Olivier 2026-07-26.

import { NextResponse }        from 'next/server'
import { getServerSession }    from 'next-auth'
import { authOptions }         from '@/lib/auth'
import { createAdminClient }   from '@/lib/supabase'
import { odooRpc }             from '@/lib/odoo'
import { releaseParcAndShift } from '@/lib/parc/release'

export const dynamic     = 'force-dynamic'
// force-no-store au niveau du SEGMENT : la lecture des fiches to_invoice a une
// URL PostgREST identique à chaque run → Next Data Cache la figeait sur un vieux
// snapshot (fiches déjà completed vues to_invoice, nouvelles fiches invisibles),
// même avec le no-store du client admin. Ce directive force TOUS les fetch de la
// route à ne jamais cacher. Olivier 2026-07-29.
export const fetchCache  = 'force-no-store'
export const maxDuration = 60

const ODOO_URL = process.env.ODOO_URL || ''
const invoiceUrl = (id: number) => `${ODOO_URL}/web#id=${id}&model=account.move&view_type=form`

export async function POST(req: Request) {
  // Appel serveur-à-serveur (cron de réconciliation) via secret interne, sinon session.
  const isInternal = req.headers.get('x-internal-secret') === process.env.NEXTAUTH_SECRET && !!process.env.NEXTAUTH_SECRET
  let user: any = {}
  if (!isInternal) {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    user = session.user as any
    const role: string = user.role || ''
    const modules: string[] = user.modules || []
    if (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const body = await req.json().catch(() => ({}))
  const onlyIds: string[] | null = Array.isArray(body?.mission_ids) && body.mission_ids.length
    ? body.mission_ids.filter((x: any) => typeof x === 'string')
    : null

  const sb = createAdminClient()

  // Fiches à facturer ayant une facture liée (directe ou via devis).
  let q = sb.from('incoming_missions')
    .select('id, external_id, vehicle_plate, status, invoice_odoo_id, odoo_quote_id')
    .eq('status', 'to_invoice')
    .or('invoice_odoo_id.not.is.null,odoo_quote_id.not.is.null')
  if (onlyIds) q = q.in('id', onlyIds)
  // Cache-buster : la lecture des to_invoice a une URL PostgREST fixe → un cache
  // de GET (Next/CDN) la figeait sur un vieux snapshot. Filtre TOUJOURS vrai à
  // valeur variable → URL unique à chaque run, jamais servie depuis un cache.
  const bust = new Date(Date.now() % 1_000_000).toISOString()   // ~1970 → < tout created_at
  q = q.gte('created_at', bust)
  const { data: missions, error } = await q.limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!missions || missions.length === 0) {
    return NextResponse.json({ ok: true, completed: [], draft: [], none: [], summary: { completed: 0, draft: 0, none: 0 } })
  }

  // 1) Résout les ids account.move de chaque fiche (direct + via devis).
  const quoteIds = missions.filter(m => m.odoo_quote_id).map(m => m.odoo_quote_id as number)
  const quoteInvoiceMap = new Map<number, number[]>()   // saleOrderId → [moveId]
  if (quoteIds.length) {
    try {
      const orders = await odooRpc<any[]>('sale.order', 'read', [quoteIds], { fields: ['id', 'invoice_ids'] })
      for (const o of (orders || [])) quoteInvoiceMap.set(o.id, (o.invoice_ids || []).map(Number))
    } catch (e: any) { console.error('[verify-invoices] read sale.order KO:', e.message) }
  }

  const allMoveIds = new Set<number>()
  const missionMoveIds = new Map<string, number[]>()
  for (const m of missions) {
    const ids: number[] = []
    if (m.invoice_odoo_id) ids.push(Number(m.invoice_odoo_id))
    if (m.odoo_quote_id) ids.push(...(quoteInvoiceMap.get(m.odoo_quote_id as number) || []))
    const uniq = [...new Set(ids)]
    missionMoveIds.set(m.id, uniq)
    uniq.forEach(id => allMoveIds.add(id))
  }

  // 2) Lit l'état de toutes les factures d'un coup.
  const moveById = new Map<number, { name: string; state: string; move_type: string }>()
  if (allMoveIds.size) {
    try {
      const moves = await odooRpc<any[]>('account.move', 'search_read',
        [[['id', 'in', [...allMoveIds]]]], { fields: ['id', 'name', 'state', 'move_type'] })
      for (const mv of (moves || [])) moveById.set(mv.id, { name: mv.name, state: mv.state, move_type: mv.move_type })
    } catch (e: any) { console.error('[verify-invoices] read account.move KO:', e.message) }
  }

  // 3) Classe chaque fiche + complète les postées.
  const completed: any[] = []
  const draft: any[] = []
  const none: any[] = []
  const now = new Date().toISOString()

  for (const m of missions) {
    const moves = (missionMoveIds.get(m.id) || [])
      .map(id => ({ id, ...(moveById.get(id) || { name: '', state: 'missing', move_type: '' }) }))
      .filter(mv => mv.move_type === 'out_invoice' || mv.state === 'missing' || !mv.move_type)

    const posted = moves.find(mv => mv.state === 'posted' && mv.name && mv.name !== '/')
    if (posted) {
      // Complète la fiche (idem « Facturation OK »).
      const { error: updErr } = await sb.from('incoming_missions').update({
        status:          'completed',
        invoice_method:  'auto',
        invoice_number:  posted.name,
        invoice_odoo_id: posted.id,
        invoice_url:     invoiceUrl(posted.id),
        invoiced_at:     now,
        invoiced_by:     user.id || null,
      }).eq('id', m.id)
      if (updErr) { none.push({ id: m.id, ref: m.external_id, plate: m.vehicle_plate, reason: updErr.message }); continue }
      try { await releaseParcAndShift(sb, m.id) } catch (e: any) { console.error('[verify-invoices] release parc KO:', e.message) }
      await sb.from('mission_logs').insert({
        mission_id: m.id, actor_id: user.id || null, action: 'invoiced',
        notes: `Facturée n° ${posted.name} (vérification Odoo groupée)`,
      }).then(() => {}, () => {})
      completed.push({ id: m.id, ref: m.external_id, plate: m.vehicle_plate, number: posted.name })
    } else if (moves.some(mv => mv.state === 'draft')) {
      draft.push({ id: m.id, ref: m.external_id, plate: m.vehicle_plate })
    } else {
      none.push({ id: m.id, ref: m.external_id, plate: m.vehicle_plate })
    }
  }

  return NextResponse.json({
    ok: true, completed, draft, none,
    summary: { completed: completed.length, draft: draft.length, none: none.length },
  })
}
