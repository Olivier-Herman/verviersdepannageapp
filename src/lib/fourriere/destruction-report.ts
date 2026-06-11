// src/lib/fourriere/destruction-report.ts
//
// Helpers du process "Sortie AVP" (fourriere) :
//   - calcul des frais arretes a la date de sortie (forfait enlevement +
//     gardiennage journalier), aligne sur la logique de restitute/route.ts
//   - generation du rapport XLSX
//   - generation du rapport PDF (tampon EPAVE + date de sortie)
//
// Aucune facture n est emise : le rapport sert uniquement a informer la Ville
// de Verviers des dossiers clotures. Les frais sont indicatifs (a la date de
// sortie), pas factures.

import * as XLSX from 'xlsx'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import {
  Document, Page, Text, View, StyleSheet,
} from '@react-pdf/renderer'

// Tarifs alignes sur src/app/api/missions/[id]/restitute/route.ts
export const AVP_FORFAIT_HTVA      = 165.29   // forfait enlevement AVP (= 200 EUR TVAC)
export const GARDIENNAGE_PRICE_HTVA = 20      // EUR/jour
const TVA_RATE = 0.21

export interface DestructionVehicle {
  plate:        string | null
  brand:        string | null
  model:        string | null
  vin:          string | null
  zone:         string | null
  row:          number | null
  slot:         number | null
  entryIso:     string | null   // date d entree en parc
  exitIso:      string          // date de sortie (= now au moment de la destruction)
}

export interface DestructionFees {
  days:         number
  forfaitHtva:  number
  gardienHtva:  number
  totalHtva:    number
  totalTvac:    number
}

/** Jours de gardiennage : 1 jour par 24h ecoulee (aligne restitute). */
export function computeGardiennageDays(entryIso: string | null, exitIso: string): number {
  if (!entryIso) return 0
  const entry = new Date(entryIso).getTime()
  const exit  = new Date(exitIso).getTime()
  if (!isFinite(entry) || !isFinite(exit) || exit < entry) return 0
  return Math.floor((exit - entry) / (24 * 60 * 60 * 1000))
}

/** Frais arretes a la date de sortie : forfait AVP + gardiennage journalier. */
export function computeDestructionFees(entryIso: string | null, exitIso: string): DestructionFees {
  const days        = computeGardiennageDays(entryIso, exitIso)
  const gardienHtva = days * GARDIENNAGE_PRICE_HTVA
  const totalHtva   = AVP_FORFAIT_HTVA + gardienHtva
  const totalTvac   = totalHtva * (1 + TVA_RATE)
  return {
    days,
    forfaitHtva: AVP_FORFAIT_HTVA,
    gardienHtva,
    totalHtva:   Number(totalHtva.toFixed(2)),
    totalTvac:   Number(totalTvac.toFixed(2)),
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return iso }
}

function fmtEur(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

// ─── XLSX ────────────────────────────────────────────────────────────────
export function buildDestructionXlsx(vehicles: DestructionVehicle[]): Buffer {
  const wb = XLSX.utils.book_new()
  const rows: any[][] = []

  rows.push(['VERVIERS DEPANNAGE SA — Sortie AVP / Mise en epave'])
  rows.push([])
  rows.push(['Date du rapport :', fmtDate(new Date().toISOString())])
  rows.push(['Total vehicules :', vehicles.length])
  rows.push([])

  rows.push([
    'Plaque', 'Marque', 'Modele', 'VIN', 'Emplacement',
    'Date entree', 'Date sortie', 'Jours parc',
    'Forfait HTVA', 'Gardiennage HTVA', 'Total HTVA', 'Total TVAC',
  ])

  let sumTvac = 0
  for (const v of vehicles) {
    const fees = computeDestructionFees(v.entryIso, v.exitIso)
    sumTvac += fees.totalTvac
    rows.push([
      v.plate || 'SANS PLAQUE',
      v.brand || '',
      v.model || '',
      v.vin || '',
      `${v.zone || '?'}${v.row || ''}${v.slot != null ? '-' + v.slot : ''}`,
      fmtDate(v.entryIso),
      fmtDate(v.exitIso),
      fees.days,
      Number(fees.forfaitHtva.toFixed(2)),
      Number(fees.gardienHtva.toFixed(2)),
      fees.totalHtva,
      fees.totalTvac,
    ])
  }

  rows.push([])
  rows.push(['', '', '', '', '', '', '', '', '', '', 'TOTAL TVAC', Number(sumTvac.toFixed(2))])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [
    { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 10 },
    { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(wb, ws, 'Sortie AVP')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

// ─── PDF ─────────────────────────────────────────────────────────────────
const COLOR_BRAND  = '#E11D2E'
const COLOR_INK    = '#0F172A'
const COLOR_MUTED  = '#64748B'
const COLOR_BORDER = '#E2E8F0'
const COLOR_BG     = '#F8FAFC'

const pdfStyles = StyleSheet.create({
  page:      { padding: 28, fontSize: 8, fontFamily: 'Helvetica', color: COLOR_INK },
  headerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 14, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: COLOR_BRAND,
  },
  brand:    { fontSize: 14, fontWeight: 700, color: COLOR_BRAND, marginBottom: 2 },
  brandSub: { fontSize: 8, color: COLOR_MUTED },
  docTitle: { fontSize: 12, fontWeight: 700, marginBottom: 2 },
  docMeta:  { fontSize: 8, color: COLOR_MUTED, lineHeight: 1.3, textAlign: 'right' },
  stamp: {
    alignSelf: 'flex-start', marginBottom: 12,
    paddingVertical: 4, paddingHorizontal: 10,
    borderWidth: 2, borderColor: COLOR_BRAND, borderRadius: 4,
    color: COLOR_BRAND, fontSize: 13, fontWeight: 700, letterSpacing: 1,
  },
  th: {
    flexDirection: 'row', backgroundColor: COLOR_BG,
    borderBottomWidth: 1, borderBottomColor: COLOR_BORDER,
    paddingVertical: 4, paddingHorizontal: 3,
  },
  tr: {
    flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLOR_BORDER,
    paddingVertical: 4, paddingHorizontal: 3,
  },
  thText: { fontSize: 7, fontWeight: 700, color: COLOR_MUTED, textTransform: 'uppercase' },
  cell:   { fontSize: 8 },
  cPlate: { width: '13%', fontWeight: 700 },
  cVeh:   { width: '22%' },
  cEmpl:  { width: '11%' },
  cIn:    { width: '13%' },
  cOut:   { width: '13%' },
  cDays:  { width: '8%', textAlign: 'right' },
  cFees:  { width: '20%', textAlign: 'right' },
  footer: {
    position: 'absolute', bottom: 18, left: 28, right: 28,
    flexDirection: 'row', justifyContent: 'space-between',
    fontSize: 7, color: COLOR_MUTED, borderTopWidth: 1, borderTopColor: COLOR_BORDER, paddingTop: 6,
  },
})

interface PdfRow {
  plate: string; veh: string; empl: string; entree: string; sortie: string; days: number; tvac: string
}

function DestructionPdfDoc({ rows, exitDate, totalTvac }: { rows: PdfRow[]; exitDate: string; totalTvac: string }) {
  return React.createElement(
    Document, null,
    React.createElement(
      Page, { size: 'A4', style: pdfStyles.page },
      // Header
      React.createElement(
        View, { style: pdfStyles.headerRow },
        React.createElement(
          View, null,
          React.createElement(Text, { style: pdfStyles.brand }, 'VERVIERS DÉPANNAGE'),
          React.createElement(Text, { style: pdfStyles.brandSub }, 'Lefin 12 · 4860 Pepinster · TVA BE0460.759.205'),
        ),
        React.createElement(
          View, null,
          React.createElement(Text, { style: pdfStyles.docTitle }, 'Sortie AVP'),
          React.createElement(Text, { style: pdfStyles.docMeta }, `Mise en épave du ${exitDate}\n${rows.length} véhicule${rows.length > 1 ? 's' : ''}`),
        ),
      ),
      // Tampon EPAVE
      React.createElement(Text, { style: pdfStyles.stamp }, `ÉPAVE — ${exitDate}`),
      // Tableau header
      React.createElement(
        View, { style: pdfStyles.th },
        React.createElement(Text, { style: [pdfStyles.thText, pdfStyles.cPlate] }, 'Plaque'),
        React.createElement(Text, { style: [pdfStyles.thText, pdfStyles.cVeh] }, 'Véhicule / VIN'),
        React.createElement(Text, { style: [pdfStyles.thText, pdfStyles.cEmpl] }, 'Empl.'),
        React.createElement(Text, { style: [pdfStyles.thText, pdfStyles.cIn] }, 'Entrée'),
        React.createElement(Text, { style: [pdfStyles.thText, pdfStyles.cOut] }, 'Sortie'),
        React.createElement(Text, { style: [pdfStyles.thText, pdfStyles.cDays] }, 'Jours'),
        React.createElement(Text, { style: [pdfStyles.thText, pdfStyles.cFees] }, 'Frais TVAC'),
      ),
      // Lignes
      ...rows.map((r, i) => React.createElement(
        View, { style: pdfStyles.tr, key: String(i) },
        React.createElement(Text, { style: [pdfStyles.cell, pdfStyles.cPlate] }, r.plate),
        React.createElement(Text, { style: [pdfStyles.cell, pdfStyles.cVeh] }, r.veh),
        React.createElement(Text, { style: [pdfStyles.cell, pdfStyles.cEmpl] }, r.empl),
        React.createElement(Text, { style: [pdfStyles.cell, pdfStyles.cIn] }, r.entree),
        React.createElement(Text, { style: [pdfStyles.cell, pdfStyles.cOut] }, r.sortie),
        React.createElement(Text, { style: [pdfStyles.cell, pdfStyles.cDays] }, String(r.days)),
        React.createElement(Text, { style: [pdfStyles.cell, pdfStyles.cFees] }, r.tvac),
      )),
      // Total
      React.createElement(
        View, { style: [pdfStyles.tr, { borderBottomWidth: 0, marginTop: 4 }] },
        React.createElement(Text, { style: [pdfStyles.cell, { width: '80%', fontWeight: 700, textAlign: 'right', paddingRight: 6 }] }, 'TOTAL TVAC'),
        React.createElement(Text, { style: [pdfStyles.cell, pdfStyles.cFees, { fontWeight: 700 }] }, totalTvac),
      ),
      // Footer
      React.createElement(
        View, { style: pdfStyles.footer, fixed: true },
        React.createElement(Text, null, 'Rapport généré par VD Soft — aucune facture émise, dossiers clôturés.'),
        React.createElement(Text, null, `Édité le ${fmtDate(new Date().toISOString())}`),
      ),
    ),
  )
}

export async function buildDestructionPdf(vehicles: DestructionVehicle[]): Promise<Buffer> {
  const exitDate = fmtDate(vehicles[0]?.exitIso || new Date().toISOString())
  let sumTvac = 0
  const rows: PdfRow[] = vehicles.map(v => {
    const fees = computeDestructionFees(v.entryIso, v.exitIso)
    sumTvac += fees.totalTvac
    return {
      plate:  v.plate || 'SANS PLAQUE',
      veh:    [v.brand, v.model].filter(Boolean).join(' ') + (v.vin ? `\n${v.vin}` : ''),
      empl:   `${v.zone || '?'}${v.row || ''}${v.slot != null ? '-' + v.slot : ''}`,
      entree: fmtDate(v.entryIso),
      sortie: fmtDate(v.exitIso),
      days:   fees.days,
      tvac:   fmtEur(fees.totalTvac),
    }
  })
  const doc = DestructionPdfDoc({ rows, exitDate, totalTvac: fmtEur(Number(sumTvac.toFixed(2))) })
  return await renderToBuffer(doc as any)
}
