// src/lib/documents/abandon-pdf.tsx
//
// « Abandon volontaire de véhicule » en PDF, français ou néerlandais — même
// contenu que le document imprimable de la fiche (api/missions/[id]/abandon-doc).
// Sert à Mobia (Olivier 03/10/2026) : document prérempli depuis la fiche, joint
// au brouillon, JAMAIS signé ni envoyé ; un champ inconnu reste une ligne vide.

import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import * as React from 'react'
import { COMPANY } from '@/config/company'

export type AbandonLang = 'fr' | 'nl'
export interface AbandonDocData {
  ref:       string | null          // « #10168979 »
  dateIso:   string                 // date du document
  vehicle:   { brand?: string | null; model?: string | null; plate?: string | null; vin?: string | null }
  owner:     { firstName?: string | null; lastName?: string | null; birthDate?: string | null; street?: string | null; zip?: string | null; city?: string | null; country?: string | null }
  waiveStorage: boolean
  place?:    string | null
  staffName?: string | null
}

const T = {
  fr: { title: 'Abandon volontaire de véhicule', date: 'Date', dossier: 'Dossier', infos: 'Infos véhicule :', brand: 'Marque', model: 'Modèle', plate: 'Immatriculation', vin: 'VIN', tel: 'Tél.', vat: 'TVA',
    stmt: (who: string, born: string, addr: string) => `Je soussigné(e) ${who}, né(e) le ${born}, domicilié(e) ${addr}, déclare par la présente faire abandon du véhicule dont référence ci-dessus à la société ${COMPANY.name}, Avenue des Nations Unies 18, 4800 Verviers (TVA ${COMPANY.vat}).`,
    waive: 'Cet abandon intervient en échange de l’annulation des frais de gardiennage relatifs à ce véhicule, dus à ce jour. Les parties sont ainsi intégralement libérées l’une envers l’autre à ce titre.',
    place: (p: string, d: string) => `Fait librement à ${p}, le ${d}.`, sigClient: 'Signature du client', sigVd: `Pour ${COMPANY.name}`, footer: `${COMPANY.name} · Document généré par VD Soft` },
  nl: { title: 'Vrijwillige afstand van voertuig', date: 'Datum', dossier: 'Dossier', infos: 'Voertuiggegevens:', brand: 'Merk', model: 'Model', plate: 'Kenteken', vin: 'VIN', tel: 'Tel.', vat: 'Btw',
    stmt: (who: string, born: string, addr: string) => `Ondergetekende ${who}, geboren op ${born}, wonende te ${addr}, verklaart hierbij afstand te doen van het hierboven vermelde voertuig ten gunste van de vennootschap ${COMPANY.name}, Avenue des Nations Unies 18, 4800 Verviers (btw ${COMPANY.vat}).`,
    waive: 'Deze afstand gebeurt in ruil voor de kwijtschelding van de stallingskosten die tot op heden voor dit voertuig verschuldigd zijn. De partijen zijn hiermee op dit punt volledig van elkaar gekweten.',
    place: (p: string, d: string) => `In vrijheid opgemaakt te ${p} op ${d}.`, sigClient: 'Handtekening van de klant', sigVd: `Voor ${COMPANY.name}`, footer: `${COMPANY.name} · Document gegenereerd door VD Soft` },
}

const BLANK = '____________________'
const RED = '#CC0000'
const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10.5, fontFamily: 'Helvetica', color: '#1a1a1a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 2, borderBottomColor: RED, paddingBottom: 12, marginBottom: 28 },
  company: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: RED },
  sub: { fontSize: 9, color: '#666', marginTop: 3, lineHeight: 1.4 },
  ref: { fontSize: 9, color: '#444', textAlign: 'right', lineHeight: 1.5 },
  title: { fontSize: 15, fontFamily: 'Helvetica-BoldOblique', textAlign: 'center', textDecoration: 'underline', textTransform: 'uppercase', marginBottom: 22 },
  label: { fontFamily: 'Helvetica-Bold' },
  section: { fontFamily: 'Helvetica-BoldOblique', marginTop: 16, marginBottom: 6 },
  vehicle: { flexDirection: 'row', backgroundColor: '#f5f5f5', borderRadius: 6, padding: 12, marginBottom: 20 },
  vcol: { flex: 1 },
  vlab: { fontSize: 8, color: '#666', textTransform: 'uppercase' },
  vval: { fontFamily: 'Helvetica-Bold', marginTop: 3 },
  stmt: { lineHeight: 1.5, textAlign: 'justify', marginBottom: 16 },
  waive: { borderLeftWidth: 3, borderLeftColor: RED, backgroundColor: '#fafafa', padding: 10, lineHeight: 1.4, marginBottom: 20 },
  place: { marginTop: 10, marginBottom: 36 },
  sigs: { flexDirection: 'row', justifyContent: 'space-between' },
  sigcol: { width: '45%' },
  sigline: { height: 70, borderBottomWidth: 1, borderBottomColor: '#999' },
  signame: { fontSize: 9, color: '#666', marginTop: 4 },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, fontSize: 8, color: '#999', textAlign: 'center' },
})

const fmt = (iso: string, lang: AbandonLang, long = false) => new Date(iso).toLocaleDateString(lang === 'nl' ? 'nl-BE' : 'fr-BE', long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Champs laissés vides (pour le dire dans le brouillon). */
export function abandonMissingFields(d: AbandonDocData): string[] {
  const miss: string[] = []
  if (!d.owner.firstName && !d.owner.lastName) miss.push('nom du propriétaire')
  if (!d.owner.birthDate) miss.push('date de naissance')
  if (!d.owner.street || !d.owner.city) miss.push('adresse du propriétaire')
  if (!d.vehicle.plate) miss.push('immatriculation')
  if (!d.vehicle.vin) miss.push('numéro de châssis (VIN)')
  return miss
}

export async function renderAbandonPdf(d: AbandonDocData, lang: AbandonLang): Promise<Buffer> {
  const t = T[lang]
  const who = [d.owner.firstName, d.owner.lastName].filter(Boolean).join(' ') || BLANK
  const clean = (v?: string | null) => String(v || '').trim().replace(/[\s,;]+$/, '')
  const addr = [clean(d.owner.street), [clean(d.owner.zip), clean(d.owner.city)].filter(Boolean).join(' '), clean(d.owner.country)].filter(Boolean).join(', ') || BLANK
  const plate = String(d.vehicle.plate || '').replace(/[-.\s]/g, '').toUpperCase()
  const doc = (
    <Document title={`${t.title} — ${plate || d.ref || ''}`} author={COMPANY.name}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.company}>{COMPANY.name}</Text>
            <Text style={s.sub}>{COMPANY.address}{'\n'}{t.tel} {COMPANY.phone}{'\n'}{t.vat} {COMPANY.vat}</Text>
          </View>
          <View>
            {d.ref ? <Text style={s.ref}><Text style={s.label}>{t.dossier}</Text> {d.ref}</Text> : null}
            <Text style={s.ref}><Text style={s.label}>{t.date}</Text> {fmt(d.dateIso, lang)}</Text>
          </View>
        </View>
        <Text style={s.title}>{t.title}</Text>
        <Text><Text style={s.label}>{t.date} :</Text> {fmt(d.dateIso, lang)}</Text>
        <Text style={s.section}>{t.infos}</Text>
        <View style={s.vehicle}>
          {([[t.brand, d.vehicle.brand], [t.model, d.vehicle.model], [t.plate, plate], [t.vin, d.vehicle.vin]] as const).map(([l, v]) => (
            <View key={l} style={s.vcol}><Text style={s.vlab}>{l}</Text><Text style={s.vval}>{v || '—'}</Text></View>
          ))}
        </View>
        <Text style={s.stmt}>{t.stmt(who, d.owner.birthDate || BLANK, addr)}</Text>
        {d.waiveStorage ? <Text style={s.waive}>{t.waive}</Text> : null}
        <Text style={s.place}>{t.place(d.place || 'Pepinster', fmt(d.dateIso, lang, true))}</Text>
        <View style={s.sigs}>
          <View style={s.sigcol}><Text>{t.sigClient}</Text><View style={s.sigline} /><Text style={s.signame}>{who === BLANK ? '' : who}</Text></View>
          <View style={s.sigcol}><Text>{t.sigVd}</Text><View style={s.sigline} /><Text style={s.signame}>{d.staffName || ''}</Text></View>
        </View>
        <Text style={s.footer}>{t.footer}{d.ref ? ` · ${d.ref}` : ''}</Text>
      </Page>
    </Document>
  )
  return renderToBuffer(doc as any) as unknown as Promise<Buffer>
}
