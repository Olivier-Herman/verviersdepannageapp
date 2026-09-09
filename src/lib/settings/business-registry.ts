// Réglages MÉTIER (lot A « admin sans valeurs en dur », Olivier 09/09/2026) :
// identifiants Odoo, boîtes mail engageantes et montants qui vivaient en dur
// dans le code. La valeur de repli est celle qui était codée ; l'écran
// /admin/settings permet de la changer sans déploiement. Fichier SANS import
// serveur : il est lu par l'écran d'admin (client) et par lib/settings/business.ts.

export type BusinessSettingKind = 'number' | 'text' | 'emails'
export interface BusinessSettingDef {
  key:      string
  label:    string
  group:    'Odoo' | 'Boîtes mail' | 'Montants'
  kind:     BusinessSettingKind
  fallback: number | string | string[]
  help?:    string
}

export const BUSINESS_SETTINGS: BusinessSettingDef[] = [
  // ── Odoo : partenaires et journaux ──────────────────────────────────────
  { key: 'odoo_partner_frais_justice',   label: 'Partenaire « Frais de Justice Verviers »', group: 'Odoo', kind: 'number', fallback: 67,   help: 'Payeur après une levée de saisie « frais de justice ».' },
  { key: 'odoo_partner_police_federale', label: 'Partenaire « Police Fédérale » (amendes)', group: 'Odoo', kind: 'number', fallback: 79 },
  { key: 'odoo_journal_achats',          label: 'Journal « Achats » (factures fournisseur)', group: 'Odoo', kind: 'number', fallback: 8 },
  { key: 'odoo_partner_spf_finances',    label: 'Partenaire « SPF Finances » (Domaine)',    group: 'Odoo', kind: 'number', fallback: 83 },
  { key: 'odoo_journal_ventes_domaine',  label: 'Journal de vente (relevé Domaine)',        group: 'Odoo', kind: 'number', fallback: 7 },
  { key: 'odoo_product_forfait',         label: 'Produit « [FORFAIT] Forfait » (relevé Domaine)', group: 'Odoo', kind: 'number', fallback: 5 },
  { key: 'odoo_tax_21',                  label: 'Taxe TVA 21 %',                            group: 'Odoo', kind: 'number', fallback: 5 },
  { key: 'odoo_partner_anwb',            label: 'Partenaire « ANWB »',                      group: 'Odoo', kind: 'number', fallback: 56 },
  { key: 'odoo_partner_sumup',           label: 'Partenaire « SumUp »',                     group: 'Odoo', kind: 'number', fallback: 1221 },
  { key: 'odoo_partner_touring',         label: 'Partenaire « Touring »',                   group: 'Odoo', kind: 'number', fallback: 14 },
  { key: 'odoo_journal_paie',            label: 'Journal des fiches de paie',               group: 'Odoo', kind: 'number', fallback: 45, help: 'Exclu des achats et des dépenses.' },
  // ── Boîtes mail qui engagent un flux ────────────────────────────────────
  { key: 'mail_parquet',            label: 'Parquet de Verviers (états de frais)',            group: 'Boîtes mail', kind: 'text', fallback: 'fdj.pplge@just.fgov.be' },
  { key: 'mail_frais_justice',      label: 'Frais de justice Verviers (saisie judiciaire)',    group: 'Boîtes mail', kind: 'text', fallback: 'frais.justice.verviers@just.fgov.be' },
  { key: 'mail_domaine_agent',      label: 'SPF Finances — Domaine (Dates IN, ventes d’épaves)', group: 'Boîtes mail', kind: 'text', fallback: 'rosemarie.lehnen@minfin.fed.be' },
  { key: 'mail_ima_avis_paiement',  label: 'IMA — avis de paiement',                          group: 'Boîtes mail', kind: 'text', fallback: 'dfc@imabenelux.com' },
  { key: 'mail_awp_avis_paiement',  label: 'Allianz — avis de paiement',                      group: 'Boîtes mail', kind: 'text', fallback: 'accountancy.be@allianz.com' },
  { key: 'mail_awp_rejets',         label: 'Allianz — expéditeurs des rejets de facture',     group: 'Boîtes mail', kind: 'emails', fallback: ['providers.invoices.be@allianz.com', 'claims.be@allianz.com', 'automotive.be@allianz.com', 'suppliers.be@allianz.com'] },
  { key: 'mail_ima_rejets',         label: 'IMA — expéditeurs des rejets de facture',         group: 'Boîtes mail', kind: 'emails', fallback: ['facturation.prestataires@ima.eu', 'hub@imabenelux.com'] },
  { key: 'touring_check_cc',        label: 'Check Touring — copie du rappel mensuel',         group: 'Boîtes mail', kind: 'emails', fallback: ['Andre.ANGELIQUE@touring.be'] },
  // ── Montants ────────────────────────────────────────────────────────────
  { key: 'forfait_parc_accident_tvac', label: 'Forfait gardiennage accident Ethias / Kaze (TVAC)', group: 'Montants', kind: 'number', fallback: 220, help: 'Écrit en HTVA sur la fiche à la coche ; les anciens dossiers gardent le leur.' },
]

export const BUSINESS_SETTING_KEYS = new Set(BUSINESS_SETTINGS.map(s => s.key))
export function businessFallback(key: string): number | string | string[] | undefined {
  return BUSINESS_SETTINGS.find(s => s.key === key)?.fallback
}
