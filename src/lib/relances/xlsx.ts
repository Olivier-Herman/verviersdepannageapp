// ============================================================
// Module Relance — Generateur XLSX (SheetJS)
// ============================================================
// Format technique pour la compta : 1 sheet "Relance" avec entete
// (client + ref + date + niveau + total) puis tableau des factures.
//
// Volontairement sobre — pas de couleurs ni styles complexes (la lib
// xlsx community ne supporte pas les styles cell-by-cell de toute facon
// sans la version pro). L objectif est l export brut exploitable par
// la compta dans Excel/LibreOffice.

import * as XLSX from 'xlsx'
import type { OverdueInvoice, ReminderLevel } from './odoo'

interface XlsxData {
  level:        ReminderLevel
  partnerName:  string
  partnerRef:   string | null
  partnerVat:   string | null
  invoices:     OverdueInvoice[]
  totalDue:     number
  reference:    string
  sentDate:     string  // YYYY-MM-DD
}

const LEVEL_LABEL: Record<ReminderLevel, string> = {
  1: 'L1 — Rappel amical',
  2: 'L2 — Relance',
  3: 'L3 — Mise en demeure',
}

// Format date YYYY-MM-DD -> DD/MM/YYYY pour l affichage Excel
// (Excel pourrait re-typer la chaine en date, on laisse comme texte
// pour rester deterministe entre OS/locales).
function formatDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function generateReminderXlsx(data: XlsxData): Buffer {
  const { level, partnerName, partnerRef, partnerVat, invoices, totalDue, reference, sentDate } = data

  const wb = XLSX.utils.book_new()

  // Construction matricielle row-by-row : entete texte libre + tableau factures.
  // On part d un AOA (array of arrays), c est le plus lisible et previsible.
  const rows: any[][] = []

  // ── Entete metadata ──
  rows.push(['VERVIERS DEPANNAGE SA — Relance Client'])
  rows.push([])
  rows.push(['Niveau :',     LEVEL_LABEL[level]])
  rows.push(['Reference :',  reference])
  rows.push(['Date :',       formatDate(sentDate)])
  rows.push([])
  rows.push(['Client :',     partnerName])
  if (partnerRef) rows.push(['Ref client :', partnerRef])
  if (partnerVat) rows.push(['TVA client :', partnerVat])
  rows.push([])

  // ── Tableau factures ──
  rows.push([
    'N° facture', 'Date facture', 'Echeance',
    'Jours retard', 'Plaque', 'Vehicule',
    'Montant TVAC', 'Reste du', 'Niveau',
  ])

  for (const inv of invoices) {
    rows.push([
      inv.name,
      formatDate(inv.invoiceDate),
      inv.dueDate ? formatDate(inv.dueDate) : '',
      inv.dueDate ? inv.daysOverdue : '',
      inv.plate || '',
      inv.vehicleLabel || '',
      Number(inv.amountTotal.toFixed(2)),
      Number(inv.amountResidual.toFixed(2)),
      `L${inv.level}`,
    ])
  }

  rows.push([])
  rows.push([
    'TOTAL',                        // colonne A
    '', '', '', '', '',              // B-F
    '',                              // G : Mt TVAC du total non sommé (compta peut le faire)
    Number(totalDue.toFixed(2)),    // H : reste du total
    '',                              // I
  ])

  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Largeurs de colonnes pour eviter le tronquage a l ouverture
  ws['!cols'] = [
    { wch: 16 },   // N° facture
    { wch: 12 },   // Date facture
    { wch: 12 },   // Echeance
    { wch: 12 },   // Jours retard
    { wch: 12 },   // Plaque
    { wch: 22 },   // Vehicule
    { wch: 14 },   // Mt TVAC
    { wch: 14 },   // Reste du
    { wch: 6 },    // Niveau
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'Relance')

  // Ecriture en buffer (compatible Node.js, pas browser)
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return buf
}

// Mock data symetrique au PDF mock (Touring Belgium SA, 3 factures)
export function buildMockXlsxData(level: ReminderLevel, pdfMock: {
  partner: { name: string; ref: string | null; vat: string | null }
  invoices: OverdueInvoice[]
  totalDue: number
  reference: string
  sentDate: string
}): XlsxData {
  return {
    level,
    partnerName: pdfMock.partner.name,
    partnerRef:  pdfMock.partner.ref,
    partnerVat:  pdfMock.partner.vat,
    invoices:    pdfMock.invoices,
    totalDue:    pdfMock.totalDue,
    reference:   pdfMock.reference,
    sentDate:    pdfMock.sentDate,
  }
}
