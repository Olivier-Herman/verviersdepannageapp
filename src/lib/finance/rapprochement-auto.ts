// src/lib/finance/rapprochement-auto.ts — rapprochement automatique des avis de paiement (Olivier 28/10/2026, point 2
// des optimisations : « ok » ; bloc « Rapprochement des paiements » de « Mes assistants »).
//
// Les avis (IMA, AWP…) sont déjà lus et mis en cache (cron payment-advices, 5 h et midi) et appariés au virement par
// lib/advice-match.ts. Jusqu'ici, le lettrage attendait une validation (5 à 6 jours en moyenne). Désormais :
//   • état « ready » (virement arrivé, toutes les factures retrouvées, montants concordants AU CENTIME avec la banque —
//     le contrôle se fait contre le virement, pas contre l'avis) → lettré seul, une ligne par facture (reconcileSource,
//     le même chemin que le bouton). Paiement lu dans la communication sans avis : pareil, même sur plusieurs factures,
//     tant que les numéros cités couvrent le reste à lettrer au centime (Olivier 28/10/2026, virements Touring que l'ERP
//     avait lettrés en partie).
//   • état « pending » (avis reçu, virement pas encore là) → ses factures sortent du relevé des assistances.
//   • « gap » / « miss » (écart, facture introuvable) depuis plus de 3 jours → remontés à Mobi, rien n'est touché.

import { createAdminClient } from '@/lib/supabase'
import { buildAdviceReport, type MatchedAdvicePayment } from '@/lib/advice-match'
import { reconcileSource } from '@/lib/agents/lot2'
import { noterAvisDePaiement } from '@/lib/facturation/releves'
import { planCommission, lettrerCommission } from '@/lib/finance/commission-nc'

export interface ResultatRapprochement { lettres: string[]; enAttente: number; aTrancher: string[]; erreurs: string[] }

async function dejaFaits(): Promise<Set<number>> {
  const { data } = await createAdminClient().from('payout_reconciliations').select('bank_line_id').in('provider', ['ima', 'awp', 'anwb', 'communication']).eq('status', 'done')
  return new Set((data || []).map(r => Number(r.bank_line_id)).filter(Boolean))
}

const libelle = (i: MatchedAdvicePayment) => `${i.payerLabel} ${(i.bank?.amount ?? i.advice?.total ?? 0).toFixed(2)} €${i.advice?.reference ? ` (avis ${i.advice.reference})` : ''}`

export async function rapprocherAvis(opts: { simuler?: boolean } = {}): Promise<ResultatRapprochement> {
  const out: ResultatRapprochement = { lettres: [], enAttente: 0, aTrancher: [], erreurs: [] }
  const [report, faits] = await Promise.all([buildAdviceReport(3), dejaFaits()])

  // 1. Avis en attente du virement : leurs factures sortent du relevé des assistances.
  for (const i of report.items.filter(i => i.state === 'pending' && i.advice)) {
    out.enAttente++
    const noms = i.invoices.map(f => f.invoiceName).filter(Boolean) as string[]
    if (noms.length && !opts.simuler) await noterAvisDePaiement(noms, String(i.advice!.receivedAt).slice(0, 10)).catch(() => {})
  }

  // 2. Prêts : lettrage seul.
  for (const i of report.items.filter(i => i.state === 'ready' && i.bank && !faits.has(i.bank.lineId))) {
    if (opts.simuler) { out.lettres.push(`${libelle(i)} — ${i.invoices.length} facture(s) (simulation)`); continue }
    try { out.lettres.push(await reconcileSource('assureur', i.bank!.lineId, null)) }
    catch (e: any) { out.erreurs.push(`${libelle(i)} : ${e?.message || e}`) }
  }

  // 2 bis. Garage commissionné qui paie en déduisant ses NC de commission (Car Avenue — méthode d'Olivier, 28/10/2026) :
  // NC de commission déliées puis paiement + NC citées lettrés sur la facture, si tout tombe juste au centime.
  const traites = new Set<number>()
  for (const i of report.items.filter(i => i.source === 'communication' && i.state === 'gap' && i.bank && !faits.has(i.bank.lineId))) {
    const factures = i.invoices.filter(f => f.invoiceId && (f.invoiceTotal ?? 0) > 0)
    if (factures.length !== 1 || !/\bNC\b/i.test(i.communication || '')) continue
    try {
      const plan = await planCommission(i.communication || '', Number(i.bank!.amount), factures[0].invoiceId!)
      if (!plan.ok) { out.aTrancher.push(`${libelle(i)} : ${plan.raison}`); traites.add(i.bank!.lineId); continue }
      out.lettres.push(opts.simuler ? `${libelle(i)} — ${plan.facture} + ${plan.nc!.join(', ')}${plan.adelier!.length ? ` (délier ${plan.adelier!.join(', ')})` : ''} (simulation)` : await lettrerCommission(i.bank!.lineId, plan))
      traites.add(i.bank!.lineId)
    } catch (e: any) { out.erreurs.push(`${libelle(i)} : ${e?.message || e}`); traites.add(i.bank!.lineId) }
  }

  // 3. À trancher par une personne (écart, facture introuvable) depuis plus de 3 jours.
  // Mis de côté par Olivier (« sans retour de leur part ou sans sujet lancé par moi, on le laisse de côté », AWP 10 000 €
  // avis BEVO492090, 28/10/2026) : réglage rapprochement_mis_de_cote = références d'avis ou n° de lignes de banque.
  const { getBusinessList } = await import('@/lib/settings/business')
  const deCote = new Set(await getBusinessList('rapprochement_mis_de_cote').catch(() => [] as string[]))
  const limite = Date.now() - 3 * 86_400_000
  for (const i of report.items.filter(i => (i.state === 'gap' || i.state === 'miss') && Date.parse(i.bank?.date || i.advice?.receivedAt || '') < limite
    && !deCote.has(String(i.advice?.reference || '')) && !deCote.has(String(i.bank?.lineId || '')) && !traites.has(i.bank?.lineId ?? -1)))
    out.aTrancher.push(`${libelle(i)} : ${i.blocking[0] || i.state}`)
  return out
}
