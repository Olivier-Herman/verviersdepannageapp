// ============================================================
// VERVIERS DÉPANNAGE — Recommandations d'achat pilotées par Claude
// ------------------------------------------------------------
// À partir des agrégats de dépenses (analyzeAchats) + catégories IA, Claude
// produit des recommandations ACTIONNABLES : consolidation de fournisseurs,
// opportunités de négociation, anomalies de prix, doublons — chiffrées en €.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'
import { CATEGORIES } from './parse-invoice'
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

/** Synthèse compacte des dépenses (agrégats, pas de PII) — partagée reco + chat. */
export function buildAchatSummary(
  a: AchatsAnalysis,
  aiCategories: Array<{ categorie: string; amount: number }> = [],
) {
  return {
    periode_mois: a.monthsBack,
    depense_totale_htva: a.overview.totalHtva,
    nb_factures: a.overview.count,
    nb_fournisseurs: a.overview.suppliers,
    ticket_moyen: a.overview.avgTicket,
    concentration_top5_pct: a.concentrationTop5,
    top_fournisseurs: a.topSuppliers.slice(0, 15).map(s => ({ id: s.id, nom: s.name, htva: s.htva, part_pct: s.share, nb_factures: s.count })),
    depenses_par_categorie_comptable: a.byCategory.slice(0, 15),
    depenses_par_categorie_ia: aiCategories.slice(0, 15),
    tendance_mensuelle: a.byMonth,
    doublons_detectes: a.duplicates.slice(0, 10).map(d => ({ fournisseur: d.supplier, ref: d.ref, nb: d.count, montant: d.amount })),
  }
}

export async function generateAchatRecommendations(
  a: AchatsAnalysis,
  aiCategories: Array<{ categorie: string; amount: number }> = [],
): Promise<AchatReco[]> {
  const summary = buildAchatSummary(a, aiCategories)

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

export interface ChatMsg { role: 'user' | 'assistant'; content: string }

const CHAT_SYSTEM = `Tu es le DIRECTEUR ACHATS IA de VD Soft (société belge de dépannage/remorquage). Tu discutes avec le patron (Olivier) de ses dépenses fournisseurs et tu AGIS.
On te fournit la SYNTHÈSE chiffrée des dépenses (avec les id des fournisseurs) et les RECOMMANDATIONS.

Tu disposes d'OUTILS pour appliquer réellement des changements — utilise-les quand Olivier le demande (ou propose-les puis exécute s'il valide) :
- reclassify_supplier : « redispatcher » = forcer la catégorie de TOUTES les dépenses d'un fournisseur (ex. un fournisseur classé « Autre » qui est en fait du pneu → catégorie "Pneus"). Ça se répercute sur la répartition par poste.
- merge_suppliers : fusionner un fournisseur en double dans un autre (garde le principal).
- exclude_supplier : exclure un fournisseur qui n'est pas un achat (intercompagnie, remboursement…).
- ignore_vehicle : retirer un véhicule (plaque) de l'analyse coût/véhicule.

Catégories valides pour reclassify_supplier : ${CATEGORIES.join(', ')}.

Règles : identifie les fournisseurs par leur id (présent dans la synthèse). Quand une action modifie l'analyse, dis-le clairement et rappelle que le tableau se met à jour au rafraîchissement. Si un id est ambigu ou absent, demande une précision AVANT d'agir. Style : direct, concret, chiffré (€, %), français, réponses courtes.`

// Définitions d'outils exposées à Claude (exécutées côté serveur par l'appelant).
export const ACHATS_TOOLS = [
  {
    name: 'reclassify_supplier',
    description: "Redispatch : force la catégorie de TOUTES les dépenses d'un fournisseur.",
    input_schema: { type: 'object', properties: {
      supplier_id: { type: 'integer', description: 'id du fournisseur (partner_id)' },
      category:    { type: 'string', enum: CATEGORIES as unknown as string[], description: 'catégorie cible' },
    }, required: ['supplier_id', 'category'] },
  },
  {
    name: 'merge_suppliers',
    description: 'Fusionne un fournisseur (source) dans un fournisseur à garder (doublon).',
    input_schema: { type: 'object', properties: {
      source_id: { type: 'integer', description: 'id du fournisseur à fusionner (disparaît)' },
      keep_id:   { type: 'integer', description: 'id du fournisseur principal à garder' },
    }, required: ['source_id', 'keep_id'] },
  },
  {
    name: 'exclude_supplier',
    description: "Exclut un fournisseur de l'analyse (pas un achat : intercompagnie, remboursement…).",
    input_schema: { type: 'object', properties: { supplier_id: { type: 'integer' } }, required: ['supplier_id'] },
  },
  {
    name: 'ignore_vehicle',
    description: "Retire un véhicule (plaque) de l'analyse coût par véhicule.",
    input_schema: { type: 'object', properties: { plate: { type: 'string' } }, required: ['plate'] },
  },
  {
    name: 'reset_supplier_category',
    description: "Annule le redispatch d'un fournisseur (retrouve sa catégorie d'origine).",
    input_schema: { type: 'object', properties: { supplier_id: { type: 'integer' } }, required: ['supplier_id'] },
  },
] as const

/** Exécute la conversation avec outils. executeTool(name, input) applique l'action
 *  côté serveur et retourne un texte de résultat (succès/erreur). */
export async function runAchatsChat(
  summary: any,
  recos: AchatReco[],
  messages: ChatMsg[],
  executeTool: (name: string, input: any) => Promise<string>,
): Promise<{ reply: string; acted: boolean }> {
  const context = `=== SYNTHÈSE DES DÉPENSES ===\n${JSON.stringify(summary, null, 2)}\n\n=== RECOMMANDATIONS ACTUELLES ===\n${JSON.stringify(recos, null, 2)}`
  const convo = messages.slice(-16)
  const msgs: any[] = convo.length
    ? [{ role: 'user', content: `${context}\n\n---\nMessage : ${convo[0].content}` }, ...convo.slice(1).map(m => ({ role: m.role, content: m.content }))]
    : [{ role: 'user', content: context }]

  const client = getClient()
  let acted = false
  for (let step = 0; step < 6; step++) {
    const resp = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: CHAT_SYSTEM,
      tools: ACHATS_TOOLS as any,
      messages: msgs,
    })
    const toolUses = resp.content.filter((b: any) => b.type === 'tool_use')
    if (resp.stop_reason === 'tool_use' && toolUses.length) {
      msgs.push({ role: 'assistant', content: resp.content })
      const results: any[] = []
      for (const tu of toolUses as any[]) {
        acted = true
        let out: string
        try { out = await executeTool(tu.name, tu.input) } catch (e: any) { out = `Erreur: ${e.message || e}` }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: out })
      }
      msgs.push({ role: 'user', content: results })
      continue
    }
    const block = resp.content.find((b: any) => b.type === 'text') as any
    return { reply: block?.text?.trim() || '(action effectuée)', acted }
  }
  return { reply: 'Trop d’étapes enchaînées — reformule en une action précise.', acted }
}
