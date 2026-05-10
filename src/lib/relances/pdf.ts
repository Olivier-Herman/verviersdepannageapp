// ============================================================
// Module Relance — Générateur PDF Puppeteer
// ============================================================
// Pipeline : template HTML inline -> page.setContent -> page.pdf()
// Format A4, marges 18mm, polices web-safe (pas de font fetch externe pour
// rester offline-friendly et reproductible).
//
// En local dev (Mac), on utilise le Chrome systeme (~/Applications) ;
// sur Vercel, on utilise @sparticuz/chromium (binary serverless prebuilt).
// Le switch se fait via process.env.VERCEL_ENV (defini par Vercel).

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { COMPANY }       from '@/config/company'
import type { OverdueInvoice, ReminderLevel } from './odoo'

interface PartnerForPdf {
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
  partner:   PartnerForPdf
  invoices:  OverdueInvoice[]
  totalDue:  number
  reference: string  // ex "REL-20260510-0042"
  sentDate:  string  // YYYY-MM-DD
}

// Petites helpers de format pour le HTML (pas de date-fns ni Intl côté
// rendering — on reste compact et déterministe).
function formatEur(n: number): string {
  return new Intl.NumberFormat('fr-BE', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2,
  }).format(n)
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[c]!))
}

const LEVEL_TITLES: Record<ReminderLevel, string> = {
  1: 'Rappel amical',
  2: 'Relance — second rappel',
  3: 'Mise en demeure',
}

// Phrasing pre-validation Olivier — Phase 1.
const LEVEL_INTROS: Record<ReminderLevel, string> = {
  1: `Sauf erreur de notre part, nos services constatent que le ou les factures reprises ci-dessous, dont la date d'échéance est dépassée, restent impayées à ce jour. Nous vous remercions de bien vouloir procéder au règlement dans les meilleurs délais.`,
  2: `Nous attirons à nouveau votre attention sur le fait que la ou les factures reprises ci-dessous restent impayées malgré notre précédent rappel. Nous vous prions de procéder au règlement sous huitaine à compter de la présente.`,
  3: `Malgré nos précédents rappels, nous constatons que la ou les factures reprises ci-dessous demeurent impayées à ce jour. Conformément à nos conditions générales de vente, nous vous mettons en demeure de procéder au règlement intégral du solde dû sous quinze jours à dater de la présente, sous peine de poursuites judiciaires sans nouvel avis et de l'application des intérêts de retard et de l'indemnité forfaitaire prévus contractuellement.`,
}

function renderInvoiceRows(invoices: OverdueInvoice[]): string {
  return invoices.map(inv => `
    <tr>
      <td>${escapeHtml(inv.name)}</td>
      <td>${formatDate(inv.invoiceDate)}</td>
      <td>${formatDate(inv.dueDate)}</td>
      <td class="num">${inv.daysOverdue}</td>
      <td class="num">${formatEur(inv.amountTotal)}</td>
      <td class="num strong">${formatEur(inv.amountResidual)}</td>
    </tr>
  `).join('')
}

function buildHtml(data: PdfData): string {
  const { level, partner, invoices, totalDue, reference, sentDate } = data
  const title = LEVEL_TITLES[level]
  const intro = LEVEL_INTROS[level]

  const partnerAddrLines = [
    partner.street,
    [partner.zip, partner.city].filter(Boolean).join(' '),
    partner.country,
  ].filter(Boolean).map(l => escapeHtml(l!)).join('<br/>')

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} — ${escapeHtml(reference)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 11pt; color: #1a1a1a; margin: 0; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28pt; }
    .company { font-size: 10pt; line-height: 1.45; }
    .company .name { font-weight: 700; font-size: 12pt; color: #C8102E; margin-bottom: 4pt; }
    .recipient { margin-left: auto; min-width: 260pt; max-width: 280pt; font-size: 10pt; line-height: 1.45; padding: 8pt 10pt; border: 1px solid #ddd; border-radius: 3pt; background: #fafafa; }
    .recipient .name { font-weight: 600; }
    .meta { display: flex; justify-content: space-between; margin: 18pt 0; font-size: 10pt; color: #555; }
    h1 { font-size: 18pt; margin: 8pt 0 16pt; color: #1a1a1a; border-left: 4pt solid #C8102E; padding-left: 10pt; }
    h1.l3 { color: #b91c1c; border-left-color: #b91c1c; }
    .intro { line-height: 1.55; margin-bottom: 18pt; text-align: justify; }
    table.invoices { width: 100%; border-collapse: collapse; font-size: 10pt; margin-top: 8pt; }
    table.invoices th { background: #f3f3f3; text-align: left; padding: 6pt 8pt; border-bottom: 2pt solid #ccc; font-weight: 600; }
    table.invoices td { padding: 5pt 8pt; border-bottom: 1px solid #eee; }
    table.invoices td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    table.invoices td.strong { font-weight: 700; }
    .total { margin-top: 14pt; text-align: right; font-size: 12pt; }
    .total .label { color: #555; }
    .total .amount { font-weight: 700; font-size: 16pt; color: #C8102E; }
    .total .amount.l3 { color: #b91c1c; }
    .closing { margin-top: 22pt; line-height: 1.55; }
    .signature { margin-top: 24pt; }
    .footer { position: fixed; bottom: 8mm; left: 18mm; right: 18mm; font-size: 8pt; color: #888; text-align: center; border-top: 1px solid #eee; padding-top: 4pt; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company">
      <div class="name">${escapeHtml(COMPANY.name)}</div>
      <div>${escapeHtml(COMPANY.address)}</div>
      <div>TVA ${escapeHtml(COMPANY.vat)} · IBAN ${escapeHtml(COMPANY.iban)}</div>
      <div>${escapeHtml(COMPANY.phone)} · ${escapeHtml(COMPANY.email)}</div>
    </div>
    <div class="recipient">
      <div class="name">${escapeHtml(partner.name)}</div>
      ${partner.ref ? `<div>Réf. client : ${escapeHtml(partner.ref)}</div>` : ''}
      ${partnerAddrLines ? `<div style="margin-top:4pt">${partnerAddrLines}</div>` : ''}
      ${partner.vat ? `<div style="margin-top:4pt">TVA : ${escapeHtml(partner.vat)}</div>` : ''}
    </div>
  </div>

  <div class="meta">
    <div>Référence : <strong>${escapeHtml(reference)}</strong></div>
    <div>Pepinster, le ${formatDate(sentDate)}</div>
  </div>

  <h1${level === 3 ? ' class="l3"' : ''}>${escapeHtml(title)}</h1>

  <p class="intro">${escapeHtml(intro)}</p>

  <table class="invoices">
    <thead>
      <tr>
        <th>N° facture</th>
        <th>Date</th>
        <th>Échéance</th>
        <th style="text-align:right">Jours</th>
        <th style="text-align:right">Montant TVAC</th>
        <th style="text-align:right">Reste dû</th>
      </tr>
    </thead>
    <tbody>
      ${renderInvoiceRows(invoices)}
    </tbody>
  </table>

  <div class="total">
    <span class="label">Total à régler : </span>
    <span class="amount${level === 3 ? ' l3' : ''}">${formatEur(totalDue)}</span>
  </div>

  <div class="closing">
    ${level === 3
      ? `<p>À défaut de règlement dans le délai mentionné ci-dessus, le dossier sera transmis à notre conseil sans nouvel avis. Les frais et indemnités prévus aux conditions générales seront alors mis à votre charge.</p>`
      : `<p>Si ce paiement a été effectué entre-temps, nous vous prions de ne pas tenir compte de la présente. Pour toute question relative à ce dossier, n'hésitez pas à nous contacter.</p>`
    }
    <div class="signature">
      <div>Le service Comptabilité</div>
      <div style="font-weight:600;margin-top:2pt">${escapeHtml(COMPANY.name)}</div>
    </div>
  </div>

  <div class="footer">
    ${escapeHtml(COMPANY.name)} — ${escapeHtml(COMPANY.address)} — ${escapeHtml(COMPANY.phone)} — ${escapeHtml(COMPANY.website)}
  </div>
</body>
</html>`
}

// Cache le browser entre les appels (cold start serverless = ~2s, warm = ~50ms).
// En dev, le HMR peut le perdre — on retombe sur un launch.
let cachedBrowser: any | null = null

async function getBrowser() {
  if (cachedBrowser && cachedBrowser.connected) return cachedBrowser
  const isVercel = !!process.env.VERCEL_ENV

  if (isVercel) {
    cachedBrowser = await puppeteer.launch({
      args:            chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath:  await chromium.executablePath(),
      // chromium.headless retourne 'shell' en v126 que puppeteer-core 21
      // ne reconnait pas — on force true (equivalent fonctionnel).
      headless:        true,
    })
  } else {
    // En local dev (Mac), Chrome est le path standard.
    // Override possible via PUPPETEER_EXECUTABLE_PATH si Olivier a un autre setup.
    const localPath = process.env.PUPPETEER_EXECUTABLE_PATH
                  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    cachedBrowser = await puppeteer.launch({
      executablePath: localPath,
      headless:       true,
      args:           ['--no-sandbox'],
    })
  }
  return cachedBrowser
}

export async function generateReminderPdf(data: PdfData): Promise<Buffer> {
  const browser = await getBrowser()
  const page    = await browser.newPage()
  try {
    const html = buildHtml(data)
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdfBuffer = await page.pdf({
      format:          'A4',
      printBackground: true,
      preferCSSPageSize: true,
    })
    return Buffer.from(pdfBuffer)
  } finally {
    await page.close()
  }
}

// Helper export pour mock data (CHECKPOINT 2 visualisation).
export function buildMockPdfData(level: ReminderLevel): PdfData {
  const today = new Date().toISOString().slice(0, 10)
  const due30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const due45 = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10)
  const due60 = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)
  const inv30 = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)
  const inv45 = new Date(Date.now() - 75 * 86400_000).toISOString().slice(0, 10)
  const inv60 = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)

  return {
    level,
    partner: {
      name:    'Garage Mock SPRL',
      ref:     'C00042',
      email:   'compta@garage-mock.be',
      vat:     'BE0123.456.789',
      street:  'Rue de la Démo 12',
      zip:     '4800',
      city:    'Verviers',
      country: 'Belgique',
    },
    invoices: [
      { id: 1, name: 'INV/2026/00012', invoiceDate: inv30, dueDate: due30, daysOverdue: 30, level: 2, amountTotal: 363.00, amountResidual: 363.00, plate: '1-ABC-123', vehicleLabel: 'BMW Série 5' },
      { id: 2, name: 'INV/2026/00018', invoiceDate: inv45, dueDate: due45, daysOverdue: 45, level: 2, amountTotal: 484.00, amountResidual: 484.00, plate: '1-XYZ-456', vehicleLabel: 'Audi A4'      },
      { id: 3, name: 'INV/2026/00025', invoiceDate: inv60, dueDate: due60, daysOverdue: 60, level: 3, amountTotal: 1210.00, amountResidual: 750.00, plate: null, vehicleLabel: null            },
    ],
    totalDue:  363.00 + 484.00 + 750.00,
    reference: `REL-MOCK-${level}`,
    sentDate:  today,
  }
}
