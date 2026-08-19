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
import { saveOverride, removeOverride, resolveReference } from '@/lib/paynovate-resolve'
import { markUnallocated, clearUnallocated } from '@/lib/payout-unallocated'
import { paymentsForInvoices, humanOdooError } from '@/lib/reconcile-odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// Rodage : superadmin STRICT. Même règle que la tuile Finance et que la page,
// pour qu'on ne puisse pas contourner l'écran en appelant l'API directement.
// Ouvrir au module 'facturation' quand les écritures seront validées.
const ACCESS = { roles: ['superadmin'], modules: [] as string[] }

/** Le prestataire servi par cette route — cloisonne décisions et rattachements. */
const PROVIDER = 'paynovate' as const

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

/**
 * PUT → rattache une référence terminal à une ou plusieurs factures, quand la
 * résolution automatique n'a rien trouvé de sûr. On ne rapproche RIEN ici : on
 * enregistre le rattachement, et le versement redevient « prêt » par le chemin
 * normal. Le rapprochement garde donc tous ses garde-fous.
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

  if (!ref)                        return NextResponse.json({ error: 'Référence manquante' }, { status: 400 })
  if (!Number.isFinite(amount))    return NextResponse.json({ error: 'Montant manquant' }, { status: 400 })
  if (!names.length)               return NextResponse.json({ error: 'Indique au moins un numéro de facture' }, { status: 400 })

  try {
    const saved = await saveOverride(ref, amount, names, access.id)
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
 * DELETE → défait un rattachement manuel (mauvaise facture désignée), puis
 * relance la résolution automatique pour cette référence et renvoie le
 * résultat, afin que l'écran se mette à jour sans tout relire chez Paynovate.
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
    const removed = await removeOverride(ref, amount)
    const res     = await resolveReference(ref, amount, at)

    // On renvoie de quoi réafficher la ligne : la facture retenue, s'il y en a.
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
    // Vérification ciblée : on ne recalcule que les versements demandés.
    // Le contrôle reste intégral (état, factures, montants) — simplement borné.
    const [report, done] = await Promise.all([
      buildMatchReport(Number(body.months) || 5, { onlyPayouts: payoutIds }),
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
      // manquant avant de lettrer. Ne laisser passer que « ready » fermait la
      // porte à un cas que le moteur sait traiter.
      if (payout.state !== 'ready' && payout.state !== 'lost') {
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
        // Jamais la pile Odoo dans l'écran : seulement la phrase utile.
        results.push({ payoutId: id, ok: false, error: humanOdooError(e) })
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
