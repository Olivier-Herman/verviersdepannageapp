// src/app/api/paie/push/route.ts
//
// Push d'une (ou plusieurs) fiche(s) de paie vers Odoo → facture fournisseur
// postée sur le chauffeur, journal « Fiches de paie », PDF joint. Superadmin.
//
// POST { payslip_id, force? }        → pousse une fiche
// POST { period, force? }            → pousse toutes les fiches du mois (net > 0, non poussées)
// POST { personnel_id, force? }      → pousse toutes les fiches d'une personne
//
// Olivier 2026-08-01.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { pushPayslipToOdoo }         from '@/lib/paie/push-odoo'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 300

const isSuper = (u: any) => u?.role === 'superadmin' || (u?.roles || []).includes('superadmin')

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body  = await req.json().catch(() => ({}))
  const force = !!body.force
  const sb    = createAdminClient()

  // Une seule fiche
  if (body.payslip_id) {
    try {
      const r = await pushPayslipToOdoo(String(body.payslip_id), { force })
      return NextResponse.json({ ok: true, ...r })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // Lot : par mois ou par personne. Net renseigné et ≠ 0 (négatif accepté : correction).
  let q = sb.from('payslips').select('id, worker_name, montant_net, odoo_move_id')
    .not('montant_net', 'is', null).neq('montant_net', 0)
  if (body.period)       q = q.eq('period', String(body.period))
  if (body.personnel_id) q = q.eq('personnel_id', String(body.personnel_id))
  if (!force)            q = q.is('odoo_move_id', null)
  if (!body.period && !body.personnel_id) return NextResponse.json({ error: 'payslip_id, period ou personnel_id requis' }, { status: 400 })

  const { data: slips } = await q
  const results: any[] = []
  for (const s of (slips || [])) {
    try {
      const r = await pushPayslipToOdoo(s.id, { force })
      results.push({ id: s.id, worker: s.worker_name, ok: true, move: r.moveName, skipped: r.skipped })
    } catch (e: any) {
      results.push({ id: s.id, worker: s.worker_name, ok: false, error: e.message })
    }
  }
  const pushed  = results.filter(r => r.ok && !r.skipped).length
  const skipped = results.filter(r => r.skipped).length
  const failed  = results.filter(r => !r.ok)
  return NextResponse.json({ ok: true, total: results.length, pushed, skipped, failed, results })
}
