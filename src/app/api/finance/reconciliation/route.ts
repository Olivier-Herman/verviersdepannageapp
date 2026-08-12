// src/app/api/finance/reconciliation/route.ts
//
// Finance › Réconciliation — les versements Paynovate à rapprocher.
//
//   GET  → le rapport complet (versements, factures, états, plans d'écriture).
//          LECTURE SEULE : rien n'est écrit, même sur les versements « prêts ».
//   POST → rapproche réellement un versement. Un clic humain, jamais le cron.
//
// Les versements déjà traités sont exclus du rapport : l'unicité vit dans
// payout_reconciliations, pas dans la mémoire du processus.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { sessionAccess }             from '@/lib/access'
import { createAdminClient }         from '@/lib/supabase'
import { buildMatchReport }          from '@/lib/paynovate-match'
import { buildPostingPlan, summarizePlans, postPlan } from '@/lib/paynovate-post'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// Rodage : superadmin STRICT. Même règle que la tuile Finance et que la page,
// pour qu'on ne puisse pas contourner l'écran en appelant l'API directement.
// Ouvrir au module 'facturation' quand les écritures seront validées.
const ACCESS = { roles: ['superadmin'], modules: [] as string[] }

/** Les versements déjà rapprochés — ils ne doivent plus apparaître. */
async function alreadyDone(): Promise<Set<string>> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('payout_reconciliations')
    .select('payout_ref')
    .eq('provider', 'paynovate')
    .eq('status', 'done')
    .order('id', { ascending: true })
  return new Set((data || []).map(r => String(r.payout_ref)))
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const access  = sessionAccess(session, ACCESS)
  if (!access.ok) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })

  try {
    const months = Math.min(12, Math.max(1, Number(req.nextUrl.searchParams.get('months')) || 5))
    const [report, done] = await Promise.all([buildMatchReport(months), alreadyDone()])

    const payouts = report.payouts.filter(p => !done.has(String(p.paymentId)))
    const plans   = payouts.filter(p => p.state === 'ready').map(buildPostingPlan)

    return NextResponse.json({
      ok: true,
      payouts,
      unmatched: report.unmatched,
      totals: {
        ...report.totals,
        count:  payouts.length,
        amount: Math.round(payouts.reduce((s, p) => s + p.bankAmount, 0) * 100) / 100,
      },
      ready: summarizePlans(plans),
      plans,
      generatedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const access  = sessionAccess(session, ACCESS)
  if (!access.ok) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })

  const body      = await req.json().catch(() => ({}))
  const payoutIds = (Array.isArray(body.payoutIds) ? body.payoutIds : [body.payoutId])
    .map(Number).filter(Boolean)
  if (!payoutIds.length) return NextResponse.json({ error: 'Aucun versement indiqué' }, { status: 400 })

  try {
    const [report, done] = await Promise.all([buildMatchReport(Number(body.months) || 5), alreadyDone()])
    const sb = createAdminClient()

    const results: { payoutId: number; ok: boolean; error?: string; odMoveId?: number | null }[] = []

    for (const id of payoutIds) {
      // On rejoue la vérification côté serveur : le client ne décide de rien.
      if (done.has(String(id))) {
        results.push({ payoutId: id, ok: false, error: 'Versement déjà rapproché' })
        continue
      }
      const payout = report.payouts.find(p => p.paymentId === id)
      if (!payout) {
        results.push({ payoutId: id, ok: false, error: 'Versement introuvable' })
        continue
      }
      if (payout.state !== 'ready') {
        results.push({ payoutId: id, ok: false, error: `Versement à trancher (${payout.blocking[0] || payout.state})` })
        continue
      }

      const plan = buildPostingPlan(payout)
      try {
        const { odMoveId } = await postPlan(plan)

        // La trace part APRÈS l'écriture Odoo : si Odoo échoue, rien n'est noté.
        await sb.from('payout_reconciliations').insert({
          provider:          'paynovate',
          payout_ref:        String(id),
          customer_ref:      payout.terminal,
          terminal_tid:      payout.tid,
          payout_date:       payout.bankDate,
          gross_amount:      plan.gross,
          net_amount:        plan.net,
          commission_amount: plan.commission,
          bank_line_id:      plan.bankLineId,
          od_move_id:        odMoveId,
          invoice_ids:       plan.invoiceIds,
          payment_ids:       plan.paymentIds,
          reconciled_by:     access.id,
          payload:           { payout, plan },
        })

        done.add(String(id))
        results.push({ payoutId: id, ok: true, odMoveId })
      } catch (e: any) {
        results.push({ payoutId: id, ok: false, error: String(e?.message || e) })
      }
    }

    const okCount = results.filter(r => r.ok).length
    return NextResponse.json({ ok: okCount > 0, done: okCount, results })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
