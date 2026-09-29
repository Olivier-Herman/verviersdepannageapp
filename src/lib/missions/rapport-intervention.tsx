// src/lib/missions/rapport-intervention.tsx
//
// Rapport d'intervention JOINT À LA FACTURE, pour les sources portant le tag
// `rapport_facture` (EBAC, Centracar — Olivier 29/09/2026, maquette validée
// https://claude.ai/artifact/7uQtYjfDGLsFZz5mjGu4eu). Une page A4 :
// véhicule, panne et résultat, lieu d'intervention (+ dépôt + adresse de
// livraison en REM / REM+REL), constat du chauffeur, 4 photos, nom + prénom +
// signature de la personne dépannée (DSP) ou du réceptionnaire (REM, REM+REL).
// Pas de pointages horaires, pas de chauffeur ni de camion : la date suffit.
//
// Exception à la règle « jamais de rapport sur une facture » (attach-mission-pdf.ts),
// limitée à ces sources par leur tag, jamais par un test sur la source.

import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } from '@react-pdf/renderer'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc } from '@/lib/odoo'
import { attachToOdoo } from '@/lib/odoo-attachment'
import { isRemorquage } from '@/lib/missions/mission-types'
import { sourceHasTag, sourceLabel } from '@/lib/missions/source-catalog'
import { COMPANIES } from '@/lib/mail-agent/handlers/fournisseur'

const INK = '#1F1A17', MUTED = '#6B625A', LINE = '#D9D2CA', FILL = '#F6F3F0', BRAND = '#C8102E'

const s = StyleSheet.create({
  page: { padding: 34, fontSize: 9.5, fontFamily: 'Helvetica', color: INK },
  head: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 10 },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  mark: { width: 30, height: 30, borderRadius: 4, backgroundColor: BRAND, color: '#fff', fontSize: 12, fontFamily: 'Helvetica-Bold', textAlign: 'center', paddingTop: 8, marginRight: 8 },
  brandName: { fontSize: 11.5, fontFamily: 'Helvetica-Bold' },
  small: { fontSize: 8, color: MUTED },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  mono: { fontFamily: 'Courier' },
  kicker: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, fontSize: 9 },
  kItem: { marginRight: 16, marginBottom: 2 },
  row2: { flexDirection: 'row', marginTop: 10 },
  box: { borderWidth: 1, borderColor: LINE, borderRadius: 3, marginTop: 10 },
  boxHalf: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 3 },
  boxTitle: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, paddingVertical: 5, paddingHorizontal: 8, backgroundColor: FILL, borderBottomWidth: 1, borderBottomColor: LINE },
  dl: { paddingVertical: 6, paddingHorizontal: 8 },
  dRow: { flexDirection: 'row', marginBottom: 2.5 },
  dt: { width: 90, color: MUTED },
  dd: { flex: 1 },
  stop: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 4 },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: INK, marginRight: 8, marginTop: 1 },
  stopLabel: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  note: { paddingVertical: 7, paddingHorizontal: 8, lineHeight: 1.4 },
  photos: { flexDirection: 'row', padding: 6 },
  photo: { width: '25%', paddingHorizontal: 3 },
  img: { width: '100%', height: 92, objectFit: 'cover', borderWidth: 1, borderColor: LINE },
  sigRow: { flexDirection: 'row' },
  sigPad: { flex: 1, padding: 8, borderLeftWidth: 1, borderLeftColor: LINE },
  sigImg: { height: 60, objectFit: 'contain', borderBottomWidth: 1, borderBottomColor: INK },
  legal: { fontSize: 7.5, color: MUTED, marginTop: 8 },
  foot: { position: 'absolute', left: 34, right: 34, bottom: 22, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: LINE, paddingTop: 5, fontSize: 7.5, color: MUTED },
})

type Kind = 'dsp' | 'rem' | 'remrel'
export interface RapportData {
  kind: Kind
  company: { name: string; address: string; vat: string }
  number: string
  client: string
  clientRef: string | null
  invoiceName: string | null
  date: string
  vehicle: { brandModel: string; plate: string; vin: string; mileage: string }
  panne: string
  result: string
  stops: { label: string; address: string }[]
  constat: string
  photos: string[]          // data URI JPEG
  signer: { last: string; first: string; role: string; where: string; signature: string | null }
}

const KIND_LABEL: Record<Kind, string> = { dsp: 'Dépannage sur place (DSP)', rem: 'Remorquage (REM)', remrel: 'Remorquage avec relivraison (REM + REL)' }

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <View style={s.dRow}><Text style={s.dt}>{k}</Text><Text style={mono ? [s.dd, s.mono] : s.dd}>{v || '—'}</Text></View>
}

export function RapportDocument({ d }: { d: RapportData }) {
  const dsp = d.kind === 'dsp'
  return (
    <Document title={`Rapport d'intervention ${d.number}`} author={d.company.name}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <View style={s.brandRow}>
            <Text style={s.mark}>VD</Text>
            <View><Text style={s.brandName}>{d.company.name}</Text><Text style={s.small}>{[d.company.address, d.company.vat && `TVA ${d.company.vat}`].filter(Boolean).join(' · ')}</Text></View>
          </View>
          <View><Text style={s.title}>Rapport d’intervention</Text><Text style={[s.small, s.mono, { textAlign: 'right' }]}>Fiche {d.number} · {KIND_LABEL[d.kind]}</Text></View>
        </View>
        <View style={s.kicker}>
          <Text style={s.kItem}><Text style={{ color: MUTED }}>Client : </Text>{d.client}</Text>
          {d.clientRef ? <Text style={s.kItem}><Text style={{ color: MUTED }}>Réf. client : </Text>{d.clientRef}</Text> : null}
          {d.invoiceName ? <Text style={s.kItem}><Text style={{ color: MUTED }}>Facture : </Text>{d.invoiceName}</Text> : null}
          <Text style={s.kItem}><Text style={{ color: MUTED }}>Date : </Text>{d.date}</Text>
        </View>

        <View style={s.row2}>
          <View style={[s.boxHalf, { marginRight: 8 }]}>
            <Text style={s.boxTitle}>Véhicule</Text>
            <View style={s.dl}>
              <Row k="Marque, modèle" v={d.vehicle.brandModel} />
              <Row k="Plaque" v={d.vehicle.plate} mono />
              <Row k="Châssis (VIN)" v={d.vehicle.vin} mono />
              <Row k="Kilométrage" v={d.vehicle.mileage} mono />
            </View>
          </View>
          <View style={s.boxHalf}>
            <Text style={s.boxTitle}>Intervention</Text>
            <View style={s.dl}>
              <Row k="Panne signalée" v={d.panne} />
              <Row k="Résultat" v={d.result} />
            </View>
          </View>
        </View>

        <View style={s.box}>
          <Text style={s.boxTitle}>{dsp ? 'Lieu d’intervention' : d.kind === 'rem' ? 'Lieu d’intervention et livraison' : 'Lieu d’intervention, dépôt et livraison'}</Text>
          {d.stops.map((st, i) => (
            <View key={i} style={s.stop}>
              <View style={[s.dot, i === d.stops.length - 1 ? { backgroundColor: INK } : {}]} />
              <View>{d.stops.length > 1 ? <Text style={s.stopLabel}>{st.label}</Text> : null}<Text>{st.address || '—'}</Text></View>
            </View>
          ))}
        </View>

        <View style={s.box}>
          <Text style={s.boxTitle}>Constat et travaux du chauffeur</Text>
          <Text style={s.note}>{d.constat || '—'}</Text>
        </View>

        <View style={s.box}>
          <Text style={s.boxTitle}>Photos du véhicule ({d.photos.length})</Text>
          <View style={s.photos}>
            {d.photos.map((p, i) => <View key={i} style={s.photo}><Image src={p} style={s.img} /></View>)}
          </View>
        </View>

        <View style={s.box} wrap={false}>
          <Text style={s.boxTitle}>{dsp ? 'Personne dépannée' : 'Réceptionnaire à la livraison'}</Text>
          <View style={s.sigRow}>
            <View style={[s.dl, { flex: 1.2 }]}>
              <Row k="Nom" v={d.signer.last} />
              <Row k="Prénom" v={d.signer.first} />
              <Row k="Qualité" v={d.signer.role} />
              <Row k="Lieu" v={d.signer.where} />
            </View>
            <View style={s.sigPad}>
              {d.signer.signature ? <Image src={d.signer.signature} style={s.sigImg} /> : <View style={[s.sigImg, { height: 60 }]} />}
              <Text style={[s.small, { marginTop: 3 }]}>Signature</Text>
            </View>
          </View>
        </View>
        <Text style={s.legal}>{dsp ? 'Le signataire confirme l’intervention décrite ci-dessus et l’état du véhicule tel que photographié.' : 'Le réceptionnaire confirme avoir reçu le véhicule à l’adresse de livraison, dans l’état photographié.'}</Text>

        <View style={s.foot} fixed><Text>{[d.company.name, d.company.address].filter(Boolean).join(' · ')}</Text><Text>Page 1/1</Text></View>
      </Page>
    </Document>
  )
}

// ── Données ──────────────────────────────────────────────────────────────────

const COLS = 'id, mission_number, source, mission_type, parent_mission_id, vehicle_brand, vehicle_model, vehicle_plate, vehicle_vin, vehicle_mileage, incident_address, incident_description, incident_type, destination_address, destination_name, closing_notes, driver_photos, client_signature, client_signature_name, signer_last_name, signer_first_name, intervention_date, received_at, dossier_number, billed_to_name, created_at'

async function photoData(url: string): Promise<string | null> {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000)
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); clearTimeout(t)
    if (!r.ok) return null
    const buf = await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize({ width: 700, height: 520, fit: 'cover' }).jpeg({ quality: 72 }).toBuffer()
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch { return null }
}

async function signatureData(v: string | null | undefined): Promise<string | null> {
  if (!v) return null
  if (v.startsWith('data:image/')) return v
  if (/^https?:\/\//.test(v)) {
    try { const r = await fetch(v, { cache: 'no-store' }); if (!r.ok) return null; const b = Buffer.from(await r.arrayBuffer()); return `data:${r.headers.get('content-type') || 'image/png'};base64,${b.toString('base64')}` } catch { return null }
  }
  return null
}

const isRel = (m: any) => /relivraison|^rel$/i.test(String(m.mission_type || ''))
const dmy = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' }) : ''

async function companyInfo(): Promise<RapportData['company']> {
  try {
    const [c] = await odooRpc<any[]>('res.company', 'read', [[COMPANIES.vd.id]], { fields: ['name', 'street', 'zip', 'city', 'vat'] })
    return { name: c?.name || COMPANIES.vd.label, address: [c?.street, [c?.zip, c?.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), vat: c?.vat || COMPANIES.vd.vat }
  } catch { return { name: COMPANIES.vd.label, address: '', vat: COMPANIES.vd.vat } }
}

/** Données du rapport pour les missions d'une facture (REM seul, DSP seul, ou REM + REL). */
export async function buildRapportData(missionIds: string[], invoiceName: string | null): Promise<RapportData | null> {
  const sb = createAdminClient()
  const { data: rows } = await sb.from('incoming_missions').select(COLS).in('id', missionIds)
  const list = (rows || []) as any[]
  if (!list.length) return null
  const rel = list.find(isRel) || null
  let root = list.find(m => !isRel(m)) || null
  if (!root && rel?.parent_mission_id) root = ((await sb.from('incoming_missions').select(COLS).eq('id', rel.parent_mission_id).maybeSingle()).data as any) || null
  root = root || rel
  const kind: Kind = rel && root !== rel ? 'remrel' : isRemorquage(root.mission_type) ? 'rem' : 'dsp'
  const signerM = kind === 'remrel' ? rel : root
  const photoUrls = [...(root.driver_photos || []), ...(kind === 'remrel' ? (rel.driver_photos || []) : [])].slice(0, 4)
  const photos = (await Promise.all(photoUrls.map(photoData))).filter(Boolean) as string[]
  const stops = kind === 'dsp'
    ? [{ label: 'Lieu d’intervention', address: root.incident_address || '' }]
    : kind === 'rem'
      ? [{ label: 'Lieu d’intervention', address: root.incident_address || '' }, { label: 'Adresse de livraison', address: [root.destination_name, root.destination_address].filter(Boolean).join(', ') }]
      : [{ label: 'Lieu d’intervention', address: root.incident_address || '' }, { label: 'Dépôt', address: [root.destination_name, root.destination_address].filter(Boolean).join(', ') }, { label: 'Adresse de livraison', address: [rel.destination_name, rel.destination_address].filter(Boolean).join(', ') }]
  const nameParts = String(signerM.client_signature_name || '').trim().split(/\s+/)
  return {
    kind, company: await companyInfo(),
    number: kind === 'remrel' ? `${root.mission_number} + ${rel.mission_number}` : String(root.mission_number),
    client: await sourceLabel(root.source), clientRef: root.dossier_number || null, invoiceName,
    date: dmy(root.intervention_date || root.received_at || root.created_at),
    vehicle: { brandModel: [root.vehicle_brand, root.vehicle_model].filter(Boolean).join(' '), plate: root.vehicle_plate || '', vin: root.vehicle_vin || '', mileage: root.vehicle_mileage ? `${String(Math.round(Number(root.vehicle_mileage))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} km` : '' },   // espace simple : la police du PDF n'a pas l'espace fine
    panne: root.incident_description || root.incident_type || '',
    result: kind === 'dsp' ? 'Véhicule dépanné sur place' : kind === 'rem' ? 'Véhicule remorqué et livré' : 'Remorqué au dépôt puis relivré',
    stops,
    constat: [root.closing_notes, kind === 'remrel' ? rel.closing_notes : null].filter(Boolean).join('\n'),
    photos,
    signer: {
      last: signerM.signer_last_name || (nameParts.length > 1 ? nameParts.slice(-1)[0] : ''),
      first: signerM.signer_first_name || (nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : nameParts[0] || ''),
      role: kind === 'dsp' ? 'Personne dépannée' : 'Réceptionnaire',
      where: kind === 'dsp' ? (root.incident_address || '') : stops[stops.length - 1].address,
      signature: await signatureData(signerM.client_signature),
    },
  }
}

export async function renderRapportPdf(d: RapportData): Promise<Buffer> {
  return renderToBuffer(<RapportDocument d={d} /> as any)
}

/**
 * À appeler après la création d'une facture Odoo : si la source porte le tag
 * `rapport_facture`, génère le rapport et le joint à la facture (une seule fois
 * par facture). Jamais bloquant : une erreur est journalisée sur la fiche.
 */
export async function attachRapportIfRequired(moveId: number, missionIds: string[], invoiceName: string | null = null): Promise<{ attached: boolean; reason?: string }> {
  const sb = createAdminClient()
  const { data: ms } = await sb.from('incoming_missions').select('id, source, report_attached_move_ids').in('id', missionIds)
  const list = (ms || []) as any[]
  const tagged = []
  for (const m of list) if (await sourceHasTag(m.source, 'rapport_facture')) tagged.push(m)
  if (!tagged.length) return { attached: false, reason: 'source sans rapport' }
  if (tagged.some(m => (m.report_attached_move_ids || []).includes(moveId))) return { attached: false, reason: 'déjà joint' }
  try {
    const d = await buildRapportData(tagged.map(m => m.id), invoiceName)
    if (!d) return { attached: false, reason: 'données absentes' }
    const pdf = await renderRapportPdf(d)
    const att = await attachToOdoo({ resModel: 'account.move', resId: moveId, filename: `Rapport-intervention-${d.number.replace(/\s+/g, '')}.pdf`, base64Data: pdf.toString('base64'), mimetype: 'application/pdf', description: `Rapport d’intervention (${d.client})` })
    // Le rapport ne doit JAMAIS devenir la pièce principale de la facture : l'export
    // vers le comptable prendrait le rapport au lieu du PDF de facture (raison de la
    // règle du 10/06/2026). On rend la place au PDF de facture, ou on la laisse vide
    // pour qu'Odoo y mette la facture quand il la génère.
    const [mv] = await odooRpc<any[]>('account.move', 'read', [[moveId]], { fields: ['message_main_attachment_id', 'invoice_pdf_report_id'] })
    const main = Array.isArray(mv?.message_main_attachment_id) ? mv.message_main_attachment_id[0] : null
    if (main === att.attachmentId) {
      const pdfId = Array.isArray(mv?.invoice_pdf_report_id) ? mv.invoice_pdf_report_id[0] : false
      await odooRpc('account.move', 'write', [[moveId], { message_main_attachment_id: pdfId || false }])
    }
    for (const m of tagged) {
      await sb.from('incoming_missions').update({ report_attached_move_ids: [...(m.report_attached_move_ids || []), moveId] }).eq('id', m.id)
      await sb.from('mission_logs').insert({ mission_id: m.id, action: 'rapport_facture', notes: `Rapport d’intervention joint à la facture${invoiceName ? ` ${invoiceName}` : ''} (${d.client}).`, metadata: { move_id: moveId } })
    }
    return { attached: true }
  } catch (e: any) {
    for (const m of tagged) await sb.from('mission_logs').insert({ mission_id: m.id, action: 'rapport_facture_error', notes: `Rapport d’intervention NON joint à la facture : ${e?.message || 'erreur'}. À joindre à la main.`, metadata: { move_id: moveId } })
    return { attached: false, reason: e?.message || 'erreur' }
  }
}
