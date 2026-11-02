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
const somme = (rows: { cle: string; titre: string; quantite: number }[]) => {
  const m = new Map<string, { titre: string; n: number }>()
  for (const r of rows) { const x = m.get(r.cle) || { titre: r.titre, n: 0 }; x.n += r.quantite; m.set(r.cle, x) }
  return [...m.values()].sort((a, b) => b.n - a.n)
}
const court = (t: string) => t.replace(/\s*\(.*\)\s*$/, '')

function Doc({ j, emisLe }: { j: MoisJournal; emisLe: string }) {
  const mobiT = somme(j.mobi), autoT = somme(j.auto)
  const totMobi = mobiT.reduce((a, x) => a + x.n, 0) + j.taches.length
  const totAuto = autoT.reduce((a, x) => a + x.n, 0)
  const missions = j.auto.filter(r => r.cle === 'missions').reduce((a, r) => a + r.quantite, 0)
  const jours = [...new Set([...j.mobi, ...j.auto, ...j.taches].map(r => r.jour))].sort()
  const titre = libMois(j.mois)
  const Foot = () => <View style={s.foot} fixed><Text>Journal des tâches — {titre}</Text><Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} /></View>
  return (
    <Document title={`Journal des tâches — ${titre}`} author="Olivier Herman (Mobi)">
      <Page size="A4" style={s.page}>
        <View style={s.top}>
          <View><Text style={s.badge}>Journal des tâches · Verviers Dépannage</Text><Text style={s.h1}>{titre}</Text><Text style={s.sub}>Olivier Herman (Mobi) — organisation, facturation, fourrière et automatisation</Text></View>
          <View style={{ alignItems: 'flex-end' }}><Text style={s.sub}>Établi le {emisLe}</Text><Text style={s.sub}>{jours.length} jours d’activité</Text></View>
        </View>
        <View style={s.kpis}>
          <View style={s.k}><Text style={[s.kb, { color: ME }]}>{fmt(totMobi)}</Text><Text style={s.ks}>tâches réalisées par Mobi</Text></View>
          <View style={s.k}><Text style={[s.kb, { color: AUTO }]}>{fmt(totAuto)}</Text><Text style={s.ks}>actions de ses automatismes</Text></View>
          <View style={s.k}><Text style={s.kb}>{fmt(missions)}</Text><Text style={s.ks}>missions créées sans encodage</Text></View>
          <View style={[s.k, { marginRight: 0 }]}><Text style={s.kb}>{jours.length}</Text><Text style={s.ks}>jours couverts</Text></View>
        </View>

        <Text style={s.h2}>Mobi lui-même</Text>
        <View style={s.row}><Text style={[s.cell, s.th]}>Tâche</Text><Text style={[s.num, s.th]}>Nombre</Text></View>
        {mobiT.map(x => <View key={x.titre} style={s.row}><Text style={s.cell}>{x.titre}</Text><Text style={s.num}>{fmt(x.n)}</Text></View>)}
        {j.taches.length > 0 && <View style={s.row}><Text style={s.cell}>Dossiers traités en séance (détail jour par jour)</Text><Text style={s.num}>{fmt(j.taches.length)}</Text></View>}

        <Text style={s.h2}>Automatismes de Mobi</Text>
        <View style={s.row}><Text style={[s.cell, s.th]}>Automatisme</Text><Text style={[s.num, s.th]}>Actions</Text></View>
        {autoT.map(x => <View key={x.titre} style={s.row}><Text style={s.cell}>{x.titre}</Text><Text style={s.num}>{fmt(x.n)}</Text></View>)}
        <Text style={s.note}>« Automatismes » : opérations faites seules par les outils mis en place par Mobi, sans intervention humaine. Ce qui est fait et signé par un autre membre de l’équipe ne figure pas dans ce document.</Text>
        <Foot />
      </Page>

      <Page size="A4" style={s.page}>
        <View style={s.top}><View><Text style={s.badge}>Détail jour par jour</Text><Text style={[s.h1, { fontSize: 18 }]}>{titre}</Text></View></View>
        {jours.map(d => {
          const tj = j.taches.filter(t => t.jour === d)
          const mj = j.mobi.filter(r => r.jour === d).sort((a, b) => b.quantite - a.quantite)
          const aj = j.auto.filter(r => r.jour === d).sort((a, b) => b.quantite - a.quantite)
          const nM = mj.reduce((a, r) => a + r.quantite, 0) + tj.length, nA = aj.reduce((a, r) => a + r.quantite, 0)
          return (
            <View key={d} style={s.day} wrap={false}>
              <View style={s.dayH}><Text>{jourLong(d)}</Text><Text style={{ color: MUT, fontFamily: 'Helvetica' }}>Mobi : {fmt(nM)} · automatismes : {fmt(nA)}</Text></View>
              {tj.map((t, i) => <View key={i} style={s.item}><Text style={s.h}>{heure(t.at)}</Text><Text style={{ flex: 1 }}><Text style={s.tagMe}>Mobi  </Text>{t.titre}{t.detail ? ` — ${t.detail}` : ''}</Text></View>)}
              {mj.length > 0 && <View style={s.item}><Text style={s.h}>journée</Text><Text style={{ flex: 1 }}><Text style={s.tagMe}>Mobi  </Text>{mj.map(r => `${fmt(r.quantite)} ${court(r.titre).toLowerCase()}`).join(' · ')}</Text></View>}
              {aj.length > 0 && <View style={s.item}><Text style={s.h}>journée</Text><Text style={{ flex: 1 }}><Text style={s.tagAuto}>Auto  </Text>{aj.map(r => `${fmt(r.quantite)} ${court(r.titre).toLowerCase()}`).join(' · ')}</Text></View>}
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
