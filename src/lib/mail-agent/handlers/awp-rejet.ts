// src/lib/mail-agent/handlers/awp-rejet.ts
//
// Handler « rejet de facture Allianz Partners / AWP (Mondial Assistance) ».
//
// DIFFÉRENCE MAJEURE AVEC IMA : le corps du mail est VIDE. Tout le contenu du
// rejet — notre numéro de facture, le dossier, la plaque, le motif et l'entité
// exigée — vit dans un PDF joint (« Rejection Invoice - <dossier>.pdf »), rédigé
// en néerlandais. On le fait donc lire par Claude, comme les réquisitoires.
//
// Le PDF type dit : « uw facturen moeten worden uitgegeven met onze juiste
// bedrijfsnaam AWP P&C S.A. Belgian branch en BTW-nummer BE0837437919 ».
//
// GARDE-FOU D'IDENTITÉ : Allianz nous met en copie de rejets qui concernent
// D'AUTRES prestataires (Rent a Car, Somja-Dubois…). Ces mails-là portent un
// numéro de facture au format « FA26-1-102852 », étranger à notre numérotation
// « AAAA/MM/NNN ». On refuse de les traiter au lieu de partir chercher une
// facture qui n'est pas la nôtre.

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'
import type { MailHandler, RejectEntity, RejectExtraction } from './types'

export const AWP_SENDERS = [
  'providers.invoices.be@allianz.com',
  'claims.be@allianz.com',
  'automotive.be@allianz.com',
  'suppliers.be@allianz.com',
]

export const AWP_DONE_FOLDER = 'MONDIAL Automatic Dispatch'

/** Notre numérotation de factures. Tout le reste appartient à quelqu'un d'autre. */
const OUR_INVOICE_RE = /\b(\d{4}\/\d{2}\/\d{3,4})\b/

let _client: Anthropic | null = null
const getClient = () => (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))

const PROMPT = `Tu lis un courrier de rejet de facture envoyé par Allianz Partners / AWP (Mondial Assistance) à un prestataire de dépannage belge. Le document est généralement en néerlandais.

Extrais UNIQUEMENT ce qui est écrit noir sur blanc. N'invente rien, ne déduis rien.

Réponds STRICTEMENT par un objet JSON :
{
  "invoice_number": "<le numéro de NOTRE facture, tel qu'écrit (champ « Factuur nummer »), ou null>",
  "amount": <montant en euros si le document le mentionne, sinon null>,
  "dossier": "<Dossiernummer / numéro de dossier, ou null>",
  "plate": "<Nummerplaat, ou null>",
  "entity_name": "<le nom d'entreprise EXACT auquel Allianz exige que la facture soit libellée, ou null>",
  "entity_vat": "<le numéro de TVA/BTW exigé, sans espaces ni points, ou null>",
  "reason": "<le motif du rejet, reformulé en une phrase courte en français>"
}

Le numéro de TVA doit être renvoyé collé, préfixe pays inclus (ex : BE0837437919).
Si le document n'exige aucune entité ni aucun numéro de TVA, mets null — ne devine pas.`

async function readPdf(base64: string): Promise<any | null> {
  const res = await getClient().messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') return null
  const raw = block.text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
  try { return JSON.parse(raw) } catch { return null }
}

export function detect(fromEmail: string, subject: string): boolean {
  if (!AWP_SENDERS.includes((fromEmail || '').toLowerCase())) return false
  return /afwijzing\s+factuur|rejet\s+de\s+facture|rejection\s+invoice/i.test(subject || '')
}

/** Le rejet porte-t-il sur une de NOS factures ? (sinon on est en simple copie) */
export function concernsUs(subject: string): boolean {
  return OUR_INVOICE_RE.test(subject || '')
}

export const awpHandler: MailHandler = {
  id:         'awp_rejet',
  label:      'Rejet de facture Allianz / AWP',
  doneFolder: AWP_DONE_FOLDER,
  detect,
  notOurs: (subject: string) => !concernsUs(subject),

  async extract({ subject, pdfs }): Promise<RejectExtraction | null> {
    // Le numéro de l'objet fait foi pour savoir si le rejet nous concerne.
    const fromSubject = subject.match(OUR_INVOICE_RE)?.[1] || null

    const files = await pdfs()
    if (!files.length) return null

    for (const f of files) {
      const parsed = await readPdf(f.base64)
      if (!parsed) continue

      const invoiceNumber = String(parsed.invoice_number || fromSubject || '').trim()
      if (!OUR_INVOICE_RE.test(invoiceNumber)) continue

      const vat = String(parsed.entity_vat || '').replace(/[\s.]/g, '').toUpperCase()
      if (!/^[A-Z]{2}\d{8,12}$/.test(vat)) continue

      const entity: RejectEntity = {
        key:     'awp_be',
        label:   String(parsed.entity_name || 'AWP P&C S.A. - Belgian Branch').slice(0, 120),
        vat,
        // Entité belge : TVA belge normale, rien à retirer.
        zeroVat: !vat.startsWith('BE'),
      }

      const amount = typeof parsed.amount === 'number' && Number.isFinite(parsed.amount)
        ? parsed.amount : null

      return {
        invoiceNumber: invoiceNumber.match(OUR_INVOICE_RE)![1],
        amount,
        entity,
        mailReference: parsed.dossier ? String(parsed.dossier).replace(/\s/g, '') : null,
        reason: String(parsed.reason || 'Facture rejetée par Allianz Partners').slice(0, 400),
      }
    }
    return null
  },
}
