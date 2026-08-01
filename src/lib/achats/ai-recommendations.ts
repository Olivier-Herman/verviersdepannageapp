// ============================================================
// VERVIERS DÉPANNAGE — Recommandations d'achat pilotées par Claude
// ------------------------------------------------------------
// À partir des agrégats de dépenses (analyzeAchats) + catégories IA, Claude
// produit des recommandations ACTIONNABLES : consolidation de fournisseurs,
// opportunités de négociation, anomalies de prix, doublons — chiffrées en €.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'
import type { AchatsAnalysis } from './odoo-spend'

export interface AchatReco {
  title:                string
  type:                 'consolidation' | 'negociation' | 'anomalie' | 'doublon' | 'categorie' | 'autre'
  severity:             'high' | 'medium' | 'low'
  rationale:            string
  estimated_saving_eur: number          // économie annuelle estimée (0 si inconnue)
  actions:              string[]
  suppliers:            string[]
}

const RECO_TYPES = ['consolidation', 'negociation', 'anomalie', 'doublon', 'categorie', 'autre']

let _client: Anthropic | null = null
const getClient = () => (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))

const PROMPT = `Tu es DIRECTEUR ACHATS pour une société belge de DÉPANNAGE / REMORQUAGE automobile (VD Soft — Verviers Dépannage).
On te donne une synthèse chiffrée des dépenses fournisseurs (factures Odoo) sur une période. Ton job : trouver où faire des ÉCONOMIES concrètes.

Analyse et propose des recommandations ACTIONNABLES et RÉALISTES pour ce métier (pièces, pneus, carburant, sous-traitance dépannage, télécom, assurances, etc.). Cherche notamment :
- **Consolidation** : plusieurs fournisseurs pour un même type d'achat → regrouper pour du volume/remise.
- **Négociation** : gros postes ou fournisseurs à part de dépense élevée → cible de renégociation ; estime un % réaliste (souvent 3–10%).
- **Anomalie** : hausse suspecte, prix hors marché, concentration risquée (dépendance à 1 fournisseur).
- **Doublon** : factures en double détectées.
- **Catégorie** : poste de dépense anormalement élevé pour l'activité.

Chiffre chaque économie ANNUELLE en euros de façon PRUDENTE (extrapole si la période < 12 mois). N'invente pas de fournisseurs : n'utilise que ceux fournis.

Réponds UNIQUEMENT par un objet JSON valide (aucun texte autour) :
{
  "recommendations": [
    {
      "title": "<titre court et parlant>",
      "type": "consolidation | negociation | anomalie | doublon | categorie | autre",
      "severity": "high | medium | low",
      "rationale": "<2-3 phrases: le constat chiffré et pourquoi c'est une opportunité>",
      "estimated_saving_eur": <nombre entier, économie ANNUELLE estimée, 0 si non chiffrable>,
      "actions": ["<action concrète 1>", "<action concrète 2>"],
      "suppliers": ["<noms de fournisseurs concernés, sinon liste vide>"]
    }
  ]
}
Classe les recommandations de la plus forte à la plus faible économie. Max 8 recommandations, garde les plus impactantes.`

export async function generateAchatRecommendations(
  a: AchatsAnalysis,
  aiCategories: Array<{ categorie: string; amount: number }> = [],
): Promise<AchatReco[]> {
  // Synthèse compacte envoyée à Claude (pas de PII, juste des agrégats).
  const summary = {
    periode_mois: a.monthsBack,
    depense_totale_htva: a.overview.totalHtva,
    nb_factures: a.overview.count,
    nb_fournisseurs: a.overview.suppliers,
    ticket_moyen: a.overview.avgTicket,
    concentration_top5_pct: a.concentrationTop5,
    top_fournisseurs: a.topSuppliers.slice(0, 15).map(s => ({ nom: s.name, htva: s.htva, part_pct: s.share, nb_factures: s.count })),
    depenses_par_categorie_comptable: a.byCategory.slice(0, 15),
    depenses_par_categorie_ia: aiCategories.slice(0, 15),
    tendance_mensuelle: a.byMonth,
    doublons_detectes: a.duplicates.slice(0, 10).map(d => ({ fournisseur: d.supplier, ref: d.ref, nb: d.count, montant: d.amount })),
  }

  const response = await getClient().messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: `${PROMPT}\n\n=== SYNTHÈSE DES DÉPENSES ===\n${JSON.stringify(summary, null, 2)}` }],
  })

  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Aucun texte retourné par Claude')
  const cleaned = block.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '').trim()
  const parsed = JSON.parse(cleaned)

  return (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).slice(0, 8).map((r: any): AchatReco => ({
    title:                String(r.title || '').slice(0, 140),
    type:                 RECO_TYPES.includes(r.type) ? r.type : 'autre',
    severity:             ['high', 'medium', 'low'].includes(r.severity) ? r.severity : 'medium',
    rationale:            String(r.rationale || '').slice(0, 600),
    estimated_saving_eur: Math.max(0, Math.round(Number(r.estimated_saving_eur) || 0)),
    actions:              (Array.isArray(r.actions) ? r.actions : []).slice(0, 5).map((x: any) => String(x).slice(0, 200)),
    suppliers:            (Array.isArray(r.suppliers) ? r.suppliers : []).slice(0, 8).map((x: any) => String(x).slice(0, 80)),
  })).sort((x: AchatReco, y: AchatReco) => y.estimated_saving_eur - x.estimated_saving_eur)
}
