// ============================================================
// Module Relance — Transformer group Odoo -> PdfData / XlsxData
// ============================================================
// Centralise la logique de mapping entre la donnee brute Odoo
// (PartnerOverdueGroup retourne par le helper) et les structures
// attendues par les generateurs PDF / XLSX. Permet aux routes
// preview / send de rester courtes et previsibles.

import type { PartnerOverdueGroup, ReminderLevel } from './odoo'

interface PdfPartner {
  name:    string
  ref:     string | null
  email:   string | null
  vat:     string | null
  street:  string | null
  zip:     string | null
  city:    string | null
  country: string | null
}

interface PdfData {
  level:     ReminderLevel
  partner:   PdfPartner
  invoices:  PartnerOverdueGroup['invoices']
  totalDue:  number
  reference: string
  sentDate:  string
}

interface XlsxData {
  level:        ReminderLevel
  partnerName:  string
  partnerRef:   string | null
  partnerVat:   string | null
  invoices:     PartnerOverdueGroup['invoices']
  totalDue:     number
  reference:    string
  sentDate:     string
}

/**
 * Genere une reference relance unique, format REL-YYYYMMDD-LX-<partnerId>.
 * Stable pour un meme client + meme jour + meme niveau (utile pour le
 * suivi & deduplication, et comme communication structuree IBAN).
 */
export function buildReminderReference(opts: {
  partnerId: number
  level:     ReminderLevel
  date?:     string  // YYYY-MM-DD, default = today
}): string {
  const d = (opts.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '')
  return `REL-${d}-L${opts.level}-${opts.partnerId}`
}

export function groupToPdfData(group: PartnerOverdueGroup, level: ReminderLevel, ref: string, sentDate: string): PdfData {
  return {
    level,
    partner: {
      name:    group.partnerName,
      ref:     group.partnerRef,
      email:   group.partnerEmail,
      vat:     group.partnerVat,
      street:  group.partnerStreet,
      zip:     group.partnerZip,
      city:    group.partnerCity,
      country: group.partnerCountry,
    },
    invoices:  group.invoices,
    totalDue:  group.totalResidual,
    reference: ref,
    sentDate,
  }
}

export function groupToXlsxData(group: PartnerOverdueGroup, level: ReminderLevel, ref: string, sentDate: string): XlsxData {
  return {
    level,
    partnerName: group.partnerName,
    partnerRef:  group.partnerRef,
    partnerVat:  group.partnerVat,
    invoices:    group.invoices,
    totalDue:    group.totalResidual,
    reference:   ref,
    sentDate,
  }
}
