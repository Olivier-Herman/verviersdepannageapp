// src/lib/journal-mobi/pdf.tsx — document mensuel A4 du journal des tâches de Mobi (Olivier 02/11/2026, maquette
// https://claude.ai/artifact/LQbVEa6GPfXt1RhvJu8reJ) : page 1 la synthèse (Mobi lui-même / automatismes de Mobi),
// ensuite le détail jour par jour. Mise en page fixe A4.
import React from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import type { MoisJournal } from './index'

const INK = '#1C2230', MUT = '#5D6675', LINE = '#D9DDE3', BRAND = '#C8102E', SOFT = '#F5F6F8', AUTO = '#2F5D8A', ME = '#B4532A'
const s = StyleSheet.create({
  page: { padding: 44, paddingBottom: 56, fontSize: 9.5, color: INK, fontFamily: 'Helvetica', lineHeight: 1.4 },
  top: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 2.5, borderBottomColor: BRAND, paddingBottom: 10 },
  badge: { fontSize: 8, color: BRAND, letterSpacing: 1, textTransform: 'uppercase', fontFamily: 'Helvetica-Bold' },
  h1: { fontSize: 22, fontFamily: 'Times-Bold', marginTop: 2 },
  sub: { fontSize: 9, color: MUT, marginTop: 2 },
  kpis: { flexDirection: 'row', marginTop: 16, marginBottom: 6 },
  k: { flex: 1, backgroundColor: SOFT, borderRadius: 6, padding: 8, marginRight: 6 },
  kb: { fontSize: 17, fontFamily: 'Times-Bold' },
  ks: { fontSize: 8, color: MUT },
  h2: { fontSize: 12.5, fontFamily: 'Times-Bold', marginTop: 14, marginBottom: 4, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: LINE },
  row: { flexDirection: 'row', borderBottomWidth: 0.6, borderBottomColor: LINE, paddingVertical: 3.5 },
  cell: { flex: 1, paddingRight: 6 },
  num: { width: 60, textAlign: 'right' },
  th: { fontSize: 7.5, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6 },
  note: { fontSize: 8, color: MUT, marginTop: 5 },
  day: { marginTop: 9 },
  dayH: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: SOFT, padding: 4, borderRadius: 4, fontFamily: 'Helvetica-Bold', fontSize: 9.5 },
  item: { flexDirection: 'row', paddingHorizontal: 4, paddingTop: 2.5 },
  h: { width: 40, color: MUT },
  tagMe: { color: ME, fontFamily: 'Helvetica-Bold' },
  tagAuto: { color: AUTO, fontFamily: 'Helvetica-Bold' },
  foot: { position: 'absolute', bottom: 24, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: MUT, borderTopWidth: 0.6, borderTopColor: LINE, paddingTop: 4 },
})

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const fmt = (n: number) => n.toLocaleString('fr-BE')
const libMois = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${MOIS[mm - 1].replace(/^./, c => c.toUpperCase())} ${y}` }
const jourLong = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' }).replace(/^./, c => c.toUpperCase())
const heure = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : ''
const _somme = (rows: { cle: string; titre: string; quantite: number }[]) => {
  const m = new Map<string, { titre: string; n: number }>()
  for (const r of rows) { const x = m.get(r.cle) || { titre: r.titre, n: 0 }; x.n += r.quantite; m.set(r.cle, x) }
  return [...m.values()].sort((a, b) => b.n - a.n)
}
const court = (t: string) => t.replace(/\s*\(.*\)\s*$/, '')

// Dans ce document, tout est présenté comme les tâches de Mobi, sans distinguer ce qui est fait par ses outils
// (Olivier 02/11/2026) : les lignes sont regroupées par thème, avec des libellés neutres.
const THEMES: { titre: string; cles: string[] }[] = [
  { titre: 'Facturation des dossiers et des assistances', cles: ['m_factu', 'facturation'] },
  { titre: 'Paiements reconnus, lettrés et rapprochés', cles: ['paiements', 'erp_lettrages', 'erp_lettrages_auto'] },
  { titre: 'Comptabilité : pièces encodées (factures, achats, notes de crédit, relevés)', cles: ['erp_pieces', 'erp_pieces_auto'] },
  { titre: 'Correspondance : mails traités, triés et envoyés', cles: ['mails', 'mails_auto', 'mails_decides', 'tri_info'] },
  { titre: 'Rappels et relances (clients, réquisitoires, fiches ouvertes)', cles: ['relances'] },
  { titre: 'Fourrière, parc et Justice (restitutions, levées, états de frais, Domaine)', cles: ['m_fourriere', 'm_parc', 'fourriere'] },
  { titre: 'Dispatch, suivi des assistances et corrections de fiches', cles: ['m_dispatch', 'corrections', 'appels'] },
  { titre: 'Paiements fournisseurs et comptes d’achat', cles: ['erp_paiements_fourn', 'erp_paiements_fourn_auto', 'comptes_achats'] },
  { titre: 'Clôtures chez les assistances pour la facturation', cles: ['clotures'] },
  { titre: 'Circuit de Spa-Francorchamps', cles: ['circuit'] },
  { titre: 'Courrier relevé et traité', cles: ['courrier'] },
  { titre: 'Inventaire du parking', cles: ['inventaire'] },
  { titre: 'Autres interventions sur les fiches', cles: ['m_autres'] },
]
const themeDe = (cle: string) => THEMES.find(t => t.cles.includes(cle))?.titre || THEMES[THEMES.length - 1].titre

function Doc({ j, emisLe }: { j: MoisJournal; emisLe: string }) {
  const lignes = [...j.mobi, ...j.auto]
  const parTheme = THEMES.map(t => ({ titre: t.titre, n: lignes.filter(r => t.cles.includes(r.cle)).reduce((a, r) => a + r.quantite, 0) })).filter(t => t.n > 0)
  const total = parTheme.reduce((a, t) => a + t.n, 0) + j.taches.length
  const compta = lignes.filter(r => /factu|paiement|erp|mails/.test(r.cle)).reduce((a, r) => a + r.quantite, 0)
  const fourr = lignes.filter(r => /fourriere|m_parc/.test(r.cle)).reduce((a, r) => a + r.quantite, 0)
  const jours = [...new Set([...lignes, ...j.taches].map(r => r.jour))].sort()
  const titre = libMois(j.mois)
  const Foot = () => <View style={s.foot} fixed><Text>Journal des tâches — {titre}</Text><Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} /></View>
  return (
    <Document title={`Journal des tâches — ${titre}`} author="Olivier Herman (Mobi)">
      <Page size="A4" style={s.page}>
        <View style={s.top}>
          <View><Text style={s.badge}>Journal des tâches · Verviers Dépannage</Text><Text style={s.h1}>{titre}</Text><Text style={s.sub}>Olivier Herman (Mobi) — organisation, facturation, comptabilité et fourrière</Text></View>
          <View style={{ alignItems: 'flex-end' }}><Text style={s.sub}>Établi le {emisLe}</Text><Text style={s.sub}>{jours.length} jours d’activité</Text></View>
        </View>
        <View style={s.kpis}>
          <View style={s.k}><Text style={[s.kb, { color: ME }]}>{fmt(total)}</Text><Text style={s.ks}>tâches accomplies</Text></View>
          <View style={s.k}><Text style={[s.kb, { color: AUTO }]}>{fmt(compta)}</Text><Text style={s.ks}>factures, paiements, pièces et mails</Text></View>
          <View style={s.k}><Text style={s.kb}>{fmt(fourr)}</Text><Text style={s.ks}>tâches fourrière et Justice</Text></View>
          <View style={[s.k, { marginRight: 0 }]}><Text style={s.kb}>{jours.length}</Text><Text style={s.ks}>jours couverts</Text></View>
        </View>

        <Text style={s.h2}>Tâches accomplies</Text>
        <View style={s.row}><Text style={[s.cell, s.th]}>Domaine</Text><Text style={[s.num, s.th]}>Nombre</Text></View>
        {parTheme.map(x => <View key={x.titre} style={s.row}><Text style={s.cell}>{x.titre}</Text><Text style={s.num}>{fmt(x.n)}</Text></View>)}
        {j.taches.length > 0 && <View style={s.row}><Text style={s.cell}>Dossiers particuliers traités (détail jour par jour)</Text><Text style={s.num}>{fmt(j.taches.length)}</Text></View>}

        {j.regulieres.length > 0 && <>
          <Text style={s.h2}>Tâches régulières</Text>
          {j.regulieres.map(t => <View key={t} style={s.row}><Text style={s.cell}>{t}</Text><Text style={[s.num, { color: MUT }]}>tout le mois</Text></View>)}
        </>}
        <Foot />
      </Page>

      <Page size="A4" style={s.page}>
        <View style={s.top}><View><Text style={s.badge}>Détail jour par jour</Text><Text style={[s.h1, { fontSize: 18 }]}>{titre}</Text></View></View>
        {jours.map(d => {
          const tj = j.taches.filter(t => t.jour === d)
          const lj = lignes.filter(r => r.jour === d)
          const th = THEMES.map(t => ({ titre: t.titre, n: lj.filter(r => t.cles.includes(r.cle)).reduce((a, r) => a + r.quantite, 0) })).filter(t => t.n > 0).sort((a, b) => b.n - a.n)
          const n = th.reduce((a, t) => a + t.n, 0) + tj.length
          return (
            <View key={d} style={s.day} wrap={false}>
              <View style={s.dayH}><Text>{jourLong(d)}</Text><Text style={{ color: MUT, fontFamily: 'Helvetica' }}>{fmt(n)} tâches</Text></View>
              {tj.map((t, i) => <View key={i} style={s.item}><Text style={s.h}>{heure(t.at)}</Text><Text style={{ flex: 1 }}>{t.titre}{t.detail ? ` — ${t.detail}` : ''}</Text></View>)}
              {th.length > 0 && <View style={s.item}><Text style={s.h}>journée</Text><Text style={{ flex: 1 }}>{th.map(t => `${fmt(t.n)} ${court(t.titre).toLowerCase()}`).join(' · ')}</Text></View>}
            </View>
          )
        })}
        <Foot />
      </Page>
    </Document>
  )
}

export async function pdfJournalMois(j: MoisJournal): Promise<Buffer> {
  const emisLe = new Date().toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
  return renderToBuffer(<Doc j={j} emisLe={emisLe} /> as any)
}
