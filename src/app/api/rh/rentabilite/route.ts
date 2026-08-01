// src/app/api/rh/rentabilite/route.ts
//
// Rentabilité par chauffeur : CA des missions attribuées − coût salarial.
// Marge de CONTRIBUTION (ne déduit pas frais généraux / amortissement).
// Superadmin. Olivier 2026-08-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 30

// Coût employeur estimé si absent de la fiche : brut × facteur (charges patronales BE).
const EMPLOYER_FACTOR = parseFloat(process.env.RH_EMPLOYER_FACTOR || '1.32')

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  const isSuper = u?.role === 'superadmin' || (u?.roles || []).includes('superadmin')
  if (!isSuper) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sp = new URL(req.url).searchParams
  const only = sp.get('only')   // AAAA-MM : un seul mois (mois en cours / dernier)
  let months = 0, startDate = '', startPeriod = '', endPeriod = '', endDate = ''
  if (only && /^\d{4}-\d{2}$/.test(only)) {
    startPeriod = endPeriod = only
    startDate = `${only}-01`
    const [y, m] = only.split('-').map(Number)
    endDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)   // dernier jour du mois
  } else {
    months = Math.min(Math.max(parseInt(sp.get('months') || '12'), 1), 24)
    const d = new Date(); d.setMonth(d.getMonth() - (months - 1)); d.setDate(1)
    startDate = d.toISOString().slice(0, 10)
    startPeriod = startDate.slice(0, 7)
    const now = new Date(); endPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }
  const sb = createAdminClient()

  // Personnel lié à un compte app (= chauffeurs identifiables). On EXCLUT les
  // employés et gérants/dirigeants : la rentabilité ne concerne que les chauffeurs.
  const { data: personnel } = await sb.from('personnel')
    .select('id, name, user_id, company_code, statut').not('user_id', 'is', null)
    .not('statut', 'in', '(employe,gerant)')
  const persByUser = new Map<string, any>()
  for (const p of (personnel || [])) persByUser.set(p.user_id, p)
  const userIds = [...persByUser.keys()]
  if (!userIds.length) return NextResponse.json({ months, drivers: [], employerFactor: EMPLOYER_FACTOR })

  // CA : missions attribuées à ces chauffeurs sur la période (hors annulées / trajets vides).
  // PAGINÉ : sans ça, PostgREST plafonne à 1000 lignes → sous-comptage des missions.
  const missions: any[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('incoming_missions')
      .select('assigned_to, estimated_htva, mission_type, status, assigned_at')
      .in('assigned_to', userIds).gte('assigned_at', startDate + 'T00:00:00')
      .not('status', 'in', '(cancelled,ignored,parse_error)')
    if (endDate) q = q.lte('assigned_at', endDate + 'T23:59:59')
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error || !data?.length) break
    missions.push(...data)
    if (data.length < PAGE) break
  }
  const ca = new Map<string, { ca: number; n: number }>()
  const activeMonths = new Map<string, Set<string>>()   // user_id → mois AAAA-MM avec au moins une mission
  for (const m of (missions || [])) {
    const mo = (m.assigned_at || '').slice(0, 7)
    if (mo) { const s = activeMonths.get(m.assigned_to) || new Set<string>(); s.add(mo); activeMonths.set(m.assigned_to, s) }
    if ((m.mission_type || '').toLowerCase().includes('vide')) continue   // trajet vide = pas de CA
    const g = ca.get(m.assigned_to) || { ca: 0, n: 0 }
    g.ca += m.estimated_htva || 0; g.n++
    ca.set(m.assigned_to, g)
  }

  // Coût : fiches de paie, MAIS uniquement pour les mois où le chauffeur a des
  // missions dans l'app (sinon CA partiel vs coût complet = faux négatif).
  const persIds = (personnel || []).map((p: any) => p.id)
  const persToUser = new Map((personnel || []).map((p: any) => [p.id, p.user_id]))
  let slipQ = sb.from('payslips')
    .select('personnel_id, cout_employeur, montant_brut, period')
    .in('personnel_id', persIds).gte('period', startPeriod)
  if (endPeriod) slipQ = slipQ.lte('period', endPeriod)
  const { data: slips } = await slipQ
  const cost = new Map<string, number>()
  for (const s of (slips || [])) {
    if (!s.personnel_id) continue
    const active = activeMonths.get(persToUser.get(s.personnel_id))
    if (!active || !active.has(s.period)) continue   // mois sans mission app → écarté (comparaison biaisée)
    const c = s.cout_employeur != null ? s.cout_employeur : (s.montant_brut != null ? s.montant_brut * EMPLOYER_FACTOR : 0)
    cost.set(s.personnel_id, (cost.get(s.personnel_id) || 0) + c)
  }

  // CA manuel attribué (courses facturées dans Odoo, non rattachées : incentive, aftersix…).
  let extraQ = sb.from('driver_extra_ca').select('id, personnel_id, period, amount, label').gte('period', startPeriod)
  if (endPeriod) extraQ = extraQ.lte('period', endPeriod)
  const { data: extra } = await extraQ
  const extraByPers = new Map<string, number>()
  for (const e of (extra || [])) extraByPers.set(e.personnel_id, (extraByPers.get(e.personnel_id) || 0) + (Number(e.amount) || 0))
  const nameByPers = new Map((personnel || []).map((p: any) => [p.id, p.name]))
  const caLines = (extra || []).map((e: any) => ({ ...e, worker: nameByPers.get(e.personnel_id) || '?' })).sort((a: any, b: any) => String(b.period).localeCompare(String(a.period)))
  const caTargets = (personnel || []).map((p: any) => ({ id: p.id, name: p.name })).sort((a: any, b: any) => a.name.localeCompare(b.name))

  const drivers = (personnel || []).map((p: any) => {
    const rev = ca.get(p.user_id) || { ca: 0, n: 0 }
    const extraCa = Math.round(extraByPers.get(p.id) || 0)
    const cout = Math.round(cost.get(p.id) || 0)
    const caR = Math.round(rev.ca) + extraCa
    return { id: p.id, name: p.name, ca: caR, extraCa, cout, marge: caR - cout, missions: rev.n, hasCost: cost.has(p.id) }
  }).filter((x: any) => x.ca > 0 || x.cout > 0)
    .sort((a: any, b: any) => b.marge - a.marge)

  return NextResponse.json({ months, startPeriod, endPeriod, employerFactor: EMPLOYER_FACTOR, drivers, caLines, caTargets })
}

// Gestion du CA manuel (superadmin uniquement).
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  const isSuper = u?.role === 'superadmin' || (u?.roles || []).includes('superadmin')
  if (!isSuper) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const sb = createAdminClient()

  if (action === 'add_ca') {
    const personnel_id = String(body.personnel_id || '')
    const period = String(body.period || '')
    const amount = Number(body.amount)
    if (!personnel_id || !/^\d{4}-\d{2}$/.test(period) || !isFinite(amount)) return NextResponse.json({ error: 'Chauffeur, période (AAAA-MM) et montant requis.' }, { status: 400 })
    await sb.from('driver_extra_ca').insert({ personnel_id, period, amount, label: String(body.label || '').trim() || null, created_by: u.name || u.email })
    return NextResponse.json({ ok: true })
  }
  if (action === 'delete_ca') {
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    await sb.from('driver_extra_ca').delete().eq('id', id)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
