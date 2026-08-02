// ============================================================
// VERVIERS DÉPANNAGE — Extraction & comparaison de DEVIS fournisseurs (Claude)
// ------------------------------------------------------------
// parseQuoteDoc : lit un devis (PDF) et en extrait une structure normalisée.
// compareQuotes : départage plusieurs devis d'un même besoin.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

let _client: Anthropic | null = null
const getClient = () => (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))

export interface QuoteItem { description: string; qty: number | null; unit_price: number | null; total: number | null }
export interface ParsedQuote {
  supplier_name: string
  total_htva:    number | null
  currency:      string
  delivery_days: number | null
  payment_terms: string | null
  validity:      string | null
  items:         QuoteItem[]
  summary:       string
}

const PARSE_PROMPT = `Tu analyses un DEVIS fournisseur (PDF) pour une société de dépannage/remorquage.
Extrait les infos de façon fiable. Réponds UNIQUEMENT par un objet JSON valide (aucun texte autour) :
{
  "supplier_name": "<nom du fournisseur qui émet le devis>",
  "total_htva": <total HORS TVA en nombre, null si absent>,
  "currency": "<devise, ex. EUR>",
  "delivery_days": <délai de livraison/exécution en JOURS (nombre), null si non précisé>,
  "payment_terms": "<conditions de paiement, null si absent>",
  "validity": "<durée de validité du devis, null si absent>",
  "items": [
    { "description": "<ligne>", "qty": <quantité ou null>, "unit_price": <prix unitaire HTVA ou null>, "total": <total ligne HTVA ou null> }
  ],
  "summary": "<1 phrase: ce qui est proposé>"
}
Si le total HTVA n'est pas explicite mais que le TVAC et le taux le sont, calcule le HTVA. N'invente rien : mets null si absent.`

export async function parseQuoteDoc(opts: { docBase64: string; mimetype: string }): Promise<ParsedQuote> {
  const content: any[] = []
  if (opts.mimetype.includes('pdf')) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: opts.docBase64 } })
  } else {
    let text = ''
    try { text = Buffer.from(opts.docBase64, 'base64').toString('utf8') } catch { text = '' }
    content.push({ type: 'text', text: `Document (${opts.mimetype}) :\n${text.slice(0, 20000)}` })
  }
  content.push({ type: 'text', text: PARSE_PROMPT })

  const response = await getClient().messages.create({ model: ANTHROPIC_MODEL, max_tokens: 2048, messages: [{ role: 'user', content }] })
  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Aucun texte retourné par Claude')
  const parsed = JSON.parse(block.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '').trim())
  const num = (x: any) => { const n = Number(x); return isFinite(n) ? n : null }
  return {
    supplier_name: String(parsed.supplier_name || 'Fournisseur inconnu').slice(0, 120),
    total_htva:    num(parsed.total_htva),
    currency:      String(parsed.currency || 'EUR').slice(0, 8),
    delivery_days: parsed.delivery_days != null ? Math.round(Number(parsed.delivery_days)) || null : null,
    payment_terms: parsed.payment_terms ? String(parsed.payment_terms).slice(0, 200) : null,
    validity:      parsed.validity ? String(parsed.validity).slice(0, 120) : null,
    items:         (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 40).map((i: any) => ({
      description: String(i.description || '').slice(0, 200), qty: num(i.qty), unit_price: num(i.unit_price), total: num(i.total),
    })),
    summary:       String(parsed.summary || '').slice(0, 300),
  }
}

export async function compareQuotes(label: string, quotes: Array<ParsedQuote & { id: string }>): Promise<string> {
  const compact = quotes.map(q => ({ id: q.id, fournisseur: q.supplier_name, total_htva: q.total_htva, delai_jours: q.delivery_days, paiement: q.payment_terms, validite: q.validity, nb_lignes: q.items.length, resume: q.summary }))
  const prompt = `Tu es acheteur pour une société de dépannage/remorquage. Compare ces devis pour le besoin : « ${label} ».
Devis :
${JSON.stringify(compact, null, 2)}

Donne une reco COURTE et actionnable en français :
- Le meilleur choix et POURQUOI (prix, délai, conditions), chiffré (écart en € et %).
- Les points d'attention (devis incomplet, délai long, écart de périmètre si les lignes ne semblent pas comparables).
- Une phrase de conclusion « je prendrais X ».
Pas de JSON, juste le texte.`
  const response = await getClient().messages.create({ model: ANTHROPIC_MODEL, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
  const block = response.content.find(b => b.type === 'text')
  return block && block.type === 'text' ? block.text.trim() : '(pas de recommandation)'
}
