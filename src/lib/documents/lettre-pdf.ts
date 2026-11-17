// src/lib/documents/lettre-pdf.ts — lettre postale aux couleurs de Verviers Dépannage (Olivier 17/11/2026 : « il faut
// que ça garde la DA de notre société »). Même identité que les lettres de relance (src/lib/relances/pdf.ts) : bandeau
// rouge VD avec le logo, bloc destinataire, référence et date, titre au filet rouge, encadré du montant, signature et
// pied de page avec les coordonnées. Langue libre : tous les textes viennent de l'appelant.
import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer'

// Pas de coupure de mots en fin de ligne (« un-seres »).
Font.registerHyphenationCallback(word => [word])
import { COMPANY } from '@/config/company'

const RED_VD = '#C8102E', RED_SOFT = '#FCEAEC', INK = '#1A1A1A', MUTED = '#666666', SUBTLE = '#999999', BORDER = '#E5E5E5', ZEBRA = '#FAFAFA'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingLeft: 48, paddingRight: 48, fontFamily: 'Helvetica', fontSize: 10.5, color: INK, lineHeight: 1.5 },
  banner: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 48, marginTop: -36, marginLeft: -48, marginRight: -48, marginBottom: 26, backgroundColor: RED_VD },
  logo: { width: 50, height: 50, marginRight: 14, objectFit: 'contain' },
  bannerName: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: 'white', letterSpacing: 0.5, lineHeight: 1.15 },
  bannerSub: { fontSize: 9, color: 'white', marginTop: 5, lineHeight: 1.2 },
  headerRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 20 },
  recipient: { width: 250, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 0.5, borderColor: BORDER, backgroundColor: ZEBRA, fontSize: 10, lineHeight: 1.45 },
  recipientLabel: { fontSize: 8, color: SUBTLE, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  recipientName: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 2 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18, fontSize: 9, color: MUTED },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', paddingVertical: 5, paddingHorizontal: 12, borderLeftWidth: 4, borderLeftColor: RED_VD, color: RED_VD, marginBottom: 16 },
  p: { marginBottom: 9, textAlign: 'justify' },
  amountBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 10, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 4, borderWidth: 1, borderColor: RED_VD, backgroundColor: RED_SOFT },
  amountLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4 },
  amount: { fontFamily: 'Helvetica-Bold', fontSize: 16, color: RED_VD },
  list: { marginBottom: 10, marginLeft: 6 },
  li: { flexDirection: 'row', marginBottom: 3 },
  bullet: { width: 14, color: RED_VD, fontFamily: 'Helvetica-Bold' },
  contact: { marginVertical: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: ZEBRA, borderLeftWidth: 3, borderLeftColor: INK, fontSize: 10 },
  signature: { marginTop: 18 },
  signBold: { fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 18, left: 48, right: 48, fontSize: 8, color: SUBTLE, textAlign: 'center', paddingTop: 6, borderTopWidth: 0.5, borderColor: BORDER },
})

export interface LettreData {
  destinataire: string[]          // première ligne = nom
  libelleDestinataire: string     // « Destinataire », « Empfänger »…
  reference: { label: string; valeur: string }
  lieuDate: string
  titre: string
  avant: string[]                 // paragraphes avant le montant
  montant?: { label: string; valeur: string }
  apres: string[]                 // paragraphes après le montant
  liste?: string[]                // puces (informations à envoyer…)
  contact?: string                // encadré (adresse mail…)
  fin: string[]                   // derniers paragraphes
  signature: string[]             // service, société
}

function LettreDoc({ d }: { d: LettreData }) {
  const e = React.createElement
  return e(Document, null,
    e(Page, { size: 'A4', style: s.page },
      e(View, { style: s.banner },
        e(Image, { src: `${APP_URL}/logo.jpg`, style: s.logo }),
        e(View, null, e(Text, { style: s.bannerName }, COMPANY.name), e(Text, { style: s.bannerSub }, 'Dépannage · Remorquage · Assistance 24 h/24')),
      ),
      e(View, { style: s.headerRow },
        e(View, { style: s.recipient },
          e(Text, { style: s.recipientLabel }, d.libelleDestinataire),
          e(Text, { style: s.recipientName }, d.destinataire[0]),
          ...d.destinataire.slice(1).map((l, i) => e(Text, { key: i }, l)),
        ),
      ),
      e(View, { style: s.meta },
        e(Text, null, `${d.reference.label} : `, e(Text, { style: { fontFamily: 'Helvetica-Bold', color: INK } }, d.reference.valeur)),
        e(Text, null, d.lieuDate),
      ),
      e(Text, { style: s.title }, d.titre),
      ...d.avant.map((p, i) => e(Text, { key: 'a' + i, style: s.p }, p)),
      d.montant ? e(View, { style: s.amountBox, wrap: false }, e(Text, { style: s.amountLabel }, d.montant.label), e(Text, { style: s.amount }, d.montant.valeur)) : null,
      ...d.apres.map((p, i) => e(Text, { key: 'b' + i, style: s.p }, p)),
      d.liste?.length ? e(View, { style: s.list }, ...d.liste.map((l, i) => e(View, { key: i, style: s.li }, e(Text, { style: s.bullet }, '•'), e(Text, { style: { flex: 1 } }, l)))) : null,
      d.contact ? e(Text, { style: s.contact }, d.contact) : null,
      ...d.fin.map((p, i) => e(Text, { key: 'c' + i, style: s.p }, p)),
      e(View, { style: s.signature, wrap: false },
        e(Text, { style: { color: MUTED } }, d.signature[0]),
        ...d.signature.slice(1).map((l, i) => e(Text, { key: i, style: s.signBold }, l)),
      ),
      e(View, { style: s.footer, fixed: true },
        e(Text, null, `${COMPANY.name} · ${COMPANY.address} · ${COMPANY.phone} · ${COMPANY.email} · ${COMPANY.website}`),
      ),
    ),
  )
}

export async function genererLettre(d: LettreData): Promise<Buffer> {
  return renderToBuffer(React.createElement(LettreDoc, { d }) as any)
}
