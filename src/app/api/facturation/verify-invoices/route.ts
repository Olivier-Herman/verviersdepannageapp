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
    .select('id, external_id, vehicle_plate, status, invoice_odoo_id, odoo_quote_id, invoice_method')
    .eq('status', 'to_invoice')
    .or('invoice_odoo_id.not.is.null,odoo_quote_id.not.is.null')
  if (onlyIds) q = q.in('id', onlyIds)
  const { data: missions, error } = await q.limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!missions || missions.length === 0) {
    return NextResponse.json({ ok: true, completed: [], draft: [], none: [], summary: { completed: 0, draft: 0, none: 0 } })
  }

  // 1) Résout les ids account.move de chaque fiche (direct + via devis).
  const quoteIds = missions.filter(m => m.odoo_quote_id).map(m => m.odoo_quote_id as number)
  const quoteInvoiceMap = new Map<number, number[]>()   // saleOrderId → [moveId]
  const quoteDoublon = new Map<number, string>()       // bon de commande annulé par « C'est un doublon » → facture existante
  if (quoteIds.length) {
    try {
      const orders = await odooRpc<any[]>('sale.order', 'read', [quoteIds], { fields: ['id', 'invoice_ids', 'state', 'x_doublon_de'] })
      for (const o of (orders || [])) { quoteInvoiceMap.set(o.id, (o.invoice_ids || []).map(Number)); if (o.state === 'cancel' && o.x_doublon_de) quoteDoublon.set(o.id, o.x_doublon_de) }
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
  const moveById = new Map<number, { name: string; state: string; move_type: string; x_doublon_de?: string | false }>()
  if (allMoveIds.size) {
    try {
      const moves = await odooRpc<any[]>('account.move', 'search_read',
        [[['id', 'in', [...allMoveIds]]]], { fields: ['id', 'name', 'state', 'move_type', 'x_doublon_de'] })
      for (const mv of (moves || [])) moveById.set(mv.id, { name: mv.name, state: mv.state, move_type: mv.move_type, x_doublon_de: mv.x_doublon_de })
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
    if (posted && (m as any).invoice_method === 'dossier') {
      // D14 : facture créée depuis le dossier — on ramène le numéro ; la fiche ne
      // passe « terminée » (et la place n'est libérée) que si tout le dossier est couvert.
      await sb.from('incoming_missions').update({ invoice_number: posted.name, invoice_odoo_id: posted.id, invoice_url: invoiceUrl(posted.id), invoiced_at: now, invoiced_by: user.id || null }).eq('id', m.id).is('invoice_number', null)
      await sb.from('mission_billed_items').update({ invoice_number: posted.name }).eq('invoice_odoo_id', posted.id).is('invoice_number', null)
      let allCovered = false
      try { const { buildDossier } = await import('@/lib/dossier/build'); const dd = await buildDossier(m.id, { light: true }); allCovered = !!dd && !dd.state.open && dd.legs.filter(l => l.kind !== 'out').every(l => (l.billed_refs.length && l.billed_htva >= l.amount_htva - 0.01) || !!l.nothing_to_bill || (l.amount_htva === 0 && !l.amount_unknown)) } catch {}
      if (!allCovered) { draft.push({ id: m.id, ref: m.external_id, plate: m.vehicle_plate, note: `n° ${posted.name} repris, dossier pas encore couvert en totalité` } as any); continue }
      const { error: updErr } = await sb.from('incoming_missions').update({ status: 'completed', updated_at: now }).eq('id', m.id)
      if (updErr) { none.push({ id: m.id, ref: m.external_id, plate: m.vehicle_plate, reason: updErr.message }); continue }
      try { await releaseParcAndShift(sb, m.id) } catch (e: any) { console.error('[verify-invoices] release parc KO:', e.message) }
      await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: user.id || null, action: 'invoiced', notes: `Facturée n° ${posted.name} (dossier entièrement couvert — vérification Odoo groupée)` }).then(() => {}, () => {})
      completed.push({ id: m.id, ref: m.external_id, plate: m.vehicle_plate, number: posted.name })
    } else if (posted) {
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
    } else if ((m.odoo_quote_id && quoteDoublon.get(m.odoo_quote_id as number)) || moves.find(mv => mv.state === 'cancel' && mv.x_doublon_de)) {
      // « C'est un doublon » dans l'ERP (Olivier 07/10/2026) : la facture existe déjà pour ce dossier.
      const existingName = (m.odoo_quote_id && quoteDoublon.get(m.odoo_quote_id as number)) || String(moves.find(mv => mv.state === 'cancel' && mv.x_doublon_de)?.x_doublon_de)
      const r = await settleDuplicate(sb, m, existingName, user.id || null, now)
      if (r.ok) completed.push({ id: m.id, ref: m.external_id, plate: m.vehicle_plate, number: existingName, ...(r.duplicateOf ? { note: `doublon de la fiche #${r.duplicateOf}` } : {}) } as any)
      else none.push({ id: m.id, ref: m.external_id, plate: m.vehicle_plate, reason: r.error })
    } else if (moves.some(mv => mv.state === 'draft')) {
      draft.push({ id: m.id, ref: m.external_id, plate: m.vehicle_plate })
    } else {
      none.push({ id: m.id, ref: m.external_id, plate: m.vehicle_plate })
    }
  }

  // ── 2e passe (Vue dossier, Olivier 07/09/2026) : fiches facturées depuis le
  // dossier mais PAS en 'to_invoice' — gardiennages (statut 'gardiennage') et
  // remorquages encore au parc. On ramène seulement le NUMÉRO posté, sans
  // toucher au statut ni libérer la place de parc (le véhicule y est encore).
  try {
    const { data: pending } = await sb.from('incoming_missions')
      .select('id, invoice_odoo_id')
      .neq('status', 'to_invoice').not('invoice_odoo_id', 'is', null).is('invoice_number', null)
      .limit(200)
    const pendIds = Array.from(new Set((pending || []).map((m: any) => Number(m.invoice_odoo_id)).filter(Boolean)))
    if (pendIds.length) {
      const moves = await odooRpc<any[]>('account.move', 'search_read',
        [[['id', 'in', pendIds], ['state', '=', 'posted']]], { fields: ['id', 'name'], limit: pendIds.length })
      for (const mv of moves || []) {
        if (!mv?.name || mv.name === '/') continue
        await sb.from('incoming_missions').update({ invoice_number: mv.name, invoiced_at: new Date().toISOString() })
          .eq('invoice_odoo_id', mv.id).is('invoice_number', null)
        await sb.from('mission_billed_items').update({ invoice_number: mv.name })
          .eq('invoice_odoo_id', mv.id).is('invoice_number', null)
      }
    }
    // Les postes facturés depuis un dossier dont la fiche a déjà son numéro.
    const { data: itemsSansNum } = await sb.from('mission_billed_items')
      .select('invoice_odoo_id').not('invoice_odoo_id', 'is', null).is('invoice_number', null).limit(200)
    const itemIds = Array.from(new Set((itemsSansNum || []).map((i: any) => Number(i.invoice_odoo_id)).filter(id => id && !pendIds.includes(id))))
    if (itemIds.length) {
      const moves = await odooRpc<any[]>('account.move', 'search_read',
        [[['id', 'in', itemIds], ['state', '=', 'posted']]], { fields: ['id', 'name'], limit: itemIds.length })
      for (const mv of moves || []) {
        if (!mv?.name || mv.name === '/') continue
        await sb.from('mission_billed_items').update({ invoice_number: mv.name }).eq('invoice_odoo_id', mv.id).is('invoice_number', null)
      }
    }
  } catch (e: any) { console.error('[verify-invoices] 2e passe dossier KO:', e?.message) }

  return NextResponse.json({
    ok: true, completed, draft, none,
    summary: { completed: completed.length, draft: draft.length, none: none.length },
  })
}


/**
 * Fiche dont le bon de commande (ou la facture brouillon) a été annulé dans l'ERP par « C'est un
 * doublon » : la facture existante couvre la mission (Olivier 07/10/2026).
 *  - elle appartient à une AUTRE fiche → cette fiche-ci est une 2e fiche de la même mission :
 *    marquée « doublon de » l'autre, sortie de la facturation (statut terminé), jamais supprimée ;
 *  - sinon → cette fiche est rattachée à la facture existante, comme une facturation normale.
 */
async function settleDuplicate(sb: any, m: any, existingName: string, actorId: string | null, now: string): Promise<{ ok: true; duplicateOf?: number } | { ok: false; error: string }> {
  const [inv] = await odooRpc<any[]>('account.move', 'search_read', [[['name', '=', existingName], ['move_type', '=', 'out_invoice'], ['state', '=', 'posted']]], { fields: ['id', 'name'], limit: 1 }).catch(() => [])
  if (!inv) return { ok: false, error: `Facture existante ${existingName} introuvable dans l'ERP` }
  const { data: owners } = await sb.from('incoming_missions').select('id, mission_number').or(`invoice_odoo_id.eq.${inv.id},invoice_number.eq.${inv.name}`).neq('id', m.id).limit(1)
  const owner = owners?.[0]
  if (owner) {
    const { error } = await sb.from('incoming_missions').update({ status: 'completed', duplicate_of_mission_id: owner.id, updated_at: now }).eq('id', m.id)
    if (error) return { ok: false, error: error.message }
    const note = `Doublon de la fiche #${owner.mission_number} (facturée sur ${inv.name}) : bon de commande annulé dans l'ERP par « C'est un doublon ». Fiche sortie de la facturation, pointages et photos conservés.`
    await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: actorId, action: 'duplicate_of', notes: note, metadata: { duplicate_of: owner.id, invoice: inv.name } }).then(() => {}, () => {})
    await sb.from('mission_remarks').insert({ mission_id: m.id, text: `⚠️ ${note}` }).then(() => {}, () => {})
    return { ok: true, duplicateOf: owner.mission_number }
  }
  const { error } = await sb.from('incoming_missions').update({ status: 'completed', invoice_method: 'auto', invoice_number: inv.name, invoice_odoo_id: inv.id, invoice_url: invoiceUrl(inv.id), invoiced_at: now, invoiced_by: actorId, updated_at: now }).eq('id', m.id)
  if (error) return { ok: false, error: error.message }
  try { await releaseParcAndShift(sb, m.id) } catch (e: any) { console.error('[verify-invoices] release parc KO:', e.message) }
  await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: actorId, action: 'invoiced', notes: `Rattachée à la facture existante ${inv.name} (doublon annulé dans l'ERP par « C'est un doublon »)` }).then(() => {}, () => {})
  return { ok: true }
}
