// ============================================================
// VERVIERS DÉPANNAGE — Enrichissement fournisseur via mails + documents (Claude)
// ------------------------------------------------------------
// Cherche le fournisseur dans les mailboxes M365, plus le contexte de ses
// factures, et laisse Claude en extraire contact / email / téléphone /
// conditions de paiement. Ne renvoie que ce qu'il trouve (null sinon).
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'
import { searchAllMailboxes, isGraphConfigured } from '@/lib/graph-mail-search'

let _client: Anthropic | null = null
const getClient = () => (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))

export interface SupplierEnrichment { email: string | null; phone: string | null; contact_name: string | null; payment_terms: string | null; source_count: number }

export async function enrichSupplier(supplierName: string, invoiceContext = ''): Promise<SupplierEnrichment> {
  let mailText = ''
  let count = 0
  if (isGraphConfigured() && supplierName) {
    try {
      const hits = await searchAllMailboxes(supplierName, 8)
      count = hits.length
      mailText = hits.map(h => `De: ${h.from}\nObjet: ${h.subject}\nExtrait: ${h.bodyPreview}`).join('\n---\n').slice(0, 12000)
    } catch { /* Graph indispo → on continue avec le contexte factures */ }
  }
  if (!mailText && !invoiceContext) return { email: null, phone: null, contact_name: null, payment_terms: null, source_count: 0 }

  const prompt = `Tu enrichis la fiche du fournisseur « ${supplierName} » pour une société de dépannage.
À partir des e-mails et du contexte de factures ci-dessous, extrait UNIQUEMENT ce qui concerne CE fournisseur (pas nos propres coordonnées « Verviers Dépannage »).
Réponds UNIQUEMENT par un objet JSON : { "email": null|"...", "phone": null|"...", "contact_name": null|"...", "payment_terms": null|"ex. 30 jours fin de mois" }
Mets null si l'info n'est pas clairement présente. N'invente rien.

=== E-MAILS ===
${mailText || '(aucun)'}

=== FACTURES ===
${invoiceContext || '(aucun)'}`

  const response = await getClient().messages.create({ model: ANTHROPIC_MODEL, max_tokens: 512, messages: [{ role: 'user', content: prompt }] })
  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') return { email: null, phone: null, contact_name: null, payment_terms: null, source_count: count }
  let p: any = {}
  try { p = JSON.parse(block.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '').trim()) } catch { /* noop */ }
  const s = (x: any) => { const v = String(x ?? '').trim(); return v && v.toLowerCase() !== 'null' ? v : null }
  return { email: s(p.email), phone: s(p.phone), contact_name: s(p.contact_name), payment_terms: s(p.payment_terms), source_count: count }
}
