// src/app/api/stats/driver-revenue/route.ts
//
// Endpoint « Chiffre d'affaires par chauffeur » (HTVA).
//
// Pour chaque mission de la periode (attribuee a un chauffeur via assigned_to) :
//   - Si une FACTURE ODOO postee existe  → montant = amount_untaxed (HTVA) de la
//     facture, net des notes de credit (out_refund). C'est le montant qui fait foi.
//   - Sinon → estimation HTVA a partir des champs fiche :
//       special_tarif_htva (deja HTVA) > amount_to_collect/1.21 > payment_amount/1.21
//
// Les AVANCES DE FONDS (table fund_advances) ne sont PAS des missions → exclues
// de fait (on n'agrege que incoming_missions).
//
// Filtres (query string) : period / dateFrom / dateTo / source / chauffeur
// (memes semantiques que /api/stats/dashboard, ancrage sur intervention_date).
//
// Permission : module 'stats' (ou admin/superadmin).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc }           from '@/lib/odoo'

export const dynamic = 'force-dynamic'

// Statuts consideres comme facturables / realises pour le CA.
// (on exclut new/dispatching/parked/cancelled : pas encore facturable.)
const REVENUE_STATUSES = ['completed', 'to_invoice', 'invoiced']

const VAT = 1.21
const round2 = (n: number) => Math.round(n * 100) / 100

function startOf(date: Date, unit: 'day' | 'week' | 'month' | 'quarter' | 'year'): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  if (unit === 'day') return d
  if (unit === 'week') {
    const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day
    d.setDate(d.getDate() + diff)
    return d
  }
  if (unit === 'month')   { d.setDate(1); return d }
  if (unit === 'quarter') { d.setDate(1); d.setMonth(Math.floor(d.getMonth() / 3) * 3); return d }
  if (unit === 'year')    { d.setDate(1); d.setMonth(0); return d }
  return d
}

function computePeriod(period: string, customFrom?: string, customTo?: string): { from: string; to: string; label: string } {
  const now = new Date()
  let from: Date, to: Date, label: string
  switch (period) {
    case 'today':
      from = startOf(now, 'day'); to = new Date(from); to.setDate(to.getDate() + 1); label = "Aujourd'hui"; break
    case 'week':
      from = startOf(now, 'week'); to = new Date(from); to.setDate(to.getDate() + 7); label = 'Cette semaine'; break
    case 'quarter':
      from = startOf(now, 'quarter'); to = new Date(from); to.setMonth(to.getMonth() + 3); label = 'Ce trimestre'; break
    case 'year':
      from = startOf(now, 'year'); to = new Date(from); to.setFullYear(to.getFullYear() + 1); label = 'Cette annee'; break
    case 'custom':
      from = new Date(customFrom || now); to = new Date(customTo || now)
      label = `${from.toLocaleDateString('fr-BE')} - ${to.toLocaleDateString('fr-BE')}`; break
    case 'month':
    default:
      from = startOf(now, 'month'); to = new Date(from); to.setMonth(to.getMonth() + 1); label = 'Ce mois-ci'; break
  }
  return { from: from.toISOString(), to: to.toISOString(), label }
}

interface RevMission {
  id: string
  assigned_to: string | null
  source: string | null
  status: string
  special_tarif_htva: number | null
  amount_to_collect: number | null
  payment_amount: number | null
  odoo_quote_id: number | null
  invoice_odoo_id: number | null
}

// Estimation HTVA quand pas de facture Odoo postee.
function estimateHtva(m: RevMission): number {
  if (m.special_tarif_htva && Number(m.special_tarif_htva) > 0) return round2(Number(m.special_tarif_htva))
  if (m.amount_to_collect  && Number(m.amount_to_collect)  > 0) return round2(Number(m.amount_to_collect) / VAT)
  if (m.payment_amount     && Number(m.payment_amount)     > 0) return round2(Number(m.payment_amount) / VAT)
  return 0
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const period    = searchParams.get('period')    || 'month'
  const dateFrom  = searchParams.get('dateFrom')  || undefined
  const dateTo    = searchParams.get('dateTo')    || undefined
  const source    = searchParams.get('source')    || undefined
  const chauffeur = searchParams.get('chauffeur') || undefined

  const p  = computePeriod(period, dateFrom, dateTo)
  const sb = createAdminClient()

  // Permission : module 'stats' ou admin
  const { data: actor } = await sb.from('users')
    .select('id, role').eq('email', session.user!.email!).single()
  if (!actor) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })
  const isAdmin = ['admin', 'superadmin'].includes(actor.role)
  if (!isAdmin) {
    const { data: mods } = await sb.from('user_modules')
      .select('module_id').eq('user_id', actor.id).eq('granted', true)
    if (!(mods || []).some(m => m.module_id === 'stats')) {
      return NextResponse.json({ error: 'Module stats non autorise' }, { status: 403 })
    }
  }

  // Missions facturables de la periode, attribuees a un chauffeur.
  let q = sb.from('incoming_missions')
    .select('id, assigned_to, source, status, special_tarif_htva, amount_to_collect, payment_amount, odoo_quote_id, invoice_odoo_id')
    .gte('intervention_date', p.from)
    .lt('intervention_date', p.to)
    .in('status', REVENUE_STATUSES)
    .not('assigned_to', 'is', null)
  if (source)    q = q.eq('source', source)
  if (chauffeur) q = q.eq('assigned_to', chauffeur)
  const { data: missionsRaw } = await q
  const missions: RevMission[] = (missionsRaw || []) as any

  // ── Montants Odoo (facture postee = source de verite) ──────────────
  // Un seul batch : sale.order → invoice_ids, puis account.move (amount_untaxed).
  let odooOk = true
  const odooHtvaByMission = new Map<string, number>()
  try {
    const quoteIds = Array.from(new Set(
      missions.map(m => m.odoo_quote_id).filter(Boolean).map(Number)
    ))
    const quoteInvoices = new Map<number, number[]>()
    if (quoteIds.length > 0) {
      const orders = await odooRpc<any[]>('sale.order', 'read', [quoteIds], { fields: ['invoice_ids'] })
      for (const o of orders || []) quoteInvoices.set(Number(o.id), (o.invoice_ids || []).map(Number))
    }
    const directMoveIds = missions.map(m => m.invoice_odoo_id).filter(Boolean).map(Number)
    const allMoveIds = Array.from(new Set([
      ...Array.from(quoteInvoices.values()).flat(),
      ...directMoveIds,
    ]))
    const moveMap = new Map<number, { type: string; state: string; amt: number }>()
    if (allMoveIds.length > 0) {
      const moves = await odooRpc<any[]>('account.move', 'read', [allMoveIds], {
        fields: ['id', 'move_type', 'state', 'amount_untaxed'],
      })
      for (const mv of moves || []) {
        moveMap.set(Number(mv.id), { type: mv.move_type, state: mv.state, amt: Number(mv.amount_untaxed) || 0 })
      }
    }
    for (const m of missions) {
      const ids = new Set<number>()
      if (m.odoo_quote_id)  for (const iid of quoteInvoices.get(Number(m.odoo_quote_id)) || []) ids.add(iid)
      if (m.invoice_odoo_id) ids.add(Number(m.invoice_odoo_id))
      let sum = 0, hasPosted = false
      for (const iid of ids) {
        const mv = moveMap.get(iid)
        if (!mv || mv.state !== 'posted') continue
        if (mv.type === 'out_invoice') { sum += mv.amt; hasPosted = true }
        else if (mv.type === 'out_refund') { sum -= mv.amt; hasPosted = true }
      }
      if (hasPosted) odooHtvaByMission.set(m.id, round2(sum))
    }
  } catch {
    odooOk = false  // Odoo indispo → on retombe sur les estimations pour tout
  }

  // ── Agregation par chauffeur ───────────────────────────────────────
  interface Agg {
    missions_count: number
    invoiced_count: number       // missions avec facture Odoo postee
    revenue_odoo: number         // CA venant des factures Odoo
    revenue_estimate: number     // CA estime (pas encore facture Odoo)
  }
  const byId = new Map<string, Agg>()
  for (const m of missions) {
    const id = m.assigned_to!
    const a = byId.get(id) || { missions_count: 0, invoiced_count: 0, revenue_odoo: 0, revenue_estimate: 0 }
    a.missions_count++
    if (odooHtvaByMission.has(m.id)) {
      a.invoiced_count++
      a.revenue_odoo += odooHtvaByMission.get(m.id)!
    } else {
      a.revenue_estimate += estimateHtva(m)
    }
    byId.set(id, a)
  }

  // Noms chauffeurs
  const driverIds = Array.from(byId.keys())
  const nameMap = new Map<string, string>()
  if (driverIds.length > 0) {
    const { data: users } = await sb.from('users').select('id, name').in('id', driverIds)
    for (const u of users || []) nameMap.set(u.id, u.name)
  }

  const byDriver = driverIds.map(id => {
    const a = byId.get(id)!
    return {
      driver_id: id,
      name: nameMap.get(id) || '?',
      missions_count: a.missions_count,
      invoiced_count: a.invoiced_count,
      revenue_odoo: round2(a.revenue_odoo),
      revenue_estimate: round2(a.revenue_estimate),
      revenue_htva: round2(a.revenue_odoo + a.revenue_estimate),
    }
  }).sort((x, y) => y.revenue_htva - x.revenue_htva)

  const total_htva     = round2(byDriver.reduce((s, d) => s + d.revenue_htva, 0))
  const invoiced_htva  = round2(byDriver.reduce((s, d) => s + d.revenue_odoo, 0))
  const estimated_htva = round2(byDriver.reduce((s, d) => s + d.revenue_estimate, 0))

  return NextResponse.json({
    period: p,
    filters: { source: source || null, chauffeur: chauffeur || null },
    odooOk,
    total_htva,
    invoiced_htva,
    estimated_htva,
    byDriver,
  })
}
