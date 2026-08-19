// src/app/api/finance/advices/route.ts
//
// Finance › Réconciliation — volet assureurs (IMA, Mondial).
//
//   GET  → le rapport : avis lus dans la boîte mail, appariés aux virements et
//          aux factures. LECTURE SEULE.
//   POST → lettre un ou plusieurs virements. Le serveur rejoue la vérification
//          de son côté : le client ne décide de rien.
//
// Même règle d'accès que le volet Paynovate : superadmin strict, sur les trois
// surfaces (tuile, page, API).

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { sessionAccess }             from '@/lib/access'
import { createAdminClient }         from '@/lib/supabase'
import { buildAdviceReport }         from '@/lib/advice-match'
import { syncAdvices }               from '@/lib/advice-cache'
import { buildAdvicePlan, summarizeAdvicePlans, postAdvicePlan } from '@/lib/advice-post'
import { markUnallocated, clearUnallocated } from '@/lib/payout-unallocated'
import { humanOdooError } from '@/lib/reconcile-odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 180

const ACCESS = { roles: ['superadmin'], modules: [] as string[] }

/** Les virements assureurs déjà rapprochés par le module. */
async function alreadyDone(): Promise<Set<number>> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('payout_reconciliations')
    .select('bank_line_id')
    .in('provider', ['ima', 'awp'])
    .eq('status', 'done')
    .order('id', { ascending: true })
  return new Set((data || []).map(r => Number(r.bank_line_id)).filter(Boolean))
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const access  = sessionAccess(session, ACCESS)
  if (!access.ok) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })

  try {
    const months = Math.min(12, Math.max(1, Number(req.nextUrl.searchParams.get('months')) || 2))

    // L'écran lit le cache — instantané. `refresh=1` va rechercher les avis
    // arrivés depuis le dernier passage du cron (5 h et midi) ; c'est le seul
    // chemin qui parle à Graph, et il est déclenché par un clic, jamais par
    // l'affichage.
    let synced: any = null
    if (req.nextUrl.searchParams.get('refresh') === '1') {
      const since = new Date()
      since.setUTCMonth(since.getUTCMonth() - months)
      synced = await syncAdvices(since.toISOString())
    }

    const [report, done] = await Promise.all([buildAdviceReport(months), alreadyDone()])

    const items = report.items.filter(i => i.state !== 'done' && !(i.bank && done.has(i.bank.lineId)))
    const plans = items.filter(i => i.state === 'ready').map(buildAdvicePlan)

    return NextResponse.json({
      ok: true,
      items,
      totals: report.totals,
      ready: summarizeAdvicePlans(plans),
      cachedAt:   report.cachedAt,
      unreadable: report.unreadable,
      synced,
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

  const body = await req.json().catch(() => ({}))
  const bankLineIds: number[] = (Array.isArray(body.bankLineIds) ? body.bankLineIds : [body.bankLineId])
    .map(Number).filter(Boolean)
  if (!bankLineIds.length) return NextResponse.json({ error: 'Aucun virement indiqué' }, { status: 400 })

  try {
    const [report, done] = await Promise.all([buildAdviceReport(Number(body.months) || 2), alreadyDone()])
    const sb = createAdminClient()
    const results: { bankLineId: number; ok: boolean; error?: string; invoices?: number }[] = []

    for (const id of bankLineIds) {
      if (done.has(id)) { results.push({ bankLineId: id, ok: false, error: 'Virement déjà rapproché' }); continue }

      const item = report.items.find(i => i.bank?.lineId === id)
      if (!item)                 { results.push({ bankLineId: id, ok: false, error: 'Virement introuvable' }); continue }
      if (item.state !== 'ready') { results.push({ bankLineId: id, ok: false, error: item.blocking[0] || `état « ${item.state} »` }); continue }

      const plan = buildAdvicePlan(item)
      try {
        const { reconciled, paymentIds } = await postAdvicePlan(plan)

        await sb.from('payout_reconciliations').insert({
          provider:     item.payer,
          payout_ref:   item.advice?.reference || `${item.payer}-${id}`,
          customer_ref: item.payerLabel,
          payout_date:  plan.bankDate,
          gross_amount: plan.amount,
          net_amount:   plan.amount,
          commission_amount: 0,
          bank_line_id: plan.bankLineId,
          invoice_ids:  plan.invoiceIds,
          payment_ids:  paymentIds,
          reconciled_by: access.id,
          payload:      { item, plan },
        })

        done.add(id)
        results.push({ bankLineId: id, ok: true, invoices: reconciled })
      } catch (e: any) {
        // Jamais la pile Odoo dans l'écran : seulement la phrase utile.
        results.push({ bankLineId: id, ok: false, error: humanOdooError(e) })
      }
    }

    const okCount = results.filter(r => r.ok).length
    return NextResponse.json({ ok: okCount > 0, done: okCount, results })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

/**
 * PATCH → décide qu'une LIGNE de l'avis part en OD sur le compte d'attente,
 * faute de facture retrouvée. Ou annule cette décision.
 *
 * Une écriture par ligne, avec son propre commentaire : c'est la seule chose
 * lisible que le comptable aura en face du montant resté en 499000. On ne
 * rapproche rien ici — le virement redevient rapprochable par le chemin normal.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const access  = sessionAccess(session, ACCESS)
  if (!access.ok) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })

  const body    = await req.json().catch(() => ({}))
  const linkKey = String(body.linkKey || '').trim()
  const amount  = Number(body.amount)
  if (!linkKey || !Number.isFinite(amount)) {
    return NextResponse.json({ error: 'Ligne ou montant manquant' }, { status: 400 })
  }

  try {
    if (body.clear) {
      const cleared = await clearUnallocated('assureur', linkKey, amount)
      return NextResponse.json({ ok: true, cleared })
    }
    const saved = await markUnallocated({
      provider: 'assureur',
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
