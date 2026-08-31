// src/lib/mail-agent/handlers/ima-rejet.ts
//
// Handler « rejet de facture IMA ».
//
// POURQUOI PAS CLAUDE ICI : ces mails sont des gabarits automatiques, toujours
// identiques au mot près. Une extraction déterministe est plus fiable ET
// gratuite. La règle de sécurité est ailleurs : tout mail qui ne correspond
// PAS exactement à un gabarit connu part en 'to_verify' pour un œil humain,
// jamais en interprétation approximative. On ne devine pas une écriture
// comptable.
//
// Trois entités destinataires possibles, et le seul discriminant FIABLE est le
// numéro de TVA cité dans la phrase de demande : le pied de page de TOUS ces
// mails dit « IMA BENELUX SA/NV », y compris quand l'entité exigée est P&V ou
// IMA Assurances. Matcher sur le nom produirait donc un faux positif
// systématique.

// Dossier Outlook où classer le mail une fois la facture retraitée.
// Olivier 2026-08-31 : « ima payement », pas « Mail auto-géré ». L'orthographe
// est celle du dossier réel (payement), la recherche est insensible à la casse.
export const IMA_DONE_FOLDER = 'ima payement'

export const IMA_SENDERS = [
  'facturation.prestataires@ima.eu',
  'hub@imabenelux.com',
]

export type ImaEntityKey = 'pv' | 'ima_fr' | 'ima_be'

export interface ImaEntity {
  key:      ImaEntityKey
  label:    string
  /** Clé de résolution de la fiche Odoo — on cherche par TVA, jamais par ID en dur. */
  vat:      string
  /** Facture hors TVA (autoliquidation intracommunautaire) : entité française. */
  zeroVat:  boolean
}

export const IMA_ENTITIES: Record<ImaEntityKey, ImaEntity> = {
  pv:     { key: 'pv',     label: 'P&V Assistance c/o IMA Benelux', vat: 'BE0402236531', zeroVat: false },
  ima_fr: { key: 'ima_fr', label: 'IMA ASSURANCES (Niort, FR)',     vat: 'FR44481511632', zeroVat: true  },
  ima_be: { key: 'ima_be', label: 'IMA BENELUX SA/NV',              vat: 'BE0474851226', zeroVat: false },
}

export interface ImaRejet {
  invoiceNumber: string
  /** Montant TTC annoncé par IMA — sert de contrôle croisé avec Odoo. */
  amount:        number | null
  entity:        ImaEntity
  /** Référence de commande/dossier citée par IMA (contrôle croisé, pas le motif). */
  mailReference: string | null
  /** Phrase de motif telle qu'IMA la formule, pour l'affichage à l'humain. */
  reason:        string
}

/** Ce mail est-il un rejet de facture IMA ? */
export function detect(fromEmail: string, subject: string): boolean {
  if (!IMA_SENDERS.includes((fromEmail || '').toLowerCase())) return false
  return /votre facture n[°o]/i.test(subject || '')
}

/** Normalise un montant « 1.051,49 » ou « 196,00 » → nombre. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * Extrait les données du rejet. Retourne null si le mail ne correspond à aucun
 * gabarit connu → l'appelant doit le classer 'to_verify'.
 */
export function extract(subject: string, text: string): ImaRejet | null {
  // ── numéro de facture : dans l'objet, et confirmé dans le corps ──
  const subjMatch = (subject || '').match(/votre facture n[°o]\s*([0-9]{4}\/[0-9]{2}\/[0-9]{3,4})/i)
  const bodyMatch = (text   || '').match(/votre facture n[°o]?\s*([0-9]{4}\/[0-9]{2}\/[0-9]{3,4})/i)
  const invoiceNumber = subjMatch?.[1] || bodyMatch?.[1]
  if (!invoiceNumber) return null

  // ── montant annoncé ──
  const amtMatch = text.match(/d['’]un montant de\s*([\d.\s]+,\d{2})\s*€/i)
  const amount = amtMatch ? parseAmount(amtMatch[1]) : null

  // ── entité exigée : UNIQUEMENT par le numéro de TVA cité dans la demande ──
  let entity: ImaEntity | null = null
  if (/0402[\s.]?236[\s.]?531/.test(text))                       entity = IMA_ENTITIES.pv
  else if (/(?:FR\s*)?44[\s.]?481[\s.]?511[\s.]?632/.test(text)) entity = IMA_ENTITIES.ima_fr
  else if (/0474[\s.]?851[\s.]?226/.test(text))                  entity = IMA_ENTITIES.ima_be
  if (!entity) return null

  // ── référence citée (contrôle croisé) ──
  const ref =
       text.match(/pour la commande\s*([A-Z0-9]+)/i)?.[1]
    || text.match(/N[°o]\s*Mandatement\s*:\s*([A-Z0-9]+)/i)?.[1]
    || text.match(/N[°o]\s*Dossier\s*:\s*([A-Z0-9]+)/i)?.[1]
    || null

  // ── motif lisible ──
  const reason =
       text.match(/^.*(?:en-?t[êe]te de la facture est incorrect).*$/im)?.[0]?.trim()
    || text.match(/^.*(?:erreur de calcul|sans TVA).*$/im)?.[0]?.trim()
    || text.match(/^.*note de cr[ée]dit.*$/im)?.[0]?.trim()
    || 'Facture rejetée par IMA'

  return { invoiceNumber, amount, entity, mailReference: ref, reason }
}
