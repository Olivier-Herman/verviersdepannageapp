// src/lib/prestations/generate-pdf.ts
//
// Génère la « Feuille de présence » PDF (paysage A4) — mise en page soignée et
// aérée, dans l'esprit de la feuille EasyPay : en-tête employeur, encadré de
// validation, grille des jours espacée, week-ends teintés, total mis en valeur.

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib'

const MONTHS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const WD = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
const ABS_AB: Record<string, string> = { conge: 'C', maladie: 'M', accident: 'AT', ferie: 'F', recup: 'R', sans_solde: 'SS', petit_chomage: 'PC', chomage_temp: 'CT' }
const COMPANY: Record<string, { name: string; addr: string; onss: string }> = {
  '438':  { name: 'VERVIERS DÉPANNAGE SA', addr: 'Lefin 12 · 4860 Pepinster', onss: 'ONSS 064-1275651-84' },
  '3068': { name: 'DGJ VHU SRL', addr: '', onss: '' },
}

export interface PrestSheetRow {
  worker_name: string; matricule: string | null; qs: string | null
  days: Record<string, any>; departement: string | null
}

const daysInMonth = (period: string) => { const [y, m] = period.split('-').map(Number); return y && m ? new Date(y, m, 0).getDate() : 31 }
const dow = (period: string, d: number) => { const [y, m] = period.split('-').map(Number); return new Date(y, m - 1, d).getDay() }

export async function generatePrestationsPdf(
  period: string, companyCode: string, sheets: PrestSheetRow[],
  signedBy: string, signedDate: string, signed = false,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const N = daysInMonth(period)
  const [, m] = period.split('-').map(Number)
  const year = period.split('-')[0]
  const pageW = 842, pageH = 595, margin = 34
  const labelW = 156, totW = 42
  const gridX = margin + labelW
  const gridW = pageW - margin * 2 - labelW - totW
  const colW = gridW / N
  const rowH = 21

  const ink    = rgb(0.13, 0.13, 0.15)
  const grey   = rgb(0.5, 0.5, 0.55)
  const faint  = rgb(0.85, 0.85, 0.88)
  const wkTint = rgb(0.945, 0.95, 0.965)
  const totTint = rgb(0.96, 0.965, 0.98)
  const accent = rgb(0.8, 0.13, 0.13)
  const absCol = rgb(0.45, 0.2, 0.55)

  const co = COMPANY[companyCode] || { name: companyCode, addr: '', onss: '' }
  const centered = (p: PDFPage, txt: string, cx: number, y: number, size: number, f: PDFFont, color: any) =>
    p.drawText(txt, { x: cx - f.widthOfTextAtSize(txt, size) / 2, y, size, font: f, color })

  const headerBottom = pageH - 128           // y du bas de l'en-tête (haut du tableau)
  const drawPageHeader = (p: PDFPage) => {
    // Titre + accent
    p.drawText('FEUILLE DE PRÉSENCE', { x: margin, y: pageH - 46, size: 18, font: bold, color: ink })
    p.drawRectangle({ x: margin, y: pageH - 52, width: 168, height: 2.4, color: accent })
    p.drawText(`Période : ${MONTHS[m]} ${year}`, { x: margin, y: pageH - 68, size: 10.5, font, color: grey })
    // Bloc employeur
    p.drawText(`${co.name} (${companyCode})`, { x: margin, y: pageH - 90, size: 9.5, font: bold, color: ink })
    if (co.addr) p.drawText(co.addr, { x: margin, y: pageH - 102, size: 8, font, color: grey })
    if (co.onss) p.drawText(co.onss, { x: margin, y: pageH - 113, size: 8, font, color: grey })
    // Encadré validation (haut droite)
    const bw = 246, bh = 56, bx = pageW - margin - bw, by = pageH - 46 - bh + 12
    p.drawRectangle({ x: bx, y: by, width: bw, height: bh, borderColor: faint, borderWidth: 1, color: rgb(0.99, 0.99, 1) })
    if (signed) {
      p.drawText('VALIDÉ ÉLECTRONIQUEMENT', { x: bx + 12, y: by + bh - 18, size: 8, font: bold, color: accent })
      p.drawText(`Par ${signedBy}`, { x: bx + 12, y: by + bh - 33, size: 9, font, color: ink })
      p.drawText(`Le ${signedDate}`, { x: bx + 12, y: by + bh - 46, size: 9, font, color: ink })
    } else {
      p.drawText('POUR VALIDATION', { x: bx + 12, y: by + bh - 18, size: 8, font: bold, color: grey })
      p.drawText('Date : ......................', { x: bx + 12, y: by + bh - 34, size: 8.5, font, color: grey })
      p.drawText('Signature : ...............', { x: bx + 12, y: by + bh - 47, size: 8.5, font, color: grey })
    }

    // Bandes week-end (pleine hauteur du tableau)
    const tableH = headerBottom - 84
    for (let d = 1; d <= N; d++) {
      if (dow(period, d) === 0 || dow(period, d) === 6) {
        p.drawRectangle({ x: gridX + (d - 1) * colW, y: headerBottom - tableH, width: colW, height: tableH + 18, color: wkTint })
      }
    }
    // Bande colonne Total
    p.drawRectangle({ x: gridX + gridW, y: headerBottom - tableH, width: totW, height: tableH + 18, color: totTint })

    // En-tête colonnes
    p.drawText('TRAVAILLEUR', { x: margin, y: headerBottom + 6, size: 7, font: bold, color: grey })
    for (let d = 1; d <= N; d++) {
      const cx = gridX + (d - 1) * colW + colW / 2
      centered(p, WD[dow(period, d)], cx, headerBottom + 13, 5.5, font, grey)
      centered(p, String(d), cx, headerBottom + 5, 6.5, bold, ink)
    }
    centered(p, 'TOT.', gridX + gridW + totW / 2, headerBottom + 6, 7, bold, grey)
    p.drawLine({ start: { x: margin, y: headerBottom }, end: { x: pageW - margin, y: headerBottom }, thickness: 1, color: ink })
  }

  let page = pdf.addPage([pageW, pageH])
  drawPageHeader(page)
  let yTop = headerBottom
  const bottomLimit = 74

  sheets.forEach((s, i) => {
    if (yTop - rowH < bottomLimit) {
      page = pdf.addPage([pageW, pageH]); drawPageHeader(page); yTop = headerBottom
    }
    const yb = yTop - rowH
    // Zebra
    if (i % 2 === 1) page.drawRectangle({ x: margin, y: yb, width: pageW - margin * 2, height: rowH, color: rgb(0.975, 0.975, 0.982) })

    page.drawText((s.worker_name || '').slice(0, 28), { x: margin, y: yb + 11, size: 8, font: bold, color: ink })
    page.drawText([s.matricule && `#${s.matricule}`, s.qs && `Q/S ${s.qs}`].filter(Boolean).join('   '), { x: margin, y: yb + 3, size: 5.5, font, color: grey })

    let tot = 0
    for (let d = 1; d <= N; d++) {
      const cx = gridX + (d - 1) * colW + colW / 2
      const v = (s.days || {})[String(d)]
      if (v?.abs) centered(page, ABS_AB[v.abs] || '?', cx, yb + 7, 6.5, bold, absCol)
      else if (v?.h > 0) { centered(page, String(v.h), cx, yb + 7, 7.5, font, ink); tot += v.h }
    }
    centered(page, String(Math.round(tot)), gridX + gridW + totW / 2, yb + 7, 8, bold, ink)
    page.drawLine({ start: { x: margin, y: yb }, end: { x: pageW - margin, y: yb }, thickness: 0.4, color: faint })
    yTop -= rowH
  })

  // Légende + pied
  const legend = 'C = congé légal    M = maladie    AT = accident    F = férié    R = récup    SS = sans solde    PC = petit chômage    CT = chômage temp.'
  page.drawText(legend, { x: margin, y: 52, size: 6.5, font, color: grey })
  page.drawLine({ start: { x: margin, y: 44 }, end: { x: pageW - margin, y: 44 }, thickness: 0.5, color: faint })
  if (signed) page.drawText(`Validé électroniquement par ${signedBy} — le ${signedDate}`, { x: margin, y: 30, size: 9, font: bold, color: ink })
  else        page.drawText('Aperçu — document non validé', { x: margin, y: 30, size: 9, font: bold, color: grey })
  page.drawText('Verviers Dépannage SA · document généré par VD Soft', { x: margin, y: 19, size: 6.5, font, color: grey })

  return await pdf.save()
}
