// ============================================================
// Module Relance — Generateur PDF (@react-pdf/renderer)
// ============================================================
// Pure JS, aucun binaire externe (vs. Puppeteer + chromium serverless
// qui posait des problemes de libs systeme libnss3 sur Vercel runtime).
// Cold start ~100ms, generation ~500ms. Identique en local et prod.
//
// API : generateReminderPdf(data) -> Promise<Buffer>
//
// Le composant React rendu cote serveur via renderToBuffer().

import {
  Document, Page, View, Text, Image, StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer'
import * as React              from 'react'
import { COMPANY }             from '@/config/company'
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

// Helpers format
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

const LEVEL_TITLES: Record<ReminderLevel, string> = {
  1: 'Rappel amical',
  2: 'Relance — second rappel',
  3: 'Mise en demeure',
}

// Phrasing pre-validation Olivier — Phase 1.
const LEVEL_INTROS: Record<ReminderLevel, string> = {
  1: `Sauf erreur de notre part, nos services constatent que les factures reprises ci-dessous, dont la date d'échéance est dépassée, restent impayées à ce jour. Nous vous remercions de bien vouloir procéder au règlement dans les meilleurs délais.`,
  2: `Nous attirons à nouveau votre attention sur le fait que les factures reprises ci-dessous restent impayées malgré notre précédent rappel. Nous vous prions de procéder au règlement sous huitaine à compter de la présente.`,
  3: `Malgré nos précédents rappels, nous constatons que les factures reprises ci-dessous demeurent impayées à ce jour. Conformément à nos conditions générales de vente, nous vous mettons en demeure de procéder au règlement intégral du solde dû sous quinze jours à dater de la présente, sous peine de poursuites judiciaires sans nouvel avis et de l'application des intérêts de retard et de l'indemnité forfaitaire prévus contractuellement.`,
}

// Couleurs
const RED_VD     = '#C8102E'   // rouge corporate VD (L1, L2)
const RED_DEMEUR = '#B91C1C'   // rouge mise en demeure (L3)
const INK        = '#1A1A1A'
const INK_MUTED  = '#555555'
const BORDER     = '#E5E5E5'
const TBL_HEAD   = '#F3F3F3'

const styles = StyleSheet.create({
  page: {
    paddingTop:    36,
    paddingBottom: 60,   // place pour footer fixed
    paddingLeft:   36,
    paddingRight:  36,
    fontFamily:    'Helvetica',
    fontSize:      10,
    color:         INK,
    lineHeight:    1.4,
  },

  // Header
  headerRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
    marginBottom:   24,
  },
  company: {
    width:     220,
    fontSize:  9,
    lineHeight: 1.45,
  },
  companyName: {
    fontSize:    13,
    color:       RED_VD,
    fontFamily:  'Helvetica-Bold',
    marginBottom: 4,
  },

  recipient: {
    width:           260,
    padding:         8,
    borderWidth:     0.5,
    borderColor:     BORDER,
    backgroundColor: '#FAFAFA',
    borderRadius:    3,
    fontSize:        9,
    lineHeight:      1.45,
  },
  recipientName: {
    fontFamily: 'Helvetica-Bold',
    fontSize:   10,
    marginBottom: 4,
  },

  // Meta
  metaRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    marginBottom:   18,
    fontSize:       9,
    color:          INK_MUTED,
  },

  // Titre
  title: {
    fontSize:    16,
    fontFamily:  'Helvetica-Bold',
    paddingLeft: 10,
    borderLeftWidth: 3,
    marginBottom: 14,
  },

  intro: {
    marginBottom: 16,
    textAlign:    'justify',
    lineHeight:   1.5,
  },

  // Tableau factures
  table: {
    width:        '100%',
    marginTop:    6,
    borderTopWidth:    0.5,
    borderBottomWidth: 0.5,
    borderColor:       BORDER,
  },
  thead: {
    flexDirection:   'row',
    backgroundColor: TBL_HEAD,
    paddingVertical: 5,
    paddingHorizontal: 6,
    fontFamily:      'Helvetica-Bold',
    fontSize:        9,
  },
  tr: {
    flexDirection:   'row',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderTopWidth:  0.5,
    borderColor:     BORDER,
    fontSize:        9,
  },
  cellInvoice:  { width: '15%' },
  cellDate:     { width: '13%' },
  cellDue:      { width: '13%' },
  cellDays:     { width: '8%',  textAlign: 'right' },
  cellPlate:    { width: '21%' },
  cellTotal:    { width: '15%', textAlign: 'right' },
  cellResidual: { width: '15%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },

  total: {
    flexDirection:  'row',
    justifyContent: 'flex-end',
    alignItems:     'baseline',
    marginTop:      14,
    marginBottom:   18,
  },
  totalLabel: {
    color:    INK_MUTED,
    fontSize: 11,
    marginRight: 8,
  },
  totalAmount: {
    fontSize:   16,
    fontFamily: 'Helvetica-Bold',
  },

  closing: {
    marginTop:  10,
    lineHeight: 1.5,
  },
  signature: {
    marginTop: 22,
  },
  signatureBold: {
    fontFamily: 'Helvetica-Bold',
    marginTop:  2,
  },

  // Footer fixe sur chaque page
  footer: {
    position:    'absolute',
    bottom:      24,
    left:        36,
    right:       36,
    fontSize:    8,
    color:       '#888888',
    textAlign:   'center',
    paddingTop:  4,
    borderTopWidth: 0.5,
    borderColor:    BORDER,
  },
})

function CompanyBlock(): React.ReactElement {
  return React.createElement(View, { style: styles.company },
    React.createElement(Text, { style: styles.companyName }, COMPANY.name),
    React.createElement(Text, null, COMPANY.address),
    React.createElement(Text, null, `TVA ${COMPANY.vat}`),
    React.createElement(Text, null, `IBAN ${COMPANY.iban}`),
    React.createElement(Text, null, COMPANY.phone),
    React.createElement(Text, null, COMPANY.email),
  )
}

function RecipientBlock({ partner }: { partner: PartnerForPdf }): React.ReactElement {
  const addr = [
    partner.street,
    [partner.zip, partner.city].filter(Boolean).join(' '),
    partner.country,
  ].filter(Boolean).join('\n')

  const children: React.ReactNode[] = [
    React.createElement(Text, { key: 'name', style: styles.recipientName }, partner.name),
  ]
  if (partner.ref) {
    children.push(React.createElement(Text, { key: 'ref' }, `Réf. client : ${partner.ref}`))
  }
  if (addr) {
    children.push(React.createElement(Text, { key: 'addr', style: { marginTop: 4 } }, addr))
  }
  if (partner.vat) {
    children.push(React.createElement(Text, { key: 'vat', style: { marginTop: 4 } }, `TVA : ${partner.vat}`))
  }
  return React.createElement(View, { style: styles.recipient }, ...children)
}

function InvoiceRow({ inv }: { inv: OverdueInvoice }): React.ReactElement {
  const plateText = inv.plate
    ? (inv.vehicleLabel ? `${inv.plate} · ${inv.vehicleLabel}` : inv.plate)
    : '—'
  return React.createElement(View, { style: styles.tr },
    React.createElement(Text, { style: styles.cellInvoice  }, inv.name),
    React.createElement(Text, { style: styles.cellDate     }, formatDate(inv.invoiceDate)),
    React.createElement(Text, { style: styles.cellDue      }, formatDate(inv.dueDate)),
    React.createElement(Text, { style: styles.cellDays     }, `${inv.daysOverdue}j`),
    React.createElement(Text, { style: styles.cellPlate    }, plateText),
    React.createElement(Text, { style: styles.cellTotal    }, formatEur(inv.amountTotal)),
    React.createElement(Text, { style: styles.cellResidual }, formatEur(inv.amountResidual)),
  )
}

function ReminderDocument({ data }: { data: PdfData }): React.ReactElement {
  const { level, partner, invoices, totalDue, reference, sentDate } = data
  const accent = level === 3 ? RED_DEMEUR : RED_VD
  const titleStyle = { ...styles.title, color: accent, borderLeftColor: accent }
  const totalAmountStyle = { ...styles.totalAmount, color: accent }

  const closingText = level === 3
    ? `À défaut de règlement dans le délai mentionné ci-dessus, le dossier sera transmis à notre conseil sans nouvel avis. Les frais et indemnités prévus aux conditions générales seront alors mis à votre charge.`
    : `Si ce paiement a été effectué entre-temps, nous vous prions de ne pas tenir compte de la présente. Pour toute question relative à ce dossier, n'hésitez pas à nous contacter.`

  return React.createElement(Document, null,
    React.createElement(Page, { size: 'A4', style: styles.page },
      // Header (company + recipient)
      React.createElement(View, { style: styles.headerRow },
        React.createElement(CompanyBlock),
        React.createElement(RecipientBlock, { partner }),
      ),
      // Meta (référence + date)
      React.createElement(View, { style: styles.metaRow },
        React.createElement(Text, null, React.createElement(Text, null, 'Référence : '),
          React.createElement(Text, { style: { fontFamily: 'Helvetica-Bold' } }, reference)),
        React.createElement(Text, null, `Pepinster, le ${formatDate(sentDate)}`),
      ),
      // Titre
      React.createElement(Text, { style: titleStyle }, LEVEL_TITLES[level]),
      // Intro
      React.createElement(Text, { style: styles.intro }, LEVEL_INTROS[level]),
      // Tableau
      React.createElement(View, { style: styles.table },
        React.createElement(View, { style: styles.thead },
          React.createElement(Text, { style: styles.cellInvoice  }, 'N° facture'),
          React.createElement(Text, { style: styles.cellDate     }, 'Date'),
          React.createElement(Text, { style: styles.cellDue      }, 'Échéance'),
          React.createElement(Text, { style: styles.cellDays     }, 'Jours'),
          React.createElement(Text, { style: styles.cellPlate    }, 'Véhicule'),
          React.createElement(Text, { style: styles.cellTotal    }, 'Mt TVAC'),
          React.createElement(Text, { style: styles.cellResidual }, 'Reste dû'),
        ),
        ...invoices.map(inv =>
          React.createElement(InvoiceRow, { key: inv.id, inv })
        ),
      ),
      // Total
      React.createElement(View, { style: styles.total },
        React.createElement(Text, { style: styles.totalLabel }, 'Total à régler :'),
        React.createElement(Text, { style: totalAmountStyle }, formatEur(totalDue)),
      ),
      // Closing
      React.createElement(View, { style: styles.closing },
        React.createElement(Text, null, closingText),
        React.createElement(View, { style: styles.signature },
          React.createElement(Text, null, 'Le service Comptabilité'),
          React.createElement(Text, { style: styles.signatureBold }, COMPANY.name),
        ),
      ),
      // Footer fixe
      React.createElement(View, { style: styles.footer, fixed: true },
        React.createElement(Text, null,
          `${COMPANY.name} — ${COMPANY.address} — ${COMPANY.phone} — ${COMPANY.website}`
        ),
      ),
    ),
  )
}

export async function generateReminderPdf(data: PdfData): Promise<Buffer> {
  const doc = React.createElement(ReminderDocument, { data })
  const buf = await renderToBuffer(doc as any)
  return buf
}

// ============================================================
// MOCK DATA — CHECKPOINT 2
// ============================================================
// Specs Olivier : "Touring Belgium" + 3 factures fictives + niveau
// global L2 (test du milieu). 1 vehicule mock par facture.

export function buildMockPdfData(level: ReminderLevel): PdfData {
  const today = new Date().toISOString().slice(0, 10)

  // 3 factures echues realistes :
  // F2026-001 : 18j retard -> level 1
  // F2026-014 : 42j retard -> level 2
  // F2026-022 : 73j retard -> level 3 (et porte le niveau global du client)
  const due18 = new Date(Date.now() - 18 * 86400_000).toISOString().slice(0, 10)
  const due42 = new Date(Date.now() - 42 * 86400_000).toISOString().slice(0, 10)
  const due73 = new Date(Date.now() - 73 * 86400_000).toISOString().slice(0, 10)
  const inv18 = new Date(Date.now() - 48 * 86400_000).toISOString().slice(0, 10)
  const inv42 = new Date(Date.now() - 72 * 86400_000).toISOString().slice(0, 10)
  const inv73 = new Date(Date.now() - 103 * 86400_000).toISOString().slice(0, 10)

  return {
    level,                          // niveau du PDF demande par la route
    partner: {
      name:    'Touring Belgium SA',
      ref:     'C00128',
      email:   'compta@touring.be',
      vat:     'BE0403.471.401',
      street:  'Avenue de la Métrologie 8',
      zip:     '1130',
      city:    'Bruxelles',
      country: 'Belgique',
    },
    invoices: [
      { id: 1, name: 'F2026-001', invoiceDate: inv18, dueDate: due18, daysOverdue: 18, level: 1,
        amountTotal: 523.40,  amountResidual: 523.40,  plate: '1-XXX-001', vehicleLabel: 'VW Golf' },
      { id: 2, name: 'F2026-014', invoiceDate: inv42, dueDate: due42, daysOverdue: 42, level: 2,
        amountTotal: 1247.80, amountResidual: 1247.80, plate: '1-XXX-002', vehicleLabel: 'Renault Kangoo' },
      { id: 3, name: 'F2026-022', invoiceDate: inv73, dueDate: due73, daysOverdue: 73, level: 3,
        amountTotal: 2890.00, amountResidual: 2890.00, plate: '1-XXX-003', vehicleLabel: 'Mercedes Sprinter' },
    ],
    totalDue:  523.40 + 1247.80 + 2890.00,
    reference: `REL-MOCK-${level}-${today.replace(/-/g, '')}`,
    sentDate:  today,
  }
}
