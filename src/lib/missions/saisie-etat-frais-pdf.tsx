// src/lib/missions/saisie-etat-frais-pdf.tsx
//
// ÉTAT DE FRAIS (saisie judiciaire) — PDF A4 via @react-pdf/renderer.
// Reproduction FIDÈLE de la maquette validée par Olivier (artifact abf9f222) :
//   • masthead : logo VD + « Verviers Dépannage » à gauche ; « État de frais » +
//     n° EDF en grand + date d'émission à droite ; filet rouge.
//   • blocs Émetteur / Destinataire (adresse + e-mail + TVA).
//   • bandeau « Dossier & véhicule » (grille : PV, dates, période, plaque, VIN, motif).
//   • tableau des prestations avec chips de code (SERV-PEC…).
//   • totaux (Total HTVA / TVA 21 % / Total à charge du <destinataire>).
//   • pied : QR de RATTACHEMENT (scan → rattache la validation à la fiche) +
//     suivi & mentions ; bandeau légal.
// Montants issus de computeSaisieBilling → identiques à la fiche.

import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } from '@react-pdf/renderer'
import { readFileSync } from 'fs'
import { join } from 'path'
import QRCode from 'qrcode'
import { COMPANY } from '@/config/company'
import type { SaisieBillingResult, SaisieRecipient } from '@/lib/missions/saisie-billing'

// Palette maquette
const PAPER = '#FDFBFA', INK = '#28211F', MUTED = '#6B615E', FAINT = '#9A8F8C'
const RED = '#A51C2C', RED2 = '#C0273A', TINT = '#F9EBEC', BAND = '#F6F2F0'
const LINE = '#E8E2E0', LINE_STRONG = '#D6CDCA'
const GOOD = '#1D7A54', GOOD_BG = '#E8F4EE', GOOD_BORDER = '#BFE3CF'

const styles = StyleSheet.create({
  page: { backgroundColor: PAPER, fontFamily: 'Helvetica', color: INK, fontSize: 11, paddingBottom: 0 },
  pad:  { paddingTop: 28, paddingHorizontal: 40, paddingBottom: 16 },

  // Masthead
  top:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand:     { flexDirection: 'row', alignItems: 'center', gap: 11 },
  logo:      { width: 44, height: 44, borderRadius: 9, backgroundColor: RED, color: '#fff', alignItems: 'center', justifyContent: 'center' },
  logoTxt:   { color: '#fff', fontSize: 16, fontWeight: 700, letterSpacing: 0.5 },
  brandNm:   { fontSize: 15, fontWeight: 700 },
  brandSub:  { fontSize: 8.5, color: MUTED, marginTop: 1 },
  docmeta:   { alignItems: 'flex-end' },
  doctitle:  { fontSize: 15, fontWeight: 700, letterSpacing: 1.6, color: RED, textTransform: 'uppercase' },
  docnum:    { fontSize: 23, fontWeight: 700, color: INK, marginTop: 3 },
  docref:    { fontSize: 9.5, color: MUTED, marginTop: 4 },

  rule: { height: 2, backgroundColor: RED, marginTop: 13, marginBottom: 13, borderRadius: 2 },

  // Parties
  parties: { flexDirection: 'row', gap: 26 },
  party:   { flex: 1 },
  lbl:     { fontSize: 8, fontWeight: 700, letterSpacing: 1, color: FAINT, textTransform: 'uppercase', marginBottom: 5 },
  who:     { fontSize: 12, fontWeight: 700 },
  addr:    { fontSize: 10, color: MUTED, marginTop: 2, lineHeight: 1.4 },
  addrInk: { fontSize: 10, color: INK, marginTop: 2 },

  // Bandeau dossier & véhicule
  band:      { marginTop: 16, borderWidth: 1, borderColor: LINE, borderRadius: 9 },
  bandHead:  { backgroundColor: BAND, paddingVertical: 8, paddingHorizontal: 14, fontSize: 8, fontWeight: 700, letterSpacing: 1, color: MUTED, textTransform: 'uppercase', borderBottomWidth: 1, borderBottomColor: LINE },
  kvRow:     { flexDirection: 'row' },
  kvRow2:    { borderTopWidth: 1, borderTopColor: LINE },
  cell:      { width: '25%', paddingVertical: 9, paddingHorizontal: 14, borderRightWidth: 1, borderRightColor: LINE },
  cellLast:  { borderRightWidth: 0 },
  k:         { fontSize: 8, color: FAINT, textTransform: 'uppercase', letterSpacing: 0.4 },
  v:         { fontSize: 11.5, fontWeight: 700, marginTop: 2 },
  vMono:     { fontSize: 10.5, fontWeight: 700, marginTop: 2, fontFamily: 'Courier' },
  plate:     { alignSelf: 'flex-start', marginTop: 3, backgroundColor: '#fff', borderWidth: 1.5, borderColor: INK, borderRadius: 3, paddingVertical: 1, paddingHorizontal: 6, fontSize: 11, fontWeight: 700, letterSpacing: 0.6 },

  // Tableau
  table:   { marginTop: 16 },
  thead:   { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: LINE_STRONG, paddingBottom: 8 },
  th:      { fontSize: 8, fontWeight: 700, letterSpacing: 0.8, color: MUTED, textTransform: 'uppercase', paddingHorizontal: 10 },
  tr:      { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 9 },
  cDesc:   { flex: 1, paddingHorizontal: 10 },
  cQty:    { width: 52, paddingHorizontal: 10, textAlign: 'right' },
  cPu:     { width: 84, paddingHorizontal: 10, textAlign: 'right' },
  cTot:    { width: 90, paddingHorizontal: 10, textAlign: 'right' },
  chip:    { alignSelf: 'flex-start', fontSize: 8, fontWeight: 700, color: RED, backgroundColor: TINT, borderRadius: 4, paddingVertical: 1, paddingHorizontal: 5, marginBottom: 4 },
  desc:    { fontSize: 11.5, fontWeight: 700 },
  meta:    { fontSize: 9.5, color: MUTED, marginTop: 2 },
  numTxt:  { fontSize: 11.5 },

  // Totaux
  totals:   { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  totbox:   { width: 250 },
  totrow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 12 },
  totT:     { fontSize: 11, color: MUTED },
  totV:     { fontSize: 11 },
  grand:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, backgroundColor: RED, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 13 },
  grandT:   { fontSize: 11, fontWeight: 700, color: '#F4D3D7' },
  grandV:   { fontSize: 13, fontWeight: 700, color: '#fff' },

  // Pied
  foot:     { flexDirection: 'row', gap: 24, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: LINE_STRONG, borderTopStyle: 'dashed' },
  qrframe:  { width: 118, height: 118, padding: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: LINE, borderRadius: 8 },
  qrImg:    { width: '100%', height: '100%' },
  qrRef:    { fontSize: 11, fontWeight: 700, marginTop: 6, textAlign: 'center', width: 118 },
  qrCap:    { fontSize: 8.5, color: MUTED, marginTop: 3, textAlign: 'center', width: 118, lineHeight: 1.3 },
  notes:    { flex: 1 },
  pill:     { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: GOOD_BG, borderWidth: 1, borderColor: GOOD_BORDER, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10, marginBottom: 8 },
  pillDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: GOOD },
  pillTxt:  { fontSize: 9.5, fontWeight: 700, color: GOOD },
  noteP:    { fontSize: 9.5, color: MUTED, marginTop: 6, lineHeight: 1.4 },
  noteSig:  { fontSize: 9.5, color: INK, marginTop: 6, fontStyle: 'italic', lineHeight: 1.4 },

  legal: { marginTop: 10, paddingVertical: 9, paddingHorizontal: 40, backgroundColor: BAND, borderTopWidth: 1, borderTopColor: LINE, fontSize: 9, color: FAINT, textAlign: 'center' },
})

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`
const fmtD = (iso?: string | null) => {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return d && m && y ? `${d}/${m}/${y}` : String(iso).slice(0, 10)
}
const RECIP: Record<SaisieRecipient, string> = { parquet: 'du Parquet', domaine: 'du Domaine', client: 'du client' }

export interface EtatFraisInput {
  numero: string
  dateEmission?: string
  recipient: SaisieRecipient
  destinataire: { name: string; lines: string[] }   // adresse / e-mail / TVA
  pv?: string | null
  dateSaisie?: string | null
  parkedAt: string
  periodFrom?: string | null
  periodTo: string
  plate: string
  vehicle: string
  vin?: string | null
  motif?: string | null
  billing: SaisieBillingResult
  /** Contenu du QR de rattachement (URL de dépôt de la validation). */
  qrUrl: string
}

function logoDataUrl(): string | null {
  try { return `data:image/png;base64,${readFileSync(join(process.cwd(), 'public', 'logo.png')).toString('base64')}` }
  catch { return null }
}

// Libellé « meta » sous chaque ligne (comme la maquette).
function lineMeta(l: SaisieBillingResult['lines'][number], parkedAt: string): string {
  if (l.kind === 'SERV-PEC') return `Intervention du ${fmtD(parkedAt)} — forfait de base`
  if (l.kind === 'SERV-KM')  return `Kilométrage facturé au-delà de la franchise`
  if (l.kind === 'SERV-DIV') return `Frais administratifs de dossier`
  if (l.kind === 'SERV-PARC' && l.period) return `Du ${fmtD(l.period.from)} au ${fmtD(l.period.to)} — ${l.qty} jour${l.qty > 1 ? 's' : ''} au tarif ${l.period.year}`
  if (l.kind === 'SERV-PARC') return `${l.qty} jour${l.qty > 1 ? 's' : ''}`
  return ''
}

function EtatFraisDoc({ input, qr, logo }: { input: EtatFraisInput; qr: string | null; logo: string | null }) {
  const b = input.billing
  const tva = b.totalTvac - b.totalHtva
  const period = `${input.periodFrom ? 'du ' + fmtD(input.periodFrom) + ' au ' : ''}${fmtD(input.periodTo)}`
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.pad}>

          {/* Masthead */}
          <View style={styles.top}>
            <View style={styles.brand}>
              {logo ? <Image style={{ width: 44, height: 44, objectFit: 'contain' }} src={logo} />
                    : <View style={styles.logo}><Text style={styles.logoTxt}>VD</Text></View>}
              <View>
                <Text style={styles.brandNm}>Verviers Dépannage</Text>
                <Text style={styles.brandSub}>Fourrière · Dépannage · Remorquage</Text>
              </View>
            </View>
            <View style={styles.docmeta}>
              <Text style={styles.doctitle}>État de frais</Text>
              <Text style={styles.docnum}>{input.numero}</Text>
              <Text style={styles.docref}>émis le {fmtD(input.dateEmission)}</Text>
            </View>
          </View>

          <View style={styles.rule} />

          {/* Émetteur / Destinataire */}
          <View style={styles.parties}>
            <View style={styles.party}>
              <Text style={styles.lbl}>Émetteur</Text>
              <Text style={styles.who}>{COMPANY.name}</Text>
              <Text style={styles.addr}>{COMPANY.address}</Text>
              <Text style={styles.addr}>fourriere@verviersdepannage.be</Text>
              <Text style={styles.addrInk}>TVA {COMPANY.vat}</Text>
            </View>
            <View style={styles.party}>
              <Text style={styles.lbl}>Destinataire</Text>
              <Text style={styles.who}>{input.destinataire.name}</Text>
              {input.destinataire.lines.map((l, i) => (
                <Text key={i} style={i === input.destinataire.lines.length - 1 && /TVA/i.test(l) ? styles.addrInk : styles.addr}>{l}</Text>
              ))}
            </View>
          </View>

          {/* Bandeau dossier & véhicule */}
          <View style={styles.band}>
            <Text style={styles.bandHead}>Dossier & véhicule</Text>
            <View style={styles.kvRow}>
              <Cell k="N° de PV" v={input.pv || '—'} mono />
              <Cell k="Date de saisie" v={fmtD(input.dateSaisie || input.parkedAt)} />
              <Cell k="Entrée en parc" v={fmtD(input.parkedAt)} />
              <Cell k="Période facturée" v={period} last />
            </View>
            <View style={[styles.kvRow, styles.kvRow2]}>
              <View style={styles.cell}><Text style={styles.k}>Immatriculation</Text><Text style={styles.plate}>{input.plate || '—'}</Text></View>
              <Cell k="Véhicule" v={input.vehicle || '—'} />
              <Cell k="N° de châssis (VIN)" v={input.vin || '—'} mono />
              <Cell k="Motif" v={input.motif || '—'} last />
            </View>
          </View>

          {/* Tableau des prestations */}
          <View style={styles.table}>
            <View style={styles.thead}>
              <Text style={[styles.th, styles.cDesc]}>Prestation</Text>
              <Text style={[styles.th, styles.cQty]}>Qté</Text>
              <Text style={[styles.th, styles.cPu]}>P.U. HTVA</Text>
              <Text style={[styles.th, styles.cTot]}>Total HTVA</Text>
            </View>
            {b.lines.map((l, i) => (
              <View key={i} style={styles.tr} wrap={false}>
                <View style={styles.cDesc}>
                  <Text style={styles.chip}>{l.kind}</Text>
                  <Text style={styles.desc}>{l.name}</Text>
                  <Text style={styles.meta}>{lineMeta(l, input.parkedAt)}</Text>
                </View>
                <Text style={[styles.cQty, styles.numTxt]}>{l.qty}</Text>
                <Text style={[styles.cPu, styles.numTxt]}>{eur(l.unitPrice)}</Text>
                <Text style={[styles.cTot, styles.numTxt]}>{eur(l.total)}</Text>
              </View>
            ))}
          </View>

          {/* Totaux */}
          <View style={styles.totals}>
            <View style={styles.totbox}>
              <View style={styles.totrow}><Text style={styles.totT}>Total HTVA</Text><Text style={styles.totV}>{eur(b.totalHtva)}</Text></View>
              <View style={styles.totrow}><Text style={styles.totT}>TVA 21 %</Text><Text style={styles.totV}>{eur(tva)}</Text></View>
              <View style={styles.grand}><Text style={styles.grandT}>Total à charge {RECIP[input.recipient]}</Text><Text style={styles.grandV}>{eur(b.totalTvac)}</Text></View>
            </View>
          </View>

          {/* Pied : QR rattachement + suivi */}
          <View style={styles.foot}>
            <View>
              {qr && <View style={styles.qrframe}><Image style={styles.qrImg} src={qr} /></View>}
              <Text style={styles.qrRef}>{input.numero}</Text>
              <Text style={styles.qrCap}>Scannez pour rattacher le document à la fiche</Text>
            </View>
            <View style={styles.notes}>
              <Text style={styles.lbl}>Suivi & mentions</Text>
              <View style={styles.pill}><View style={styles.pillDot} /><Text style={styles.pillTxt}>En attente de validation {RECIP[input.recipient]}</Text></View>
              <Text style={styles.noteP}>Document établi conformément au réquisitoire joint. Merci de nous le retourner signé, pour accord ou pour refus, par courriel ou par courrier.</Text>
              <Text style={styles.noteSig}>La mention de signature électronique (frais de justice) figure automatiquement sur la facture émise après validation.</Text>
            </View>
          </View>
        </View>

        <Text style={styles.legal}>{COMPANY.name} · {COMPANY.address} · TVA {COMPANY.vat}</Text>
      </Page>
    </Document>
  )
}

function Cell({ k, v, mono, last }: { k: string; v: string; mono?: boolean; last?: boolean }) {
  return (
    <View style={last ? [styles.cell, styles.cellLast] : styles.cell}>
      <Text style={styles.k}>{k}</Text>
      <Text style={mono ? styles.vMono : styles.v}>{v}</Text>
    </View>
  )
}

/** Rend l'état de frais en Buffer PDF (QR = URL de rattachement). */
export async function renderEtatFraisPdf(input: EtatFraisInput): Promise<Buffer> {
  const qr = input.qrUrl ? await QRCode.toDataURL(input.qrUrl, { width: 320, margin: 0 }).catch(() => null as any) : null
  return renderToBuffer(<EtatFraisDoc input={input} qr={qr} logo={logoDataUrl()} /> as any)
}
