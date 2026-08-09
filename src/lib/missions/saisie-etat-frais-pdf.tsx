// src/lib/missions/saisie-etat-frais-pdf.tsx
//
// ÉTAT DE FRAIS (saisie judiciaire) — PDF A4 via @react-pdf/renderer.
// Rendu fidèle à la maquette validée par Olivier (2026-08-09) :
//   • logo Verviers Dépannage + tons rougeâtres maison
//   • titre « État de Frais » + son NUMÉRO en grand juste en dessous
//   • coordonnées émetteur (Lefin 12, 4860 Pepinster — TVA BE0460.759.205)
//   • bloc destinataire (Parquet / Domaine / Client)
//   • tableau des frais (dépannage + gardiennage par période + frais admin client)
//   • totaux HTVA / TVA 21 % / TVAC
//   • QR EPC RÉEL et ENTIER (virement pré-rempli) — pas de mention « saisie »
//
// Les montants viennent de computeSaisieBilling → identiques à la fiche.

import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } from '@react-pdf/renderer'
import { readFileSync } from 'fs'
import { join } from 'path'
import QRCode from 'qrcode'
import { COMPANY } from '@/config/company'
import { buildEpcQrPayload, bankConfigFromEnv } from '@/lib/payments/epc-qr'
import type { SaisieBillingResult, SaisieRecipient } from '@/lib/missions/saisie-billing'

const BRAND  = '#C41E1E'   // rouge Verviers Dépannage
const BRAND_D = '#8F1414'  // rouge foncé (totaux)
const INK    = '#1A1A1E'
const MUTED  = '#6B7280'
const FAINT  = '#9CA3AF'
const BORDER = '#E5E7EB'
const BG     = '#FAF6F6'   // fond légèrement rosé
const BG_RED = '#FBEAEA'

const styles = StyleSheet.create({
  page: { padding: 34, fontSize: 9, fontFamily: 'Helvetica', color: INK },

  // En-tête
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo:       { height: 46, objectFit: 'contain' },
  emitter:    { marginTop: 8 },
  emitName:   { fontSize: 10, fontWeight: 700, color: INK },
  emitLine:   { fontSize: 8, color: MUTED, marginTop: 1.5 },
  titleBox:   { alignItems: 'flex-end' },
  docTitle:   { fontSize: 15, fontWeight: 700, color: BRAND, letterSpacing: 0.5, textTransform: 'uppercase' },
  docNumber:  { fontSize: 24, fontWeight: 700, color: INK, marginTop: 2, letterSpacing: 0.5 },
  docDate:    { fontSize: 8.5, color: MUTED, marginTop: 4 },

  rule:       { height: 2.4, backgroundColor: BRAND, marginTop: 12, marginBottom: 14 },

  // Blocs émetteur / destinataire / véhicule
  cols:       { flexDirection: 'row', gap: 14, marginBottom: 14 },
  card:       { flex: 1, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 5, padding: 10 },
  cardLabel:  { fontSize: 7, fontWeight: 700, color: BRAND, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 },
  cardStrong: { fontSize: 9.5, fontWeight: 700, color: INK },
  cardLine:   { fontSize: 8.5, color: INK, marginTop: 2, lineHeight: 1.3 },
  cardMuted:  { fontSize: 8, color: MUTED, marginTop: 2 },

  // Tableau
  table:      { borderWidth: 1, borderColor: BORDER, borderRadius: 5, overflow: 'hidden', marginBottom: 12 },
  thead:      { flexDirection: 'row', backgroundColor: BRAND },
  th:         { fontSize: 8, fontWeight: 700, color: '#FFFFFF', paddingVertical: 6, paddingHorizontal: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  tr:         { flexDirection: 'row', borderTopWidth: 1, borderTopColor: BORDER },
  trAlt:      { backgroundColor: '#FCFBFB' },
  td:         { fontSize: 8.5, paddingVertical: 6, paddingHorizontal: 8, color: INK },
  tdMuted:    { fontSize: 7.5, color: MUTED, marginTop: 1.5 },
  cDesc:      { flex: 1 },
  cQty:       { width: 62, textAlign: 'right' },
  cPu:        { width: 78, textAlign: 'right' },
  cTot:       { width: 82, textAlign: 'right' },

  // Bas de page : QR + totaux
  bottom:     { flexDirection: 'row', justifyContent: 'space-between', gap: 16, marginTop: 4 },
  qrCard:     { width: 210, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 5, padding: 10, flexDirection: 'row', gap: 10, alignItems: 'center' },
  qrImg:      { width: 84, height: 84 },
  qrLabel:    { fontSize: 8, fontWeight: 700, color: BRAND, textTransform: 'uppercase', letterSpacing: 0.4 },
  qrLine:     { fontSize: 7.5, color: INK, marginTop: 3, lineHeight: 1.3 },
  qrMono:     { fontSize: 7.5, fontFamily: 'Courier', color: INK, marginTop: 2 },

  totals:     { flex: 1, alignItems: 'flex-end', justifyContent: 'flex-end' },
  totRow:     { flexDirection: 'row', justifyContent: 'space-between', width: 210, paddingVertical: 2 },
  totLabel:   { fontSize: 9, color: MUTED },
  totValue:   { fontSize: 9, color: INK, fontWeight: 700 },
  totGrand:   { flexDirection: 'row', justifyContent: 'space-between', width: 210, marginTop: 5, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: BG_RED, borderRadius: 5 },
  totGrandL:  { fontSize: 10, fontWeight: 700, color: BRAND_D },
  totGrandV:  { fontSize: 13, fontWeight: 700, color: BRAND_D },

  footer:     { position: 'absolute', bottom: 20, left: 34, right: 34, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: FAINT, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 6 },
})

// ── Format FR-BE ─────────────────────────────────────────────────────────────
const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`
const fmtDate = (iso?: string | null) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso.slice(0, 10)
}
const RECIPIENT_LABEL: Record<SaisieRecipient, string> = {
  parquet: 'Parquet', domaine: 'Domaine (SPF Finances)', client: 'Client',
}

export interface EtatFraisInput {
  numero: string
  dateEmission?: string            // ISO — défaut aujourd'hui (passé par l'appelant)
  recipient: SaisieRecipient
  destinataire: { name: string; lines?: string[] }
  vehicle: { plate: string; brand?: string | null; model?: string | null }
  dossierRef?: string | null       // n° PV / dossier
  parkedAt: string
  billingTo: string
  leveeSaisieDate?: string | null
  billing: SaisieBillingResult
}

function logoDataUrl(): string | null {
  try {
    const buf = readFileSync(join(process.cwd(), 'public', 'logo.png'))
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch { return null }
}

function EtatFraisDoc({ input, qr, logo }: { input: EtatFraisInput; qr: string | null; logo: string | null }) {
  const { billing } = input
  const bank = bankConfigFromEnv()
  const rows = billing.lines
  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* En-tête : logo + émetteur | titre + numéro */}
        <View style={styles.header}>
          <View>
            {logo ? <Image style={styles.logo} src={logo} /> : <Text style={styles.emitName}>{COMPANY.name}</Text>}
            <View style={styles.emitter}>
              <Text style={styles.emitName}>{COMPANY.name}</Text>
              <Text style={styles.emitLine}>{COMPANY.address}</Text>
              <Text style={styles.emitLine}>TVA : {COMPANY.vat}</Text>
            </View>
          </View>
          <View style={styles.titleBox}>
            <Text style={styles.docTitle}>État de Frais</Text>
            <Text style={styles.docNumber}>{input.numero}</Text>
            <Text style={styles.docDate}>Émis le {fmtDate(input.dateEmission)}</Text>
          </View>
        </View>

        <View style={styles.rule} />

        {/* Destinataire + véhicule */}
        <View style={styles.cols}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Destinataire — {RECIPIENT_LABEL[input.recipient]}</Text>
            <Text style={styles.cardStrong}>{input.destinataire.name}</Text>
            {(input.destinataire.lines || []).map((l, i) => <Text key={i} style={styles.cardLine}>{l}</Text>)}
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Véhicule</Text>
            <Text style={styles.cardStrong}>{input.vehicle.plate || '—'}</Text>
            <Text style={styles.cardLine}>{[input.vehicle.brand, input.vehicle.model].filter(Boolean).join(' ') || '—'}</Text>
            <Text style={styles.cardMuted}>Entrée en parc : {fmtDate(input.parkedAt)}</Text>
            {input.leveeSaisieDate && <Text style={styles.cardMuted}>Levée de saisie : {fmtDate(input.leveeSaisieDate)}</Text>}
            {input.dossierRef && <Text style={styles.cardMuted}>Réf. : {input.dossierRef}</Text>}
          </View>
        </View>

        {/* Tableau des frais */}
        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={[styles.th, styles.cDesc]}>Description</Text>
            <Text style={[styles.th, styles.cQty]}>Qté</Text>
            <Text style={[styles.th, styles.cPu]}>P.U. HTVA</Text>
            <Text style={[styles.th, styles.cTot]}>Total HTVA</Text>
          </View>
          {rows.map((l, i) => (
            <View key={i} style={[styles.tr, ...(i % 2 ? [styles.trAlt] : [])]} wrap={false}>
              <View style={[styles.td, styles.cDesc]}>
                <Text>{l.name}</Text>
                {l.period && <Text style={styles.tdMuted}>{fmtDate(l.period.from)} au {fmtDate(l.period.to)} · {l.qty} nuit{l.qty > 1 ? 's' : ''}</Text>}
              </View>
              <Text style={[styles.td, styles.cQty]}>{l.qty}</Text>
              <Text style={[styles.td, styles.cPu]}>{eur(l.unitPrice)}</Text>
              <Text style={[styles.td, styles.cTot]}>{eur(l.total)}</Text>
            </View>
          ))}
        </View>

        {/* QR réel + totaux */}
        <View style={styles.bottom}>
          {qr && bank ? (
            <View style={styles.qrCard}>
              <Image style={styles.qrImg} src={qr} />
              <View style={{ flex: 1 }}>
                <Text style={styles.qrLabel}>Payez en scannant</Text>
                <Text style={styles.qrLine}>Avec votre app bancaire</Text>
                <Text style={styles.qrMono}>{bank.iban}</Text>
                <Text style={styles.qrLine}>Comm. : {input.numero}</Text>
              </View>
            </View>
          ) : <View />}

          <View style={styles.totals}>
            <View style={styles.totRow}>
              <Text style={styles.totLabel}>Total HTVA</Text>
              <Text style={styles.totValue}>{eur(billing.totalHtva)}</Text>
            </View>
            <View style={styles.totRow}>
              <Text style={styles.totLabel}>TVA 21 %</Text>
              <Text style={styles.totValue}>{eur(billing.totalTvac - billing.totalHtva)}</Text>
            </View>
            <View style={styles.totGrand}>
              <Text style={styles.totGrandL}>TOTAL À PAYER (TVAC)</Text>
              <Text style={styles.totGrandV}>{eur(billing.totalTvac)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{COMPANY.name} · {COMPANY.address} · TVA {COMPANY.vat} · {bank?.iban}</Text>
          <Text>Généré par VD Soft</Text>
        </View>
      </Page>
    </Document>
  )
}

/** Rend l'état de frais en Buffer PDF. */
export async function renderEtatFraisPdf(input: EtatFraisInput): Promise<Buffer> {
  const bank = bankConfigFromEnv()
  let qr: string | null = null
  if (bank && input.billing.totalTvac > 0) {
    const payload = buildEpcQrPayload({
      name: bank.name, iban: bank.iban, bic: bank.bic,
      amount: input.billing.totalTvac, remittance: input.numero,
    })
    qr = await QRCode.toDataURL(payload, { width: 320, margin: 1 }).catch(() => null as any)
  }
  return renderToBuffer(<EtatFraisDoc input={input} qr={qr} logo={logoDataUrl()} /> as any)
}
