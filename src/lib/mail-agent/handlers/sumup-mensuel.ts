// src/lib/mail-agent/handlers/sumup-mensuel.ts
//
// « Relevé mensuel » SumUp (Olivier 06/11/2026) : 3 PDF dans le même mail, dont une seule vraie facture, celle des
// frais. Transféré à l'encodage, chaque PDF devenait une facture et les frais prenaient le montant versé
// (5 513,75 € au lieu de 85,47 €). Seule la facture de frais est encodée, en brouillon, sans TVA, PDF joint.

import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'
import { odooRpcCompany } from '@/lib/odoo'
import { aiClient } from '@/lib/ai/usage'
import { getBusinessNumber } from '@/lib/settings/business'
import { getPdfAttachments, type AgentMessage } from '@/lib/mail-agent/graph'

export const estRelevéMensuelSumup = (msg: AgentMessage) => /relevé mensuel de vos paiements/i.test(msg.subject || '') && /sumup/i.test(`${msg.fromEmail || ''} ${(msg as any).forwardedFrom || ''}`)

export interface FraisSumup { piece: { name: string; base64: string }; numero: string; date: string; mois: string; frais: number }

/** Trouve la facture de frais parmi les PDF. null si la lecture n'est pas certaine : rien n'est alors encodé. */
export async function lireFraisSumup(mailbox: string, msg: AgentMessage): Promise<FraisSumup | null> {
  const pdfs = await getPdfAttachments(mailbox, msg.id)
  if (!pdfs.length) return null
  const client: any = aiClient('mail-agent/handlers/sumup-mensuel', { apiKey: process.env.ANTHROPIC_API_KEY! })
  const r = await client.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 200, messages: [{ role: 'user', content: [
    ...pdfs.map(p => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } })),
    { type: 'text', text: `Ces ${pdfs.length} PDF viennent de SumUp, dans l'ordre. Un seul porte le titre « Facture » avec un « Numéro de facture » : c'est la facture des frais du mois. Les autres sont des relevés. Réponds uniquement en JSON : {"index": position du PDF à partir de 0, "numero": "numéro de facture", "date": "date de la facture AAAA-MM-JJ", "mois": "mois des frais en français, ex. octobre 2026", "frais": montant de la ligne « Total » de cette facture, soit les frais SumUp, en nombre}. Jamais le total des versements.` },
  ] }] })
  const txt = String(r.content.find((x: any) => x.type === 'text')?.text || '')
  let j: any; try { j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)) } catch { return null }
  const frais = Number(j?.frais), piece = pdfs[Number(j?.index)]
  if (!piece || !(frais > 0) || !/^\S+-\d{6}$/.test(String(j?.numero || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(j?.date || '')) || !j?.mois) return null
  return { piece, numero: String(j.numero), date: String(j.date), mois: String(j.mois), frais: Math.round(frais * 100) / 100 }
}

/** Brouillon de la facture de frais, comme les mois précédents. */
export async function encoderFraisSumup(companyId: number, f: FraisSumup): Promise<number> {
  const partner = await getBusinessNumber('odoo_partner_sumup')
  const id = await odooRpcCompany<number>(companyId, 'account.move', 'create', [{
    move_type: 'in_invoice', partner_id: partner, ref: f.numero, invoice_date: f.date,
    invoice_line_ids: [[0, 0, { name: `Frais SumUp ${f.mois}`, quantity: 1, price_unit: f.frais, tax_ids: [[6, 0, []]] }]],
  }])
  const att = await odooRpcCompany<number>(companyId, 'ir.attachment', 'create', [{ name: `${f.numero}.pdf`, datas: f.piece.base64, res_model: 'account.move', res_id: id, mimetype: 'application/pdf' }])
  await odooRpcCompany(companyId, 'account.move', 'write', [[id], { message_main_attachment_id: att }])
  return id
}
