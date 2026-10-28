// src/lib/finance/rapprochement-auto.ts — rapprochement automatique des avis de paiement (Olivier 28/10/2026, point 2
// des optimisations : « ok » ; bloc « Rapprochement des paiements » de « Mes assistants »).
//
// Les avis (IMA, AWP…) sont déjà lus et mis en cache (cron payment-advices, 5 h et midi) et appariés au virement par
// lib/advice-match.ts. Jusqu'ici, le lettrage attendait une validation (5 à 6 jours en moyenne). Désormais :
//   • état « ready » (virement arrivé, toutes les factures retrouvées, montants concordants AU CENTIME avec la banque —
//     le contrôle se fait contre le virement, pas contre l'avis) → lettré seul, une ligne par facture (reconcileSource,
//     le même chemin que le bouton). Paiement lu dans la communication sans avis : seulement s'il porte UNE facture
//     (règle du 16/10/2026, rapprochement exact = sans validation).
//   • état « pending » (avis reçu, virement pas encore là) → ses factures sortent du relevé des assistances.
//   • « gap » / « miss » (écart, facture introuvable) depuis plus de 3 jours → remontés à Mobi, rien n'est touché.

import { createAdminClient } from '@/lib/supabase'
import { buildAdviceReport, type MatchedAdvicePayment } from '@/lib/advice-match'
import { reconcileSource } from '@/lib/agents/lot2'
import { noterAvisDePaiement } from '@/lib/facturation/releves'

export interface ResultatRapprochement { lettres: string[]; enAttente: number; aTrancher: string[]; erreurs: string[] }

async function dejaFaits(): Promise<Set<number>> {
  const { data } = await createAdminClient().from('payout_reconciliations').select('bank_line_id').in('provider', ['ima', 'awp', 'communication']).eq('status', 'done')
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
    if (i.source === 'communication' && i.invoices.length !== 1) { out.aTrancher.push(`${libelle(i)} : paiement par communication sur plusieurs factures, à valider`); continue }
    if (opts.simuler) { out.lettres.push(`${libelle(i)} — ${i.invoices.length} facture(s) (simulation)`); continue }
    try { out.lettres.push(await reconcileSource('assureur', i.bank!.lineId, null)) }
    catch (e: any) { out.erreurs.push(`${libelle(i)} : ${e?.message || e}`) }
  }

  // 3. À trancher par une personne (écart, facture introuvable) depuis plus de 3 jours.
  const limite = Date.now() - 3 * 86_400_000
  for (const i of report.items.filter(i => (i.state === 'gap' || i.state === 'miss') && Date.parse(i.bank?.date || i.advice?.receivedAt || '') < limite))
    out.aTrancher.push(`${libelle(i)} : ${i.blocking[0] || i.state}`)
  return out
}
