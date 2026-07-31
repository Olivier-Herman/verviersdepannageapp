// ============================================================
// VERVIERS DÉPANNAGE — Catégorisation IA des factures fournisseurs
// ------------------------------------------------------------
// Parse le DOCUMENT d'une facture (PDF ou XML e-invoicing) avec Claude et en
// déduit DE QUOI IL S'AGIT : catégorie normalisée + résumé + lignes.
// On ne se fie PAS aux comptes comptables Odoo (trop grossiers).
// Modèle : ANTHROPIC_MODEL centralisé (Opus 4.8) — cohérent avec l'app.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

// Taxonomie fermée (dépannage / garage). L'IA DOIT choisir dans cette liste.
export const CATEGORIES = [
  'Carburant',
  'Sous-traitance dépannage',
  'Pièces & fournitures véhicules',
  'Pneus',
  'Entretien & réparation véhicules',
  'Achat & location véhicules',
  'Assurances',
  'Télécom & informatique',
  'Énergie',
  'Loyers & immobilier',
  'Frais bancaires & financiers',
  'Honoraires & services externes',
  'Charges sociales & salaires',
  'Taxes & redevances',
  'Petit matériel & fournitures',
  'Publicité & marketing',
  'Autre',
] as const

let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  return _client
}

const PROMPT = `Tu es analyste achats pour une société de DÉPANNAGE / REMORQUAGE automobile (VD Soft — Verviers Dépannage).
On te donne le document d'une FACTURE FOURNISSEUR (PDF ou XML e-facture). Détermine DE QUOI IL S'AGIT.

Réponds UNIQUEMENT par un objet JSON valide (aucun texte autour), structure EXACTE :
{
  "categorie": "<une valeur EXACTE de la liste ci-dessous>",
  "sous_categorie": "<précision courte, ex: 'Diesel', 'Pneus hiver', 'Assurance flotte'>",
  "resume": "<1 phrase: ce qui a été acheté>",
  "items": [ { "description": "<ligne>", "montant": <number HTVA ou null> } ],
  "confidence": <0..1>
}

CATÉGORIES AUTORISÉES (choisir la plus proche, sinon "Autre") :
${CATEGORIES.map(c => `- ${c}`).join('\n')}

Règles :
- "Charges sociales & salaires" (ONSS, précompte, secrétariat social) = une DÉPENSE normale, catégorise-la ainsi (ne l'écarte pas).
- "Sous-traitance dépannage" = un autre dépanneur/remorqueur qui a réalisé une intervention pour nous.
- items : garde 1 à 6 lignes principales max. montant en HTVA si visible, sinon null.
- Sois concis. Si le document est illisible, mets confidence bas et categorie "Autre".`

export interface Categorization {
  categorie: string
  sous_categorie: string | null
  resume: string | null
  items: Array<{ description: string; montant: number | null }>
  confidence: number
}

/**
 * Envoie le document (base64) à Claude et renvoie la catégorisation.
 * mimetype : 'application/pdf' → bloc document ; sinon (XML/texte) → texte décodé.
 */
export async function categorizeInvoiceDoc(opts: {
  supplierName: string
  ref?: string | null
  amountHtva?: number | null
  docBase64: string
  mimetype: string
}): Promise<Categorization> {
  const client = getClient()
  const ctx = `Fournisseur: ${opts.supplierName}${opts.ref ? ` · Réf: ${opts.ref}` : ''}${opts.amountHtva != null ? ` · Total HTVA: ${opts.amountHtva} €` : ''}`

  const content: any[] = []
  if (opts.mimetype.includes('pdf')) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: opts.docBase64 } })
  } else {
    // XML / texte : on décode et on tronque (les UBL/Peppol sont verbeux).
    let text = ''
    try { text = Buffer.from(opts.docBase64, 'base64').toString('utf8') } catch { text = '' }
    content.push({ type: 'text', text: `Document (${opts.mimetype}) :\n${text.slice(0, 20000)}` })
  }
  content.push({ type: 'text', text: `${PROMPT}\n\nContexte : ${ctx}` })

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  })

  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Aucun texte retourné par Claude')
  const cleaned = block.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '').trim()
  const parsed = JSON.parse(cleaned)

  // Normalise la catégorie sur la taxonomie fermée.
  const cat = (CATEGORIES as readonly string[]).includes(parsed.categorie) ? parsed.categorie : 'Autre'
  return {
    categorie: cat,
    sous_categorie: parsed.sous_categorie || null,
    resume: parsed.resume || null,
    items: Array.isArray(parsed.items) ? parsed.items.slice(0, 6) : [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
  }
}
