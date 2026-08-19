// src/app/api/finance/reconciliation/sumup/route.ts
//
// Finance › Réconciliation — les versements SumUp à rapprocher.
//
//   GET    → le rapport complet (versements, factures, états, plans d'écriture).
//            LECTURE SEULE : rien n'est écrit, même sur les versements « prêts ».
//   POST   → rapproche réellement un versement. Un clic humain, jamais le cron.
//   PUT    → rattache une référence terminal à une ou plusieurs factures.
//   DELETE → défait un rattachement fait à la main.
//
// Même contrat que la route Paynovate voisine, à la source près : l'écran est
// le même composant, il ne connaît que l'URL.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { sessionAccess }             from '@/lib/access'
import { createAdminClient }         from '@/lib/supabase'
import { buildSumupMatchReport }     from '@/lib/sumup-match'
import { buildSumupPostingPlan }     from '@/lib/sumup-post'
import { summarizePlans, postPlan }  from '@/lib/paynovate-post'
import { saveOverride, removeOverride } from '@/lib/paynovate-resolve'
import { markUnallocated, clearUnallocated } from '@/lib/payout-unallocated'
import { paymentsForInvoices } from '@/lib/reconcile-odoo'
import { resolveSumupReference, loadTokenIndex, readInvoices } from '@/lib/sumup-resolve'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// Rodage : superadmin STRICT, comme la tuile Finance et la page. Ouvrir au
// module 'facturation' quand les écritures seront validées.
const ACCESS = { roles: ['superadmin'], modules: [] as string[] }

/** Le prestataire servi par cette route — cloisonne décisions et rattachements. */
const PROVIDER = 'sumup' as const

/** Les versements déjà rapprochés — ils ne doivent plus apparaître. */
async function alreadyDone(): Promise<Set<string>> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('payout_reconciliations')
    .select('payout_ref')
    .eq('provider', 'sumup')
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
    const [report, done] = await Promise.all([buildSumupMatchReport(months), alreadyDone()])

    const payouts = report.payouts.filter(p => !done.has(String(p.paymentId)))
    const plans   = payouts.filter(p => p.state === 'ready').map(buildSumupPostingPlan)

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

/**
 * PUT → rattache une référence terminal à une ou plusieurs factures, quand la
 * résolution automatique n'a rien trouvé de sûr. On ne rapproche RIEN ici : on
 * enregistre le rattachement, et le versement redevient « prêt » par le chemin
 * normal, garde-fous compris.
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const access  = sessionAccess(session, ACCESS)
  if (!access.ok) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })

  const body   = await req.json().catch(() => ({}))
  const ref    = String(body.merchantRef || '').trim()
  const amount = Number(body.amount)
  const names  = (Array.isArray(body.invoiceNames) ? body.invoiceNames : String(body.invoiceNames || '').split(/[\s,;+]+/))
    .map((s: any) => String(s).trim()).filter(Boolean)

  if (!ref)                     return NextResponse.json({ error: 'Référence manquante' }, { status: 400 })
  if (!Number.isFinite(amount)) return NextResponse.json({ error: 'Montant manquant' }, { status: 400 })
  if (!names.length)            return NextResponse.json({ error: 'Indique au moins un numéro de facture' }, { status: 400 })

  try {
    const saved = await saveOverride(ref, amount, names, access.id, 'sumup')
    const fits  = Math.abs(saved.total - amount) < 0.005

    // Une facture peut être réglée en plusieurs fois : le total ne correspond
    // pas, mais il existe un paiement du montant exact. Ce n'est pas un écart,
    // et le dire tout de suite évite d'annoncer un blocage qui n'existe pas.
    let partial = false
    if (!fits) {
      const byInvoice = await paymentsForInvoices(saved.invoiceIds)
      partial = [...byInvoice.values()].flat().some(p => Math.abs(p.amount - amount) < 0.005)
    }

    return NextResponse.json({
      ok: true, ...saved, partial,
      warning: fits || partial ? null
        : `Le total des factures (${saved.total.toFixed(2)} €) ne correspond pas aux ${amount.toFixed(2)} € encaissés — le versement restera à trancher.`,
    })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 })
  }
}

/**
 * DELETE → défait un rattachement manuel, puis relance la résolution
 * automatique pour cette référence et renvoie le résultat, afin que l'écran se
 * mette à jour sans tout relire chez SumUp.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const access  = sessionAccess(session, ACCESS)
  if (!access.ok) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })

  const body   = await req.json().catch(() => ({}))
  const ref    = String(body.merchantRef || '').trim()
  const amount = Number(body.amount)
  const at     = body.at ? String(body.at) : null
  if (!ref || !Number.isFinite(amount)) {
    return NextResponse.json({ error: 'Référence ou montant manquant' }, { status: 400 })
  }

  try {
    const removed = await removeOverride(ref, amount, 'sumup')

    // On rejoue la résolution automatique pour cette seule référence : le jeton
    // VD Soft doit être relu, sinon on renverrait l'ancien rattachement.
    const tokens = await loadTokenIndex([ref])
    const cache  = await readInvoices([...tokens.values()].map(h => h.invoiceId).filter((n): n is number => !!n))
    const res    = await resolveSumupReference(ref, amount, at, tokens, cache)

    const kept  = res.candidates.filter(c => res.invoiceIds.includes(c.id))
    const total = kept.reduce((s, c) => s + c.amount, 0)

    return NextResponse.json({
      ok: true,
      removed,
      confidence:   res.confidence,
      explanation:  res.explanation,
      manual:       !!res.manual,
      invoiceIds:   res.invoiceIds,
      names:        kept.map(c => c.name),
      total:        Math.round(total * 100) / 100,
      partner:      kept[0]?.partner ?? '',
      paymentState: kept.length === 1 ? kept[0].payment_state : null,
      candidates:   res.candidates,
    })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 })
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
    // Vérification ciblée : on ne recalcule que les versements demandés, mais
    // le contrôle reste intégral (état, factures, montants).
    const [report, done] = await Promise.all([
      buildSumupMatchReport(Number(body.months) || 5, { onlyPayouts: payoutIds }),
      alreadyDone(),
    ])
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
      // « lost » est rapprochable : le module enregistre le paiement carte
      // manquant avant de lettrer.
      if (payout.state !== 'ready' && payout.state !== 'lost') {
        results.push({ payoutId: id, ok: false, error: `Versement à trancher (${payout.blocking[0] || payout.state})` })
        continue
      }

      const plan = buildSumupPostingPlan(payout)
      try {
        const { odMoveId } = await postPlan(plan)

        // La trace part APRÈS l'écriture Odoo : si Odoo échoue, rien n'est noté.
        await sb.from('payout_reconciliations').insert({
          provider:          'sumup',
          payout_ref:        String(id),
          customer_ref:      payout.terminal,          // « MC7 PID1332537 »
          terminal_tid:      null,                     // un seul compte marchand
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

/**
 * PATCH → décide qu'une ligne part en OD sur le compte d'attente, faute de
 * facture identifiable. Ou annule cette décision.
 *
 * On ne rapproche RIEN ici : la décision est enregistrée, la ligne cesse de
 * bloquer, et le versement redevient rapprochable par le chemin normal — le
 * plan d'écriture y ajoutera le débit 542 manquant.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const access  = sessionAccess(session, ACCESS)
  if (!access.ok) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })

  const body    = await req.json().catch(() => ({}))
  const linkKey = String(body.linkKey || body.merchantRef || '').trim()
  const amount  = Number(body.amount)
  if (!linkKey || !Number.isFinite(amount)) {
    return NextResponse.json({ error: 'Ligne ou montant manquant' }, { status: 400 })
  }

  try {
    if (body.clear) {
      const removed = await clearUnallocated(PROVIDER, linkKey, amount)
      return NextResponse.json({ ok: true, cleared: removed })
    }
    const saved = await markUnallocated({
      provider: PROVIDER,
      linkKey,
      amount,
      reason:   String(body.reason || ''),
      userId:   access.id,
    })
    return NextResponse.json({ ok: true, unallocated: { amount: saved.amount, reason: saved.reason } })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 })
  }
}
