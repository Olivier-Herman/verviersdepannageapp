// ============================================================
// VERVIERS DÉPANNAGE — Assistant Achats (agent conversationnel dédié)
// ------------------------------------------------------------
// Agent avec MÉMOIRE (historique persistant), CONSEIL, recherche de fournisseurs
// EN LIGNE (web_search) et dans notre base, et actions (inspecter une catégorie,
// ajouter un fournisseur au marché). Ancré sur nos données d'achat.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'
import { CATEGORIES } from './parse-invoice'

let _client: Anthropic | null = null
const getClient = () => (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))

const SYSTEM = `Tu es l'ASSISTANT ACHATS dédié de VD Soft (Verviers Dépannage, société belge de dépannage/remorquage). Tu es le conseiller achats personnel du patron, Olivier.

Ta mission : discuter de TOUT ce qui touche aux achats et l'aider à améliorer sa situation — réduire les coûts, trouver de meilleurs fournisseurs (en ligne OU physiques, proches de Verviers/Liège), comparer, négocier (sauf exceptions ci-dessous), organiser ses approvisionnements, résoudre des problèmes concrets. Tu es proactif, concret, chiffré, et tu proposes des pistes d'action.

CONTEXTE MÉTIER — RÈGLES FERMES :
- HERMAN Olivier est le PATRON ET un fournisseur interne polyvalent (il facture ses prestations). Ne produis AUCUNE recommandation le concernant : ni tarif, ni volume d'heures. Exclus-le des optimisations.

Outils :
- web_search : cherche sur le web des fournisseurs, des prix de marché, des solutions. Utilise-le dès que ça peut aider (trouver des fournisseurs près de Verviers, comparer des offres, vérifier un tarif marché). Cite ce que tu trouves.
- inspect_category : voir le détail d'une catégorie de dépense (fournisseurs, montants) avant de conseiller.
- add_market_supplier : enregistrer un fournisseur intéressant (trouvé en ligne ou suggéré) dans la base marché, pour un futur appel d'offre.

Tu as la MÉMOIRE de la conversation : réfère-toi à ce qui a été dit, assure le suivi des pistes. Réponses claires, en français, structurées mais pas verbeuses. Quand tu proposes des fournisseurs, donne nom + contact/site + pourquoi.
Catégories d'achat existantes : ${CATEGORIES.join(', ')}.`

export const ASSISTANT_TOOLS = [
  {
    name: 'inspect_category',
    description: "Détail d'une catégorie de dépense (fournisseurs, montants, libellés).",
    input_schema: { type: 'object', properties: { category: { type: 'string', enum: CATEGORIES as unknown as string[] } }, required: ['category'] },
  },
  {
    name: 'add_market_supplier',
    description: "Ajoute un fournisseur à la base marché (pour futurs appels d'offre).",
    input_schema: { type: 'object', properties: {
      name: { type: 'string' }, category: { type: 'string', enum: CATEGORIES as unknown as string[] },
      email: { type: 'string' }, phone: { type: 'string' }, website: { type: 'string' }, region: { type: 'string' }, why: { type: 'string' },
    }, required: ['name', 'category'] },
  },
] as const

export interface AssistantMsg { role: 'user' | 'assistant'; content: string }

export async function runAchatsAssistant(
  contextText: string,
  history: AssistantMsg[],
  executeTool: (name: string, input: any) => Promise<string>,
): Promise<string> {
  const convo = history.slice(-40)
  const msgs: any[] = convo.length
    ? [{ role: 'user', content: `=== CONTEXTE ACHATS (à jour) ===\n${contextText}\n\n=== MESSAGE ===\n${convo[0].content}` }, ...convo.slice(1).map(m => ({ role: m.role, content: m.content }))]
    : [{ role: 'user', content: contextText }]

  const client = getClient()
  for (let step = 0; step < 8; step++) {
    const resp = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 2500,
      system: SYSTEM,
      tools: [...ASSISTANT_TOOLS, { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] as any,
      messages: msgs,
    })
    const toolUses = resp.content.filter((b: any) => b.type === 'tool_use')
    if (resp.stop_reason === 'tool_use' && toolUses.length) {
      msgs.push({ role: 'assistant', content: resp.content })
      const results: any[] = []
      for (const tu of toolUses as any[]) {
        let out: string
        try { out = await executeTool(tu.name, tu.input) } catch (e: any) { out = `Erreur: ${e.message || e}` }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: out })
      }
      msgs.push({ role: 'user', content: results })
      continue
    }
    const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
    return text || '(pas de réponse)'
  }
  return 'Conversation trop longue à traiter d’un coup — reformule ta demande.'
}
