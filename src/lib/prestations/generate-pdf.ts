// src/lib/prestations/generate-pdf.ts
//
// Génère la « Feuille de présence » PDF (paysage A4) à partir des feuilles VD Soft,
// calquée sur le format EasyPay : un travailleur par ligne, grille des jours,
// heures ou code d'absence, totaux, + mention de validation électronique (PIN).

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const MONTHS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const WD = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
const ABS_AB: Record<string, string> = { conge: 'C', maladie: 'M', accident: 'AT', ferie: 'F', recup: 'R', sans_solde: 'SS', petit_chomage: 'PC', chomage_temp: 'CT' }
const COMPANIES: Record<string, string> = { '438': 'VERVIERS DEPANNAGE SA', '3068': 'DGJ VHU SRL' }

export interface PrestSheetRow {
  worker_name: string; matricule: string | null; qs: string | null
  days: Record<string, any>; departement: string | null
}

function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number)
  return y && m ? new Date(y, m, 0).getDate() : 31
}
function dow(period: string, d: number): number {
  const [y, m] = period.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

export async function generatePrestationsPdf(period: string, companyCode: string, sheets: PrestSheetRow[], signedBy: string, signedDate: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const N = daysInMonth(period)
  const [y, m] = period.split('-').map(Number)
  const pageW = 842, pageH = 595, margin = 28
  const labelW = 140, totW = 34
  const gridW = pageW - margin * 2 - labelW - totW
  const colW = gridW / N
  const rowH = 16
  const headerTop = pageH - 92

  const ink = rgb(0.1, 0.1, 0.1), grey = rgb(0.5, 0.5, 0.5), line = rgb(0.8, 0.8, 0.8), we = rgb(0.93, 0.93, 0.93)

  let page = pdf.addPage([pageW, pageH])
  const drawHeader = (p: any) => {
    p.drawText('FEUILLE DE PRESENCE', { x: margin, y: pageH - 40, size: 15, font: bold, color: ink })
    p.drawText(`${COMPANIES[companyCode] || companyCode} (${companyCode})  —  Période : ${MONTHS[m]} ${y}`, { x: margin, y: pageH - 58, size: 10, font, color: grey })
    // en-tête colonnes
    const yTop = headerTop
    p.drawText('Travailleur', { x: margin + 2, y: yTop, size: 7, font: bold, color: grey })
    for (let d = 1; d <= N; d++) {
      const x = margin + labelW + (d - 1) * colW
      const wknd = dow(period, d) === 0 || dow(period, d) === 6
      if (wknd) p.drawRectangle({ x, y: yTop - 4, width: colW, height: rowH + 8, color: we })
      p.drawText(WD[dow(period, d)], { x: x + colW / 2 - 2, y: yTop + 8, size: 5, font, color: grey })
      p.drawText(String(d), { x: x + colW / 2 - (d >= 10 ? 4 : 2), y: yTop, size: 6, font: bold, color: ink })
    }
    p.drawText('Tot', { x: margin + labelW + gridW + 6, y: yTop, size: 7, font: bold, color: grey })
    p.drawLine({ start: { x: margin, y: yTop - 5 }, end: { x: pageW - margin, y: yTop - 5 }, thickness: 0.7, color: line })
  }
  drawHeader(page)

  let yRow = headerTop - 5 - rowH
  const bottomLimit = 70
  for (const s of sheets) {
    if (yRow < bottomLimit) {
      page = pdf.addPage([pageW, pageH]); drawHeader(page); yRow = headerTop - 5 - rowH
    }
    // libellé
    page.drawText((s.worker_name || '').slice(0, 26), { x: margin + 2, y: yRow + 4, size: 7, font: bold, color: ink })
    page.drawText([s.matricule && `#${s.matricule}`, s.qs && `Q/S ${s.qs}`].filter(Boolean).join('  '), { x: margin + 2, y: yRow - 4, size: 5, font, color: grey })
    let tot = 0
    for (let d = 1; d <= N; d++) {
      const x = margin + labelW + (d - 1) * colW
      const wknd = dow(period, d) === 0 || dow(period, d) === 6
      if (wknd) page.drawRectangle({ x, y: yRow - 6, width: colW, height: rowH, color: we })
      const v = (s.days || {})[String(d)]
      let txt = ''
      if (v?.abs) txt = ABS_AB[v.abs] || '?'
      else if (v?.h > 0) { txt = String(v.h); tot += v.h }
      if (txt) page.drawText(txt, { x: x + colW / 2 - txt.length * 1.7, y: yRow, size: 6, font, color: v?.abs ? rgb(0.55, 0.2, 0.55) : ink })
    }
    page.drawText(String(Math.round(tot)), { x: margin + labelW + gridW + 6, y: yRow, size: 7, font: bold, color: ink })
    page.drawLine({ start: { x: margin, y: yRow - 6 }, end: { x: pageW - margin, y: yRow - 6 }, thickness: 0.3, color: line })
    yRow -= rowH
  }

  // Légende + validation en bas de la dernière page
  const legend = Object.entries(ABS_AB).map(([k, ab]) => `${ab}=${k}`).join('   ')
  page.drawText(legend, { x: margin, y: 46, size: 6, font, color: grey })
  page.drawText(`Validé électroniquement par ${signedBy} — le ${signedDate}`, { x: margin, y: 30, size: 9, font: bold, color: ink })
  page.drawText('Verviers Dépannage SA · document généré par VD Soft', { x: margin, y: 18, size: 6, font, color: grey })

  return await pdf.save()
}
