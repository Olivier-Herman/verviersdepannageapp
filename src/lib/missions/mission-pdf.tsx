// src/lib/missions/mission-pdf.tsx
//
// Template PDF resume mission via @react-pdf/renderer.
// Genere un PDF lisible (header + sections client/vehicule + timeline +
// encaissement si applicable + grille de photos miniatures + signatures).
//
// Une seule mission OU un chain de missions (REM+REL combine). Si plusieurs
// missions, chacune a sa section dans le PDF.

import React from 'react'
import {
  Document, Page, Text, View, StyleSheet, Image, Link,
} from '@react-pdf/renderer'

const COLOR_BRAND  = '#E11D2E'
const COLOR_INK    = '#0F172A'
const COLOR_MUTED  = '#64748B'
const COLOR_FAINT  = '#94A3B8'
const COLOR_BORDER = '#E2E8F0'
const COLOR_BG     = '#F8FAFC'

const styles = StyleSheet.create({
  page: {
    padding:   28,
    fontSize:  9,
    fontFamily: 'Helvetica',
    color: COLOR_INK,
  },
  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems:    'flex-start',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: COLOR_BRAND,
  },
  headerLeft:  { flex: 1 },
  headerRight: { alignItems: 'flex-end' },
  brand:       { fontSize: 14, fontWeight: 700, color: COLOR_BRAND, marginBottom: 2 },
  brandSub:    { fontSize:  8, color: COLOR_MUTED },
  docTitle:    { fontSize: 12, fontWeight: 700, marginBottom: 2 },
  docMeta:     { fontSize:  8, color: COLOR_MUTED, lineHeight: 1.3 },

  // Sections
  section:        { marginBottom: 10 },
  sectionTitle:   {
    fontSize: 9, fontWeight: 700, color: COLOR_BRAND,
    paddingBottom: 3, marginBottom: 6,
    borderBottomWidth: 1, borderBottomColor: COLOR_BORDER,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  row:            { flexDirection: 'row', marginBottom: 3 },
  rowLabel:       { width: 100, color: COLOR_MUTED, fontSize: 8 },
  rowValue:       { flex: 1, fontSize: 9 },
  rowValueMono:   { flex: 1, fontSize: 9, fontFamily: 'Courier' },

  // 2-col grid for info
  grid2:          { flexDirection: 'row', gap: 14 },
  grid2Col:       { flex: 1 },

  // Timeline
  timelineRow:    {
    flexDirection: 'row',
    marginBottom: 4,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: COLOR_BORDER,
  },
  timelineDate:   { width: 95, fontSize: 8, color: COLOR_MUTED },
  timelineAction: { flex: 1, fontSize: 9 },

  // Photo grid
  photosGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photoBox:       {
    width:  160,
    height: 120,
    backgroundColor: COLOR_BG,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 4,
    overflow: 'hidden',
  },
  photoImg:       { width: '100%', height: '100%', objectFit: 'cover' },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 18, left: 28, right: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: COLOR_FAINT,
    borderTopWidth: 1,
    borderTopColor: COLOR_BORDER,
    paddingTop: 6,
  },

  // Mission separator (chain)
  missionDivider: {
    marginTop: 16,
    marginBottom: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLOR_BORDER,
  },

  // Tampon (stamp)
  stamp: {
    position: 'absolute',
    top: 28, right: 28,
    padding: 4,
    borderWidth: 2,
    borderColor: COLOR_BRAND,
    borderRadius: 4,
    fontSize: 8,
    fontWeight: 700,
    color: COLOR_BRAND,
    textTransform: 'uppercase',
  },
})

// ── Types ─────────────────────────────────────────────────────

export interface MissionPdfData {
  id:                string
  externalId:        string | null
  dossierNumber:     string | null
  source:            string | null
  status:            string
  missionType:       string | null
  incidentType:      string | null
  kindLabel:         string                 // ex: "REM", "DSP", "REL", "DPR"
  interventionDate:  string | null
  receivedAt:        string
  completedAt:       string | null
  clientName:        string | null
  clientPhone:       string | null
  vehiclePlate:      string | null
  vehicleBrand:      string | null
  vehicleModel:      string | null
  vehicleVin:        string | null
  incidentAddress:   string | null
  destinationAddress: string | null
  // Encaissement
  amountToCollect:   number | null
  amountCollected:   number | null
  paymentMode:       string | null
  // Facturation
  invoiceMethod:     'manual' | 'auto' | null
  invoiceNumber:     string | null
  noChargeAt:        string | null
  noChargeReason:    string | null
  // Timeline
  logs: Array<{
    actionLabel: string
    notes:       string | null
    occurredAt:  string
  }>
  // Photos (URLs deja resolved en base64 par l'orchestrateur)
  photosBase64: Array<{ src: string; label?: string }>
}

interface DocProps {
  missions:      MissionPdfData[]
  generatedAt:   string
  generatedBy?:  string
  stamp?:        string   // ex: "FACTURÉE", "SANS FRAIS"
}

// ── Helpers d'affichage ───────────────────────────────────────

function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return '—' }
}

function fmtDateTime(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return '—' }
}

const SOURCE_LABEL: Record<string, string> = {
  touring: 'Touring', allianz: 'Allianz', vab: 'VAB', axa: 'AXA',
  ethias: 'Ethias', vivium: 'Vivium', mondial: 'Mondial',
  appel_police_accident: 'Police Accident', prive: 'Privé', garage: 'Garage',
}
function fmtSource(s: string | null): string {
  if (!s) return '—'
  return SOURCE_LABEL[s.toLowerCase()] || s
}

// ── Sub-components ────────────────────────────────────────────

function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={mono ? styles.rowValueMono : styles.rowValue}>{value || '—'}</Text>
    </View>
  )
}

function MissionSection({ m }: { m: MissionPdfData }) {
  const veh = [m.vehicleBrand, m.vehicleModel].filter(Boolean).join(' ') || '—'
  return (
    <>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {m.kindLabel} · {m.externalId || m.dossierNumber || m.id.slice(0, 8)}
        </Text>
        <View style={styles.grid2}>
          <View style={styles.grid2Col}>
            <Field label="Source"            value={fmtSource(m.source)} />
            <Field label="Date intervention" value={fmtDateTime(m.interventionDate || m.receivedAt)} />
            <Field label="Cloturee"          value={fmtDateTime(m.completedAt)} />
            <Field label="Client"            value={m.clientName} />
            {m.clientPhone && <Field label="Telephone" value={m.clientPhone} mono />}
          </View>
          <View style={styles.grid2Col}>
            <Field label="Plaque"   value={m.vehiclePlate} mono />
            <Field label="Vehicule" value={veh} />
            {m.vehicleVin && <Field label="VIN" value={m.vehicleVin} mono />}
            {m.invoiceNumber && <Field label="N° Facture" value={m.invoiceNumber} mono />}
            {m.invoiceMethod === 'auto' && <Field label="Facturation" value="Auto-facturation" />}
            {m.noChargeAt && <Field label="Sans frais" value={m.noChargeReason || 'Oui'} />}
          </View>
        </View>
      </View>

      {(m.incidentAddress || m.destinationAddress) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trajet</Text>
          {m.incidentAddress    && <Field label="Lieu intervention" value={m.incidentAddress} />}
          {m.destinationAddress && <Field label="Destination"       value={m.destinationAddress} />}
        </View>
      )}

      {(m.amountToCollect != null || m.amountCollected != null) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Encaissement</Text>
          {m.amountToCollect != null && <Field label="A encaisser" value={`${m.amountToCollect.toFixed(2)} €`} />}
          {m.amountCollected != null && <Field label="Encaisse"    value={`${m.amountCollected.toFixed(2)} €`} />}
          {m.paymentMode             && <Field label="Mode"         value={m.paymentMode} />}
        </View>
      )}

      {m.logs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Suivi chauffeur</Text>
          {m.logs.map((l, i) => (
            <View key={i} style={styles.timelineRow}>
              <Text style={styles.timelineDate}>{fmtDateTime(l.occurredAt)}</Text>
              <Text style={styles.timelineAction}>
                {l.actionLabel}{l.notes ? ` — ${l.notes}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      {m.photosBase64.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos ({m.photosBase64.length})</Text>
          <View style={styles.photosGrid}>
            {m.photosBase64.map((p, i) => (
              <View key={i} style={styles.photoBox}>
                <Image style={styles.photoImg} src={p.src} />
              </View>
            ))}
          </View>
        </View>
      )}
    </>
  )
}

// ── Document principal ────────────────────────────────────────

export function MissionPdfDocument({ missions, generatedAt, generatedBy, stamp }: DocProps) {
  if (missions.length === 0) {
    return (
      <Document>
        <Page size="A4" style={styles.page}>
          <Text>Aucune mission a afficher</Text>
        </Page>
      </Document>
    )
  }

  const first = missions[0]
  const refLabel = missions.length === 1
    ? (first.externalId || first.dossierNumber || first.id.slice(0, 8))
    : `Chaine ${missions.map(m => m.kindLabel).join('+')} · ${first.externalId || first.id.slice(0, 8)}`

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.brand}>VERVIERS DÉPANNAGE</Text>
            <Text style={styles.brandSub}>Rue du parc 32, 4800 Verviers · 087 31 32 33</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.docTitle}>Rapport mission</Text>
            <Text style={styles.docMeta}>{refLabel}</Text>
            <Text style={styles.docMeta}>{fmtSource(first.source)}</Text>
          </View>
        </View>

        {stamp && <Text style={styles.stamp}>{stamp}</Text>}

        {/* Sections par mission */}
        {missions.map((m, i) => (
          <View key={m.id} wrap={false}>
            {i > 0 && <View style={styles.missionDivider} />}
            <MissionSection m={m} />
          </View>
        ))}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>Genere le {fmtDateTime(generatedAt)}{generatedBy ? ` par ${generatedBy}` : ''}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
