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
  Document, Page, View, Text, Image, Link, StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer'
import * as React              from 'react'
import { COMPANY }             from '@/config/company'
import type { OverdueInvoice, ReminderLevel } from './odoo'
import { signInvoiceToken }    from './invoice-token'

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

// formatEur centralise dans @/lib/format
import { formatEur } from '@/lib/format'

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
const RED_VD       = '#C8102E'   // rouge corporate VD (L1, L2)
const RED_DEMEUR   = '#B91C1C'   // rouge mise en demeure (L3)
const RED_VD_SOFT  = '#FCEAEC'   // rouge tres clair pour fond total
const RED_DEM_SOFT = '#FCE5E5'
const INK          = '#1A1A1A'
const INK_MUTED    = '#666666'
const INK_SUBTLE   = '#999999'
const BORDER       = '#E5E5E5'
const ZEBRA        = '#FAFAFA'
const TBL_HEAD     = '#1A1A1A'   // header noir (contraste avec rouge VD)
const APP_URL      = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
const LOGO_URL     = `${APP_URL}/logo.jpg`

const styles = StyleSheet.create({
  // Padding 36pt sur les 4 cotes : protege les pages 2+ contre le contenu
  // colle au top. Le bandeau est etendu en plein largeur via marges
  // negatives (marginHorizontal/Top -36) pour deborder sur page 1.
  page: {
    paddingTop:    36,
    paddingBottom: 56,        // place pour footer fixed
    paddingLeft:   36,
    paddingRight:  36,
    fontFamily:    'Helvetica',
    fontSize:      10,
    color:         INK,
    lineHeight:    1.45,
  },

  // ── BANDEAU ROUGE FULL-WIDTH ──
  // marges negatives = "full bleed" sur page 1, sans affecter pages 2+
  banner: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingVertical: 16,
    paddingHorizontal: 36,
    marginTop:       -36,
    marginLeft:      -36,
    marginRight:     -36,
    marginBottom:    24,
  },
  bannerLogo: {
    width:        50,
    height:       50,
    marginRight:  14,
    objectFit:    'contain',
  },
  bannerName: {
    fontSize:    22,
    fontFamily:  'Helvetica-Bold',
    color:       'white',
    letterSpacing: 0.5,
  },

  // Bloc destinataire seul (l'emetteur apparait deja en footer)
  headerRow: {
    flexDirection:  'row',
    justifyContent: 'flex-end',
    marginBottom:   18,
  },

  recipient: {
    width:           260,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth:     0.5,
    borderColor:     BORDER,
    backgroundColor: ZEBRA,
    fontSize:        9,
    lineHeight:      1.5,
  },
  recipientLabel: {
    fontSize:    8,
    color:       INK_SUBTLE,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  recipientName: {
    fontFamily: 'Helvetica-Bold',
    fontSize:   11,
    marginBottom: 4,
    color:      INK,
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
    fontSize:    18,
    fontFamily:  'Helvetica-Bold',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderLeftWidth: 4,
    marginBottom:    14,
  },

  intro: {
    marginBottom: 16,
    textAlign:    'justify',
    lineHeight:   1.55,
    fontSize:     10,
  },

  // ── Tableau factures ──
  table: {
    width:           '100%',
    marginTop:       6,
    borderRadius:    2,
    overflow:        'hidden',
  },
  thead: {
    flexDirection:   'row',
    backgroundColor: TBL_HEAD,
    paddingVertical: 7,
    paddingHorizontal: 8,
    fontFamily:      'Helvetica-Bold',
    fontSize:        8.5,
    color:           'white',
    letterSpacing:   0.3,
    textTransform:   'uppercase',
  },
  tr: {
    flexDirection:   'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize:        9,
    borderBottomWidth: 0.5,
    borderColor:     BORDER,
  },
  trZebra: {
    backgroundColor: ZEBRA,
  },
  // Colonnes — paddingRight ajoute pour eviter "18j1-XXX-001" colle.
  cellInvoice:  { width: '15%', paddingRight: 4, fontFamily: 'Helvetica-Bold' },
  cellDate:     { width: '13%', paddingRight: 4 },
  cellDue:      { width: '13%', paddingRight: 4 },
  cellDays:     { width: '9%',  paddingRight: 8, textAlign: 'right' },
  cellPlate:    { width: '20%', paddingRight: 4 },
  cellTotal:    { width: '14%', paddingRight: 4, textAlign: 'right' },
  cellResidual: { width: '16%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },

  // ── Total dans encadre (largeur fixe 320pt aligne a droite) ──
  totalBox: {
    flexDirection:   'row',
    justifyContent:  'flex-end',
    marginTop:       16,
    marginBottom:    18,
  },
  totalInner: {
    width:            320,
    flexDirection:    'row',
    justifyContent:   'space-between',
    alignItems:       'center',
    paddingVertical:  12,
    paddingHorizontal: 18,
    borderRadius:     4,
  },
  totalLabel: {
    color:       INK,
    fontSize:    11,
    fontFamily:  'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  totalAmount: {
    fontSize:    22,
    fontFamily:  'Helvetica-Bold',
  },

  // Bloc paiement IBAN
  payBlock: {
    marginTop:        14,
    paddingVertical:  10,
    paddingHorizontal: 12,
    borderWidth:      0.5,
    borderColor:      BORDER,
    backgroundColor:  ZEBRA,
    fontSize:         9,
    lineHeight:       1.5,
  },
  payLabel: {
    fontSize:    8,
    color:       INK_SUBTLE,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  payIban: {
    fontFamily: 'Helvetica-Bold',
    fontSize:   11,
  },

  closing: {
    marginTop:  16,
    lineHeight: 1.55,
    fontSize:   10,
  },
  signature: {
    marginTop: 24,
  },
  signatureBold: {
    fontFamily: 'Helvetica-Bold',
    marginTop:  2,
  },

  // Footer fixe sur chaque page
  footer: {
    position:    'absolute',
    bottom:      18,
    left:        36,
    right:       36,
    fontSize:    8,
    color:       INK_SUBTLE,
    textAlign:   'center',
    paddingTop:  6,
    borderTopWidth: 0.5,
    borderColor:    BORDER,
  },
})

function Banner({ accent }: { accent: string }): React.ReactElement {
  return React.createElement(View, { style: { ...styles.banner, backgroundColor: accent } },
    React.createElement(Image, { src: LOGO_URL, style: styles.bannerLogo }),
    React.createElement(Text, { style: styles.bannerName }, COMPANY.name),
  )
}

function RecipientBlock({ partner }: { partner: PartnerForPdf }): React.ReactElement {
  const children: React.ReactNode[] = [
    React.createElement(Text, { key: 'lab',  style: styles.recipientLabel }, 'Destinataire'),
    React.createElement(Text, { key: 'name', style: styles.recipientName }, partner.name),
  ]
  if (partner.ref) {
    children.push(React.createElement(Text, { key: 'ref' }, `Réf. client : ${partner.ref}`))
  }
  if (partner.street) {
    children.push(React.createElement(Text, { key: 'street', style: { marginTop: 4 } }, partner.street))
  }
  const cityLine = [partner.zip, partner.city].filter(Boolean).join(' ')
  if (cityLine) {
    children.push(React.createElement(Text, { key: 'city' }, cityLine))
  }
  if (partner.country) {
    children.push(React.createElement(Text, { key: 'cnt' }, partner.country))
  }
  if (partner.vat) {
    children.push(React.createElement(Text, { key: 'vat', style: { marginTop: 4 } }, `TVA : ${partner.vat}`))
  }
  return React.createElement(View, { style: styles.recipient }, ...children)
}

// Couleur du lien cliquable n facture : bleu standard PDF, lisible sur
// fond blanc et zebra. PDF reader n affiche pas naturellement le souligne
// donc on ajoute textDecoration: 'underline'.
const LINK_BLUE = '#1F75D9'

/**
 * Construit l URL signee pour telecharger une facture Odoo via la route
 * /api/relances/invoice/[id]?token=<HMAC>. URL absolue obligatoire pour
 * que les liens fonctionnent depuis un PDF email envoye au client.
 */
function buildInvoiceUrl(invoiceId: number): string {
  const token = signInvoiceToken(invoiceId)   // TTL 1 an par defaut
  return `${APP_URL}/api/relances/invoice/${invoiceId}?token=${encodeURIComponent(token)}`
}

function InvoiceRow({ inv, zebra }: { inv: OverdueInvoice; zebra: boolean }): React.ReactElement {
  const plateText = inv.plate
    ? (inv.vehicleLabel ? `${inv.plate} · ${inv.vehicleLabel}` : inv.plate)
    : '—'
  const rowStyle = zebra ? { ...styles.tr, ...styles.trZebra } : styles.tr

  // Le numero de facture est wrappe dans un Link cliquable avec underline
  // bleu. Le clic ouvre la route /api/relances/invoice/<id> qui stream le
  // PDF Odoo. Token HMAC TTL 1 an.
  const invoiceLink = React.createElement(Link, {
    src: buildInvoiceUrl(inv.id),
    style: { color: LINK_BLUE, textDecoration: 'underline' },
  }, inv.name)

  return React.createElement(View, { style: rowStyle },
    React.createElement(Text, { style: styles.cellInvoice  }, invoiceLink),
    React.createElement(Text, { style: styles.cellDate     }, formatDate(inv.invoiceDate)),
    React.createElement(Text, { style: styles.cellDue      }, formatDate(inv.dueDate)),
    React.createElement(Text, { style: styles.cellDays     }, `${inv.daysOverdue} j`),
    React.createElement(Text, { style: styles.cellPlate    }, plateText),
    React.createElement(Text, { style: styles.cellTotal    }, formatEur(inv.amountTotal)),
    React.createElement(Text, { style: styles.cellResidual }, formatEur(inv.amountResidual)),
  )
}

function PaymentBlock({ totalDue, reference }: { totalDue: number; reference: string }): React.ReactElement {
  return React.createElement(View, { style: styles.payBlock },
    React.createElement(Text, { style: styles.payLabel }, 'Modalités de paiement'),
    React.createElement(Text, null,
      React.createElement(Text, null, 'Veuillez verser le montant total de '),
      React.createElement(Text, { style: { fontFamily: 'Helvetica-Bold' } }, formatEur(totalDue)),
      React.createElement(Text, null, ' sur le compte :'),
    ),
    React.createElement(Text, { style: styles.payIban }, COMPANY.iban),
    React.createElement(Text, { style: { color: INK_MUTED, fontSize: 9, marginTop: 2 } },
      `Communication : ${reference}`),
  )
}

function ReminderDocument({ data }: { data: PdfData }): React.ReactElement {
  const { level, partner, invoices, totalDue, reference, sentDate } = data
  const accent     = level === 3 ? RED_DEMEUR : RED_VD
  const totalSoft  = level === 3 ? RED_DEM_SOFT : RED_VD_SOFT
  const titleStyle = { ...styles.title, color: accent, borderLeftColor: accent }
  const totalInnerStyle = {
    ...styles.totalInner,
    backgroundColor: totalSoft,
    borderWidth:     1,
    borderColor:     accent,
  }
  const totalAmountStyle = { ...styles.totalAmount, color: accent }

  const closingText = level === 3
    ? `À défaut de règlement dans le délai mentionné ci-dessus, le dossier sera transmis à notre conseil sans nouvel avis. Les frais et indemnités prévus aux conditions générales seront alors mis à votre charge.`
    : `Si ce paiement a été effectué entre-temps, nous vous prions de ne pas tenir compte de la présente. Pour toute question relative à ce dossier, n'hésitez pas à nous contacter.`

  return React.createElement(Document, null,
    React.createElement(Page, { size: 'A4', style: styles.page },
      // ── BANDEAU plein largeur (logo + nom uniquement) ──
      React.createElement(Banner, { accent }),

      // Bloc destinataire seul (emetteur disponible en footer)
      React.createElement(View, { style: styles.headerRow },
        React.createElement(RecipientBlock, { partner }),
      ),
      // Meta (référence + date)
      React.createElement(View, { style: styles.metaRow },
        React.createElement(Text, null,
          React.createElement(Text, null, 'Référence : '),
          React.createElement(Text, { style: { fontFamily: 'Helvetica-Bold', color: INK } }, reference),
        ),
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
        ...invoices.map((inv, i) =>
          React.createElement(InvoiceRow, { key: inv.id, inv, zebra: i % 2 === 1 })
        ),
      ),
      // Total dans encadre
      React.createElement(View, { style: styles.totalBox },
        React.createElement(View, { style: totalInnerStyle },
          React.createElement(Text, { style: styles.totalLabel }, 'Total à régler'),
          React.createElement(Text, { style: totalAmountStyle }, formatEur(totalDue)),
        ),
      ),
      // Modalites paiement (IBAN + communication)
      React.createElement(PaymentBlock, { totalDue, reference }),
      // Closing -- wrap=false pour eviter qu il deborde sur page 2
      React.createElement(View, { style: styles.closing, wrap: false },
        React.createElement(Text, null, closingText),
        React.createElement(View, { style: styles.signature },
          React.createElement(Text, { style: { color: INK_MUTED } }, 'Le service Comptabilité'),
          React.createElement(Text, { style: styles.signatureBold }, COMPANY.name),
        ),
      ),
      // Footer fixe sur chaque page
      React.createElement(View, { style: styles.footer, fixed: true },
        React.createElement(Text, null,
          `${COMPANY.name} · ${COMPANY.address} · ${COMPANY.phone} · ${COMPANY.email} · ${COMPANY.website}`
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
