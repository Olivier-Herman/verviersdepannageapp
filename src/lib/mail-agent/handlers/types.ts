// src/lib/mail-agent/handlers/types.ts
//
// Contrat commun aux handlers de « rejet de facture ». Chaque assisteur rejette
// pour ses propres raisons et dans sa propre langue, mais le geste comptable est
// toujours le même : extourner, refacturer à l'entité qu'il exige.
//
// Ajouter un assisteur = ajouter un handler ici, pas toucher à l'orchestrateur.

export interface RejectEntity {
  /** Identifiant court, stocké dans l'item pour rejouer l'application. */
  key:     string
  /** Libellé lisible, affiché à l'humain. */
  label:   string
  /** Clé de résolution de la fiche Odoo — on cherche par TVA, jamais par ID en dur. */
  vat:     string
  /** Facture hors TVA (autoliquidation intracommunautaire). */
  zeroVat: boolean
}

export interface RejectExtraction {
  /** Notre numéro de facture, tel qu'il apparaît chez l'assisteur. */
  invoiceNumber: string
  /** Montant annoncé — contrôle croisé avec Odoo. null si absent du document. */
  amount:        number | null
  entity:        RejectEntity
  /** Référence de dossier citée par l'assisteur (contrôle croisé, pas le motif). */
  mailReference: string | null
  /** Motif tel que l'assisteur le formule, pour l'affichage. */
  reason:        string
}

export interface MailHandler {
  /** Valeur stockée dans mail_agent_items.handler. */
  id:         string
  /** Libellé affiché. */
  label:      string
  /** Dossier Outlook où classer le mail une fois traité. */
  doneFolder: string
  /** Ce mail relève-t-il de ce handler ? */
  detect:     (fromEmail: string, subject: string) => boolean
  /**
   * Analyse le mail. Reçoit le corps en texte et un accès paresseux aux PJ PDF
   * (Allianz met tout dans le PDF, IMA tout dans le corps).
   * Retourne null si le document n'est pas exploitable avec certitude →
   * l'orchestrateur classera l'item en 'to_verify'.
   */
  /**
   * Optionnel : le rejet porte-t-il sur la facture de QUELQU'UN D'AUTRE ?
   * Allianz nous met en copie de rejets destinés à d'autres prestataires.
   */
  notOurs?:   (subject: string) => boolean
  extract:    (input: {
    subject: string
    text:    string
    pdfs:    () => Promise<{ name: string; base64: string }[]>
  }) => Promise<RejectExtraction | null>
}
