// src/lib/odoo-attachment.ts
//
// Helper pour attacher un fichier (PDF, image, etc.) a n'importe quel
// res_model Odoo via ir.attachment + post un message au chatter avec
// le lien vers l'attachement. Idiomatique et signe par le user appelant
// (via withOdooActor).

import { odooRpc } from '@/lib/odoo'

export interface AttachInput {
  resModel:    string         // ex: 'helpdesk.ticket', 'fleet.vehicle', 'account.move'
  resId:       number
  filename:    string
  base64Data:  string          // contenu encode base64 (sans prefixe data:)
  mimetype?:   string          // default: 'application/pdf'
  description?: string         // affiche dans le chatter post (optionnel)
}

export interface AttachResult {
  attachmentId: number
  postedToChatter: boolean
}

/**
 * Attache un fichier a un enregistrement Odoo + poste un message dans le
 * chatter avec le lien vers l'attachement.
 *
 * - Utilise ir.attachment.create pour stocker le fichier.
 * - Utilise message_post avec attachment_ids pour le rendre visible dans
 *   le chatter. Si le model ne supporte pas mail.thread (peu probable pour
 *   helpdesk/fleet/account), on logge mais on ne fail pas.
 */
export async function attachToOdoo(input: AttachInput): Promise<AttachResult> {
  const { resModel, resId, filename, base64Data, mimetype = 'application/pdf', description } = input

  if (!resId) throw new Error(`attachToOdoo: resId requis pour ${resModel}`)
  if (!filename) throw new Error('attachToOdoo: filename requis')
  if (!base64Data) throw new Error('attachToOdoo: base64Data requis')

  // 1) Creer l'attachement
  const attachmentId = await odooRpc<number>('ir.attachment', 'create', [{
    name:      filename,
    type:      'binary',
    datas:     base64Data,
    res_model: resModel,
    res_id:    resId,
    mimetype,
  }])

  // 2) Poster dans le chatter (best effort)
  let postedToChatter = false
  try {
    const body = description
      ? `<p>${description}</p><p>📎 ${filename}</p>`
      : `<p>📎 ${filename}</p>`
    await odooRpc(resModel, 'message_post', [[resId]], {
      body,
      attachment_ids: [attachmentId],
    })
    postedToChatter = true
  } catch (e: any) {
    console.warn(`[odoo-attachment] message_post failed on ${resModel}#${resId}:`, e.message)
    // Pas bloquant : l'attachement existe deja dans Odoo, le post chatter
    // est juste un confort UX (lien dans le fil de discussion).
  }

  return { attachmentId, postedToChatter }
}
