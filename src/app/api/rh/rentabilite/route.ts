// src/app/api/rh/rentabilite/route.ts
//
// Rentabilité par chauffeur : CA des missions attribuées − coût salarial.
// Marge de CONTRIBUTION (ne déduit pas frais généraux / amortissement).
// Superadmin. Olivier 2026-08-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isPersonnelStaff }  from '@/lib/rh-access'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 30

// Coût employeur estimé si absent de la fiche : brut × facteur (charges patronales BE).
const EMPLOYER_FACTOR = parseFloat(process.env.RH_EMPLOYER_FACTOR || '1.32')

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!isPersonnelStaff(u)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const months = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get('months') || '12'), 1), 24)
  const d = new Date(); d.setMonth(d.getMonth() - (months - 1)); d.setDate(1)
  const startDate = d.toISOString().slice(0, 10)
  const startPeriod = startDate.slice(0, 7)   // AAAA-MM
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
    const { data, error } = await sb.from('incoming_missions')
      .select('assigned_to, estimated_htva, mission_type, status, assigned_at')
      .in('assigned_to', userIds).gte('assigned_at', startDate + 'T00:00:00')
      .not('status', 'in', '(cancelled,ignored,parse_error)')
      .order('id', { ascending: true }).range(from, from + PAGE - 1)
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
  const { data: slips } = await sb.from('payslips')
    .select('personnel_id, cout_employeur, montant_brut, period')
    .in('personnel_id', persIds).gte('period', startPeriod)
  const cost = new Map<string, number>()
  for (const s of (slips || [])) {
    if (!s.personnel_id) continue
    const active = activeMonths.get(persToUser.get(s.personnel_id))
    if (!active || !active.has(s.period)) continue   // mois sans mission app → écarté (comparaison biaisée)
    const c = s.cout_employeur != null ? s.cout_employeur : (s.montant_brut != null ? s.montant_brut * EMPLOYER_FACTOR : 0)
    cost.set(s.personnel_id, (cost.get(s.personnel_id) || 0) + c)
  }

  const drivers = (personnel || []).map((p: any) => {
    const rev = ca.get(p.user_id) || { ca: 0, n: 0 }
    const cout = Math.round(cost.get(p.id) || 0)
    const caR = Math.round(rev.ca)
    return { name: p.name, ca: caR, cout, marge: caR - cout, missions: rev.n, hasCost: cost.has(p.id) }
  }).filter((x: any) => x.ca > 0 || x.cout > 0)
    .sort((a: any, b: any) => b.marge - a.marge)

  return NextResponse.json({ months, startPeriod, employerFactor: EMPLOYER_FACTOR, drivers })
}
