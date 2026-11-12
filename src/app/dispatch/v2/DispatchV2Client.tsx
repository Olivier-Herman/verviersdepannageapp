'use client'
// Nouveau Dispatch « tour de contrôle » — préversion dispatch_v2 (Olivier seul).
// Maquette : https://claude.ai/artifact/TASSRqcM1hGBU74DuTfjmt
// Plan     : https://claude.ai/artifact/9M8jDp6cwHGDN6hB4CfD9b
//
// Étape 1 : colonne « À traiter » (En commande et En attente épinglées, Alertes
// en dessous) et liste des missions lancées. Les boutons appellent exactement les
// mêmes routes que l'écran actuel (valider, refuser, affecter, adresse modifiée,
// autoroute). La fiche en volet arrive à l'étape 2 : en attendant, une mission
// s'ouvre dans la fiche actuelle.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import AppShell from '@/components/layout/AppShell'
import DriverPickerModal from '@/components/DriverPickerModal'
import { HighwaySiabisModal, shouldOfferSiabis } from '../HighwaySiabisModal'
import { getSourceLabel, getSourceColor, getSourceColorHex, type SourceDisplay } from '@/lib/missions/source-display'
import { pollWhenVisible } from '@/lib/client/poll'
import FicheComplete from './FicheComplete'
import dynamic from 'next/dynamic'
const CarteDispatch = dynamic(() => import('./CarteDispatch'), { ssr: false, loading: () => <p className="text-stone-500 text-sm">Chargement de la carte…</p> })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

interface Props {
  userName: string; userEmail?: string; userId?: string; userRole: string; userModules: string[]
  sources: SourceDisplay[]
  drivers: any[]
}
type M = Record<string, any>
type Alerte = { type: string; depuis: string | null; mission: M; [k: string]: any }
type Board = { cmd: M[]; att: M[]; alertes: Alerte[]; lances: M[]; planning?: M[] }

// ── Petits utilitaires d'affichage ───────────────────────────────────────────
const hm = (d: Date) => d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }).replace(':', ' h ')
function typeCourt(m: M): string {
  const t = String(m.mission_type || '').toLowerCase(), i = String(m.incident_type || '').toLowerCase()
  if (i === 'relivraison' || t === 'relivraison') return 'REL'
  if (i === 'dpr' || t === 'dpr' || t === 'trajet_vide') return 'DPR'
  if (t === 'depannage' || t === 'dsp' || t === 'reparation_place') return 'DSP'
  if (t === 'transport') return 'TRP'
  return 'REM'
}
// Couleur par type de prestation (Olivier 12/11) : pastille pleine + fond très léger de la carte.
// Le rouge reste réservé à l'urgence (liseré gauche, délai) : aucun type ne le prend.
const TYPE_COULEUR: Record<string, { pastille: string; fond: string; nom: string }> = {
  REM: { pastille: 'bg-blue-600 text-white',    fond: 'bg-blue-50/70',    nom: 'Remorquage' },
  DSP: { pastille: 'bg-emerald-600 text-white', fond: 'bg-emerald-50/70', nom: 'Dépannage sur place' },
  TRP: { pastille: 'bg-amber-600 text-white',   fond: 'bg-amber-50/70',   nom: 'Transport' },
  REL: { pastille: 'bg-violet-600 text-white',  fond: 'bg-violet-50/70',  nom: 'Relivraison' },
  DPR: { pastille: 'bg-stone-500 text-white',   fond: 'bg-stone-100/70',  nom: 'Déplacement' },
}
const couleurType = (m: M) => TYPE_COULEUR[typeCourt(m)] || TYPE_COULEUR.REM
function etat(m: M): { txt: string; cls: string } {
  switch (m.status) {
    case 'new':         return { txt: 'À valider', cls: 'bg-red-100 text-red-800' }
    case 'dispatching': return { txt: 'Sans chauffeur', cls: 'bg-red-100 text-red-800' }
    case 'assigned':    return { txt: 'Attend le chauffeur', cls: 'bg-amber-100 text-amber-900' }
    case 'accepted':    return { txt: 'Acceptée', cls: 'bg-blue-100 text-blue-800' }
    case 'in_progress': return m.on_site_at ? { txt: 'Sur place', cls: 'bg-emerald-100 text-emerald-800' } : { txt: 'En route', cls: 'bg-blue-100 text-blue-800' }
    case 'delivering':  return { txt: 'Livraison', cls: 'bg-emerald-100 text-emerald-800' }
    case 'parked':      return { txt: 'Au parc', cls: 'bg-stone-200 text-stone-800' }
    case 'to_invoice':  return { txt: 'À facturer', cls: 'bg-stone-200 text-stone-800' }
    case 'completed':   return { txt: 'Terminée', cls: 'bg-stone-200 text-stone-700' }
    case 'cancelled':   return { txt: 'Annulée', cls: 'bg-stone-200 text-stone-700' }
    default:            return { txt: m.status || '—', cls: 'bg-stone-200 text-stone-700' }
  }
}
// Compte à rebours ou ancienneté, recalculé chaque seconde.
function minutesDepuis(iso: string | null | undefined, now: number) { return iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000)) : 0 }
// Panne lisible (affichage seulement, la donnée ne change pas) : les assistances (Touring surtout)
// envoient « retroviseurs//U2//P1//0000000000 0444555//Incident//vandalisme ». On coupe sur « // »,
// on retire les codes courts (U2, P1) et les suites de chiffres, on évite les doublons.
function panneLisible(t?: string | null): string {
  if (!t) return ''
  if (!t.includes('//')) return t.trim()
  const vus = new Set<string>(), morceaux: string[] = []
  for (const brut of t.split('//')) {
    const x = brut.trim()
    if (!x || /^[A-Z]{1,2}\d{1,2}$/.test(x) || /^[\d\s.\-/]+$/.test(x)) continue
    const k = x.toLowerCase()
    if (vus.has(k)) continue
    vus.add(k); morceaux.push(morceaux.length ? x.toLowerCase() : x.charAt(0).toUpperCase() + x.slice(1).toLowerCase())
  }
  return morceaux.join(' · ') || t.trim()
}
function duree(min: number) {
  if (min < 60) return `${min} min`
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
  const j = Math.floor(min / 1440); return `${j} jour${j > 1 ? 's' : ''}`
}
function couleurAnciennete(min: number) { return min >= 30 ? 'text-red-800' : min >= 15 ? 'text-amber-800' : 'text-emerald-800' }
// Adresse courte : sans le pays final ni ce qui suit un « | » (doublons d'adresse des assistances).
const court = (a?: string | null) => String(a || '').replace(/\s*\|.*$/, '').replace(/,?\s*(BEL|Belgique|Belgium|BE)\s*$/i, '').replace(/\s+/g, ' ').trim()
const trajet = (m: M) => [court(m.incident_address) || m.incident_city, m.destination_name || m.destination_address ? '→ ' + court(m.destination_name || m.destination_address) : ''].filter(Boolean).join(' ')
// Titre de carte (Olivier 12/11) : « Plaque - Marque - Modèle ».
const titreVehicule = (m: M) => [m.vehicle_plate, m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' - ') || 'Véhicule non précisé'
const vehicule = (m: M) => [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')

// ── Planning des chauffeurs (étape 5) ─────────────────────────────────────────
// Une ligne par chauffeur : fait (pâle), en cours (plein), fin estimée (hachuré), pas encore
// acceptée (pointillé). Missions sans suivi (police, privé encodés sur place : étapes à la même
// seconde) : un simple bloc, sans fausses heures. Durées estimées = repères, pas des promesses.
const DUREE_TYPE: Record<string, number> = { DSP: 45, REM: 80, REL: 60, TRP: 120, DPR: 40 }
const ms = (iso?: string | null) => (iso ? new Date(iso).getTime() : null)
function Planning({ missions, chauffeurs, etats, sources, now, selId, onSel, onDepot }: {
  missions: M[]; chauffeurs: any[]; etats: any[] | null; sources: SourceDisplay[]; now: number; selId: string | null
  onSel: (m: M) => void; onDepot: (missionId: string, driverId: string) => void
}) {
  const [cible, setCible] = useState<string | null>(null)
  const h = (t: number) => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60 }
  const debuts = missions.map(m => ms(m.accepted_at) || ms(m.assigned_at)).filter(Boolean) as number[]
  const memeJour = (t: number) => new Date(t).toDateString() === new Date(now).toDateString()
  const hDebut = Math.max(0, Math.min(7, ...debuts.filter(memeJour).map(t => Math.floor(h(t)))))
  const hFin = Math.min(24, Math.max(19, Math.ceil(h(now)) + 3))
  const pct = (t: number) => { const x = memeJour(t) ? h(t) : (t < now ? hDebut : hFin); return Math.max(0, Math.min(100, ((x - hDebut) / (hFin - hDebut)) * 100)) }
  const etatDe = (id: string) => (etats || []).find((e: any) => e.id === id)
  const parChauffeur = new Map<string, M[]>()
  for (const m of missions) if (m.assigned_to) parChauffeur.set(m.assigned_to, [...(parChauffeur.get(m.assigned_to) || []), m])
  const actif = (c: any) => { const e = etatDe(c.id); return parChauffeur.has(c.id) || (e && !e.on_conge && !e.manual_offline && e.status !== 'hors_service') }
  const lignes = chauffeurs.filter(actif).sort((a, b) => Number(parChauffeur.has(b.id)) - Number(parChauffeur.has(a.id)) || String(a.name).localeCompare(String(b.name)))
  const absents = chauffeurs.filter(c => !actif(c) && etatDe(c.id))
  const heures = Array.from({ length: hFin - hDebut + 1 }, (_, i) => hDebut + i)
  const couleur = (m: M) => { const c = getSourceColor(m.source, sources); return c }
  const blocs = (c: any) => (parChauffeur.get(c.id) || []).map(m => {
    const lib = `${getSourceLabel(m.source, sources)} ${typeCourt(m)} · ${m.vehicle_plate || ''}`
    const sel = selId === m.id ? ' ring-2 ring-stone-900' : ''
    const debut = ms(m.accepted_at) || ms(m.assigned_at) || now
    const finReelle = ms(m.completed_at) || ms(m.parked_at)
    const sansSuivi = m.accepted_at && m.on_site_at && Math.abs((ms(m.on_site_at) || 0) - (ms(m.accepted_at) || 0)) < 60_000
    const enCours = ['accepted', 'in_progress', 'delivering'].includes(m.status)
    if (m.status === 'assigned' && !m.accepted_at) {
      const fin = now + (DUREE_TYPE[typeCourt(m)] || 60) * 60_000
      return <button key={m.id} type="button" onClick={() => onSel(m)} title={lib} style={{ left: `${pct(now)}%`, width: `${Math.max(2, pct(fin) - pct(now))}%` }}
        className={`absolute top-1 bottom-1 rounded-md border-2 border-dashed border-amber-500 bg-white text-stone-900 text-[11px] font-bold px-1.5 overflow-hidden whitespace-nowrap text-left${sel}`}>{lib} · à accepter</button>
    }
    if (enCours && !sansSuivi) {
      const finEst = Math.max(now + 10 * 60_000, debut + (DUREE_TYPE[typeCourt(m)] || 60) * 60_000)
      return <span key={m.id} className="contents">
        <button type="button" onClick={() => onSel(m)} title={lib} style={{ left: `${pct(debut)}%`, width: `${Math.max(1, pct(now) - pct(debut))}%` }}
          className={`absolute top-1 bottom-1 rounded-l-md text-white text-[11px] font-bold px-1.5 overflow-hidden whitespace-nowrap text-left ${couleur(m)}${sel}`}>{lib}</button>
        <button type="button" onClick={() => onSel(m)} title={`Fin estimée vers ${new Date(finEst).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`} style={{ left: `${pct(now)}%`, width: `${Math.max(1, pct(finEst) - pct(now))}%`, backgroundImage: 'repeating-linear-gradient(135deg,rgba(255,255,255,.35) 0 6px,transparent 6px 12px)' }}
          className={`absolute top-1 bottom-1 rounded-r-md text-white text-[11px] font-bold px-1.5 overflow-hidden whitespace-nowrap text-left opacity-80 ${couleur(m)}`}>libre ≈ {new Date(finEst).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</button>
      </span>
    }
    const fin = finReelle || (enCours ? now : debut + 30 * 60_000)
    return <button key={m.id} type="button" onClick={() => onSel(m)} title={sansSuivi ? `${lib} (encodée sur place, sans suivi des étapes)` : lib} style={{ left: `${pct(debut)}%`, width: `${Math.max(1, pct(fin) - pct(debut))}%` }}
      className={`absolute top-1 bottom-1 rounded-md text-white text-[11px] font-bold px-1.5 overflow-hidden whitespace-nowrap text-left ${enCours ? '' : 'opacity-45'} ${couleur(m)}${sel}`}>{lib}</button>
  })
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="grid grid-cols-[170px_minmax(0,1fr)] items-center">
        <span />
        <div className="flex justify-between text-[11px] text-stone-500 tabular-nums">{heures.map(x => <span key={x}>{x} h</span>)}</div>
      </div>
      {lignes.length === 0 && <p className="text-stone-500 text-sm">Aucun chauffeur en service ni attribué aujourd'hui.</p>}
      {lignes.map(c => {
        const e = etatDe(c.id)
        const etiquette = e?.status === 'en_mission' ? 'en mission' : e?.status === 'en_service' ? 'libre' : parChauffeur.has(c.id) ? 'hors service' : ''
        return (
          <div key={c.id} className="grid grid-cols-[170px_minmax(0,1fr)] items-center gap-0">
            <div className="pr-2 min-w-0"><b className="text-[13.5px] text-stone-900 block truncate">{c.name}</b><span className="text-[11.5px] text-stone-500">{etiquette}{e?.schedule_day || e?.schedule_night ? ' · de garde' : ''}</span></div>
            <div onDragOver={ev => { if (ev.dataTransfer.types.includes('text/vd-mission')) { ev.preventDefault(); setCible(c.id) } }} onDragLeave={() => setCible(x => (x === c.id ? null : x))}
              onDrop={ev => { ev.preventDefault(); setCible(null); const id = ev.dataTransfer.getData('text/vd-mission'); if (id) onDepot(id, c.id) }}
              className={`relative h-10 rounded-lg ${cible === c.id ? 'ring-2 ring-emerald-600' : ''}`}
              style={{ background: `repeating-linear-gradient(90deg,#f5f5f4 0,#f5f5f4 calc(${100 / (hFin - hDebut)}% - 1px),#e7e5e4 calc(${100 / (hFin - hDebut)}% - 1px),#e7e5e4 ${100 / (hFin - hDebut)}%)` }}>
              <span className="absolute -top-1 -bottom-1 w-0.5 bg-red-600 z-10 pointer-events-none" style={{ left: `${pct(now)}%` }} />
              {blocs(c)}
            </div>
          </div>
        )
      })}
      {absents.length > 0 && <p className="text-stone-500 text-[12.5px]">Absents ou hors service : {absents.map(c => c.name).join(', ')}.</p>}
      <p className="text-stone-500 text-[12.5px]">Pâle : fait · plein : en cours · hachuré : fin estimée · pointillé : pas encore acceptée · trait rouge : maintenant. Glissez une mission de la colonne de gauche sur une ligne pour l'affecter.</p>
    </div>
  )
}

// ── Relivrer depuis le volet (Olivier 12/11), même action que le bouton de l'ancienne liste ──
// Crée la fiche de relivraison à partir du véhicule au parc (POST /api/missions/[id]/relivrer),
// puis ouvre le choix du chauffeur. Reprise par une assistance (privé, Siabis non couvert,
// accident) : on demande la source, comme avant.
function Relivrer({ m, onCree }: { m: M; onCree: (id: string) => void }) {
  const [occupe, setOccupe] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [reprise, setReprise] = useState<string>('')
  const [sources, setSources] = useState<{ key: string; label: string }[] | null>(null)
  const src = String(m.source || '').toLowerCase()
  const demandeSource = ['prive', 'police_snc', 'police_accident'].includes(src)
  const adresse = String(m.redelivery_address || '').trim()
  useEffect(() => {
    if (!demandeSource || sources) return
    fetch('/api/missions/sources').then(r => r.json()).then(d => {
      const exclues = new Set([src, 'police_mg', 'police_rodeo', 'police_avp', 'police_saisie'])
      setSources((Array.isArray(d?.sources) ? d.sources : []).filter((x: any) => !exclues.has(String(x.key || '').toLowerCase())))
    }).catch(() => setSources([]))
  }, [demandeSource, sources, src])
  const go = async () => {
    setOccupe(true); setErr(null)
    try {
      const r = await fetch(`/api/missions/${m.id}/relivrer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_override: reprise && reprise !== '__meme__' ? reprise : null }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || `Erreur ${r.status}`); return }
      if (j.mission_id) onCree(j.mission_id)
    } catch (e: any) { setErr(e?.message || 'Erreur réseau') } finally { setOccupe(false) }
  }
  return (
    <div className="basis-full rounded-xl border-2 border-violet-500 bg-violet-50 p-2.5 flex flex-col gap-2">
      <span className="text-[11px] font-extrabold uppercase tracking-wider text-violet-800">Relivraison</span>
      {adresse ? <span className="text-stone-900 text-[13.5px]"><span className="text-stone-500">Livrer à : </span><b>{adresse}</b></span>
        : <span className="text-amber-900 text-[13.5px]">Adresse de relivraison manquante : renseignez-la dans « Tout le détail et les actions », rubrique Relivraison.</span>}
      {demandeSource && adresse && (
        <label className="flex flex-col gap-1 text-[13px]"><span className="font-bold text-stone-800">Reprise par</span>
          <select value={reprise} onChange={e => setReprise(e.target.value)} className="min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-stone-900">
            <option value="">— à choisir —</option>
            <option value="__meme__">Même source ({m.source})</option>
            {(sources || []).map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
      )}
      <button type="button" disabled={occupe || !adresse || (demandeSource && !reprise)} onClick={go}
        className="min-h-[44px] rounded-xl bg-violet-700 text-white font-bold text-sm disabled:opacity-50">
        {occupe ? 'Création…' : 'Relivrer et choisir le chauffeur'}
      </button>
      {err && <span className="text-red-800 text-[13px] font-semibold">{err}</span>}
    </div>
  )
}

// ── Morceaux d'affichage (hors du composant : pas recréés à chaque seconde) ──
// Avancement : reçue, acceptée, en route, sur place, chargée ou réparée, livrée.
const Avancement = ({ m }: { m: M }) => {
  const dsp = typeCourt(m) === 'DSP'
  const etapes: [string, string | null][] = [['Reçue', m.received_at], ['Acceptée', m.accepted_at], ['En route', m.on_way_at], ['Sur place', m.on_site_at], [dsp ? 'Terminée' : 'Chargée', dsp ? null : m.loaded_at], [dsp ? '' : 'Livraison', dsp ? null : m.delivering_at]]
  const vis = etapes.filter(e => e[0])
  const cur = vis.findIndex(e => !e[1])
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${vis.length}, minmax(0,1fr))` }}>
      {vis.map(([l, t], i) => (
        <div key={l} className="text-center text-[10.5px] text-stone-500">
          <div className={`h-1.5 rounded mb-1 ${t ? 'bg-emerald-500' : i === cur ? 'bg-amber-400' : 'bg-stone-200'}`} />
          {l}<b className="block text-stone-900 tabular-nums">{t ? new Date(t).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : '–'}</b>
        </div>
      ))}
    </div>
  )
}
const Source = ({ m, sources }: { m: M; sources: SourceDisplay[] }) => (
  <span className={`px-2 py-0.5 rounded-md text-[11.5px] font-bold text-white whitespace-nowrap ${getSourceColor(m.source, sources)}`}>{getSourceLabel(m.source, sources)}</span>
)
const Plaque = ({ m }: { m: M }) => m.vehicle_plate
  ? <span className="font-mono font-bold text-[12.5px] border-[1.5px] border-ink rounded px-1.5 bg-white text-stone-900 whitespace-nowrap">{m.vehicle_plate}</span>
  : <span className="text-ink-muted text-xs">plaque inconnue</span>
const Btn = ({ children, onClick, ton = 'o', disabled, grand }: { children: React.ReactNode; onClick: () => void; ton?: 'p' | 'g' | 'o' | 'd'; disabled?: boolean; grand?: boolean }) => (
  <button type="button" onClick={e => { e.stopPropagation(); onClick() }} disabled={disabled}
    className={`min-h-[44px] px-3.5 rounded-xl font-bold text-sm disabled:opacity-50 ${grand ? 'flex-1 basis-full lg:basis-0' : 'flex-1 lg:flex-none'} ${
      ton === 'p' ? 'bg-stone-900 text-white' : ton === 'g' ? 'bg-emerald-700 text-white' : ton === 'd' ? 'bg-red-100 text-red-800' : 'bg-white border border-stone-300 text-stone-900'}`}>
    {children}
  </button>
)
// Commune seule (pour la ligne courte de la carte) : « Rue X 12, 4800 Verviers » → « Verviers ».
const commune = (adr?: string | null, ville?: string | null) => {
  if (ville) return ville
  const parts = court(adr).split(',').map(x => x.trim()).filter(Boolean)
  const last = parts[parts.length - 1] || ''
  return last.replace(/^\d{4,5}\s+/, '') || court(adr)
}
const trajetCourt = (m: M) => [commune(m.incident_address, m.incident_city), m.destination_name || m.destination_address ? commune(m.destination_name ? null : m.destination_address, null) || court(m.destination_name) : ''].filter(Boolean).join(' → ')

// Carte de la file : juste de quoi reconnaître la mission et agir. Le détail est dans le volet de droite.
const Carte = ({ m, sources, occupe, sel, onSel, titre, delai, delaiCls, niveau, detail, children, glissable }: { m: M; sources: SourceDisplay[]; occupe: string | null; sel: boolean; onSel: (m: M) => void; titre: string; delai?: string; delaiCls?: string; niveau: 'r' | 'a' | 'b'; detail?: React.ReactNode; children?: React.ReactNode; glissable?: boolean }) => (
  <div role="button" tabIndex={0} onClick={() => onSel(m)} draggable={glissable} onDragStart={glissable ? e => { e.dataTransfer.setData('text/vd-mission', m.id); e.dataTransfer.effectAllowed = 'move' } : undefined} onKeyDown={e => { if (e.key === 'Enter') onSel(m) }}
    className={`cursor-pointer min-w-0 rounded-xl border border-stone-200 border-l-[5px] p-2.5 flex flex-col gap-1.5 ${niveau === 'r' ? 'border-l-red-600' : niveau === 'a' ? 'border-l-amber-500' : 'border-l-sky-500'} ${couleurType(m).fond} ${sel ? 'ring-2 ring-stone-900' : ''} ${occupe === m.id ? 'opacity-60' : ''}`}>
    <div className="flex items-start justify-between gap-2 min-w-0">
      <b className="text-[14px] text-stone-900 min-w-0">{titre}</b>
      {delai && <span className={`font-extrabold text-[13px] tabular-nums whitespace-nowrap ${delaiCls || ''}`}>{delai}</span>}
    </div>
    <div className="flex items-center gap-1.5 min-w-0">
      <Source m={m} sources={sources} /><span className={`px-1.5 py-0.5 rounded-md text-[11.5px] font-bold ${couleurType(m).pastille}`} title={couleurType(m).nom}>{typeCourt(m)}</span>{!(m.vehicle_plate && titre.includes(m.vehicle_plate)) && <Plaque m={m} />}
      {Array.isArray(m.warnings) && m.warnings.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11.5px] font-bold" title={m.warnings.join(', ')}>⚠ {m.warnings.length}</span>}
      <span className={`text-stone-600 text-[13px] truncate min-w-0 ${detail ? '' : 'lg:hidden'}`}>{detail ?? trajetCourt(m)}</span>
    </div>
    {/* Téléphone : pas de volet à côté, la carte porte le détail utile (Olivier 11/11 : « les infos sont trop limitées »). Sur PC, il est dans le volet de droite. */}
    {!detail && <DetailTel m={m} />}
    {!detail && <ResumeBureau m={m} />}
    {children && <div className="flex gap-1.5 flex-wrap">{children}</div>}
  </div>
)
// Détail d'une mission sur téléphone (pas de volet à côté) : adresse, destination, panne, véhicule,
// réception, client et téléphone, avertissements. Sur PC, ce détail est dans le volet de droite.
// Grand écran : deux lignes courtes (adresse → destination ; panne · client · réception), coupées
// au bout de la ligne, texte complet au survol. Le détail complet reste dans le volet de droite.
const ResumeBureau = ({ m }: { m: M }) => {
  // Une ligne par information (Olivier 12/11) : intervention, destination, panne, client.
  // Pas d'heure de réception : le délai en haut à droite de la carte la donne déjà.
  const lignes: [string, string][] = [
    ['Intervention', court(m.incident_address) || m.incident_city || ''],
    ['Destination', m.destination_name || m.destination_address ? [court(m.destination_name), court(m.destination_address)].filter(Boolean).join(', ') : ''],
    ['Panne', panneLisible(m.incident_description)],
    ['Client', [m.assisted_name || m.client_name, m.assisted_phone || m.client_phone].filter(Boolean).join(' · ')],
  ]
  return (
    <dl className="hidden lg:grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 text-[13px] min-w-0">
      {lignes.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-stone-500">{k}</dt><dd className="text-stone-900 truncate" title={v}>{v}</dd></div>
      ))}
    </dl>
  )
}
const DetailTel = ({ m }: { m: M }) => (
  <>
    <dl className="lg:hidden grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[13px]">
        {([
          ['Lieu', court(m.incident_address) || m.incident_city],
          ['Vers', m.destination_name || m.destination_address ? [court(m.destination_name), court(m.destination_address)].filter(Boolean).join(', ') : ''],
          ['Panne', panneLisible(m.incident_description)],
          ['Véhicule', vehicule(m)],
          ['Reçue', m.received_at ? new Date(m.received_at).toLocaleString('fr-BE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : ''],
        ] as const).filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-stone-500">{k}</dt><dd className={`text-stone-900 break-words ${k === 'Panne' ? 'line-clamp-2' : ''}`}>{v}</dd></div>
        ))}
        {(m.client_name || m.assisted_name) && (
          <div className="contents"><dt className="text-stone-500">Client</dt>
            <dd className="text-stone-900 break-words">{m.assisted_name && m.assisted_name !== m.client_name ? m.assisted_name : m.client_name}
              {(m.assisted_phone || m.client_phone) && <> · <a href={`tel:${m.assisted_phone || m.client_phone}`} onClick={e => e.stopPropagation()} className="font-semibold underline">{m.assisted_phone || m.client_phone}</a></>}</dd></div>
        )}
      </dl>
    {Array.isArray(m.warnings) && m.warnings.length > 0 && (
      <div className="lg:hidden flex flex-wrap gap-1">{m.warnings.map((w: string) => <span key={w} className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[12px] font-bold">⚠ {w}</span>)}</div>
    )}
  </>
)
const Section = ({ titre, sous, nb, vide, children }: { titre: string; sous: string; nb: number; vide: string; children: React.ReactNode }) => (
  <>
    <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-stone-100 text-[12px] font-extrabold uppercase tracking-wide text-stone-800">
      <span>{titre} <span className="normal-case tracking-normal font-semibold text-stone-500 ml-1">{sous}</span></span>
      <span className="bg-white rounded-full px-2.5 tabular-nums">{nb}</span>
    </div>
    {nb === 0 ? <p className="text-stone-500 text-[13px] px-2.5">{vide}</p> : children}
  </>
)


export default function DispatchV2Client({ userName, userEmail, userId, userRole, userModules, sources, drivers }: Props) {
  const [board, setBoard] = useState<Board | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [filtre, setFiltre] = useState<'cours' | 'rdv' | 'vhu' | 'parked' | 'all'>('cours')
  const [vueCentre, setVueCentre] = useState<'liste' | 'planning' | 'carte'>('liste')
  const [autres, setAutres] = useState<M[] | null>(null)
  const [q, setQ] = useState('')
  const [occupe, setOccupe] = useState<string | null>(null)
  const [message, setMessage] = useState<{ txt: string; ton: 'ok' | 'info' | 'err' } | null>(null)
  const [picker, setPicker] = useState<M | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  // Téléphone (garde) : un onglet à la fois, rien d'épinglé (Olivier 11/11).
  const [ongletTel, setOngletTel] = useState<'traiter' | 'cours' | 'chauffeurs'>('traiter')
  const [etatsChauffeurs, setEtatsChauffeurs] = useState<any[] | null>(null)
  useEffect(() => {
    if (ongletTel !== 'chauffeurs' && vueCentre === 'liste') return
    fetch('/api/users/driver-status', { cache: 'no-store' }).then(r => r.json()).then(d => setEtatsChauffeurs(Array.isArray(d) ? d : (d?.drivers || []))).catch(() => setEtatsChauffeurs([]))
  }, [ongletTel, vueCentre, board])
  const [complete, setComplete] = useState<{ id: string; titre: string } | null>(null)   // fiche complète embarquée (indépendante de la sélection)
  const choisir = (m: M) => setSelId(m.id)   // fermeture par le ✕ du volet
  // Arrivée depuis la création rapide : /dispatch?ouvrir=<id> ouvre la mission dans le volet.
  useEffect(() => {
    try {
      const u = new URL(window.location.href), id = u.searchParams.get('ouvrir')
      if (id) { setSelId(id); u.searchParams.delete('ouvrir'); window.history.replaceState(null, '', u.pathname + u.search) }
    } catch {}
  }, [])
  // Chauffeur proposé : calculé à l'ouverture d'une mission à valider ou sans chauffeur, jamais en boucle.
  const [prop, setProp] = useState<{ id: string; data: any | null } | null>(null)
  const [siabis, setSiabis] = useState<{ m: M; next: (() => void) | null } | null>(null)
  const [refus, setRefus] = useState<M | null>(null)
  const modalOuverte = useRef(false)
  modalOuverte.current = !!(picker || siabis || refus || complete)

  const dire = (txt: string, ton: 'ok' | 'info' | 'err' = 'ok') => { setMessage({ txt, ton }); setTimeout(() => setMessage(m => (m?.txt === txt ? null : m)), ton === 'info' ? 9000 : 4500) }

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/dispatch/v2/board', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`)
      setBoard(d); setErreur(null)
    } catch (e: any) { setErreur(e?.message || 'connexion impossible') }
  }, [])
  const chargerRef = useRef(charger); chargerRef.current = charger

  // Liste « autres filtres » : on reprend la route de la liste actuelle.
  const chargerAutres = useCallback(async (f: string) => {
    setAutres(null)
    try {
      const r = await fetch(`/api/missions/list?status=${f}&sort=intervention`, { cache: 'no-store' })
      const d = await r.json()
      setAutres(r.ok ? (d.missions || []) : [])
    } catch { setAutres([]) }
  }, [])
  useEffect(() => { if (filtre !== 'cours') chargerAutres(filtre) }, [filtre, chargerAutres])

  // Temps réel + filet de 20 s, comme l'écran actuel ; suspendus quand une fenêtre est ouverte.
  useEffect(() => {
    charger()
    let t: ReturnType<typeof setTimeout> | null = null
    const ch = sb.channel('dispatch-v2-missions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incoming_missions' }, () => {
        if (modalOuverte.current) return
        if (t) clearTimeout(t)
        t = setTimeout(() => chargerRef.current(), 400)
      }).subscribe()
    const stop = pollWhenVisible(() => { if (!modalOuverte.current) chargerRef.current() }, 20_000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { if (t) clearTimeout(t); sb.removeChannel(ch); stop(); clearInterval(tick) }
  }, [charger])

  const apres = () => { charger(); if (filtre !== 'cours') chargerAutres(filtre) }

  // ── Actions (mêmes routes que l'écran actuel) ─────────────────────────────
  const post = async (url: string, body: any) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`)
    return d
  }
  // Passage obligé « autoroute → Siabis » avant de valider ou d'affecter une mission nouvelle.
  const avecAutoroute = (m: M, action: () => void) => {
    const { offer } = shouldOfferSiabis(m.source, m.incident_address)
    if (m.status === 'new' && offer) { setSiabis({ m, next: action }); return }
    action()
  }
  const valider = (m: M) => avecAutoroute(m, async () => {
    setOccupe(m.id)
    try { await post('/api/missions/confirm', { mission_id: m.id, action: 'confirm' }); dire(`${m.vehicle_plate || 'Mission'} validée. Elle attend un chauffeur.`) }
    catch (e: any) { dire(`La validation n'est pas passée : ${e.message}`, 'err') }
    finally { setOccupe(null); apres() }
  })
  const affecter = (m: M, driverId: string) => {
    setPicker(null)
    avecAutoroute(m, async () => {
      setOccupe(m.id)
      try { await post('/api/missions/assign', { mission_id: m.id, driver_id: driverId }); dire('Chauffeur prévenu. Il a 10 minutes pour accepter, sinon l\'app l\'appelle.') }
      catch (e: any) { dire(`L'affectation n'est pas passée : ${e.message}`, 'err') }
      finally { setOccupe(null); apres() }
    })
  }
  const refuser = async (m: M, motif: string) => {
    setRefus(null); setOccupe(m.id)
    try {
      const d = await post('/api/missions/confirm', { mission_id: m.id, action: 'refuse', reason: motif })
      if (d?.assistance?.message) dire(d.assistance.message, d.assistance.etat === 'refuse' ? 'ok' : 'info')
      else dire(`${m.vehicle_plate || 'Mission'} refusée.`)
    } catch (e: any) { dire(`Le refus n'est pas passé : ${e.message}`, 'err') }
    finally { setOccupe(null); apres() }
  }
  const adresse = async (a: Alerte, decision: 'apply' | 'keep') => {
    if (!a.notif_id) { window.location.href = `/dispatch/${a.mission.id}?fiche=1`; return }
    setOccupe(a.mission.id)
    try { await post(`/api/notifications/${a.notif_id}/respond`, { address_decision: decision }); dire('Décision envoyée au chauffeur.') }
    catch (e: any) { dire(`La décision n'est pas passée : ${e.message}`, 'err') }
    finally { setOccupe(null); apres() }
  }

  // ── Rendu ────────────────────────────────────────────────────────────────
  const n = board ? board.cmd.length + board.att.length + board.alertes.length : 0
  const enRetard = board ? [...board.cmd.filter(m => m.limite ? new Date(m.limite).getTime() < now + 2 * 60_000 : minutesDepuis(m.received_at, now) >= 15),
    ...board.att.filter(m => minutesDepuis(m.intervention_date && new Date(m.intervention_date).getTime() < now ? m.intervention_date : m.received_at, now) >= 15)].length : 0
  const sel = selId ? ([...(board?.cmd || []), ...(board?.att || []), ...(board?.lances || []), ...(autres || []), ...(board?.planning || [])].find(m => m.id === selId) || null) : null
  const alertesSel = sel && board ? board.alertes.filter(a => a.mission.id === sel.id) : []
  const aAffecter = !!sel && (sel.status === 'new' || sel.status === 'dispatching')
  useEffect(() => {
    if (!selId || !aAffecter) return
    if (prop?.id === selId) return
    setProp({ id: selId, data: null })
    fetch(`/api/dispatch/v2/proposition/${selId}`, { cache: 'no-store' }).then(r => r.json()).then(d => setProp(p => (p?.id === selId ? { id: selId, data: d } : p))).catch(() => setProp(p => (p?.id === selId ? { id: selId, data: { propositions: [], raison: 'La proposition n\'a pas pu être calculée.' } } : p)))
  }, [selId, aAffecter])   // eslint-disable-line react-hooks/exhaustive-deps
  const listeBrute = filtre === 'cours' ? (board?.lances || null) : autres
  const liste = useMemo(() => {
    if (!listeBrute) return null
    const s = q.trim().toLowerCase().replace(/[-\s.]/g, '')
    if (!s) return listeBrute
    return listeBrute.filter(m => [m.vehicle_plate, m.client_name, m.assisted_name, m.incident_address, m.destination_address, m.mission_number, m.dossier_number, m.external_id, getSourceLabel(m.source, sources), m.assigned_user?.name]
      .join(' ').toLowerCase().replace(/[-\s.]/g, '').includes(s))
  }, [listeBrute, q, sources])

  const carteCmd = (m: M) => {
    const reste = m.limite ? Math.round((new Date(m.limite).getTime() - now) / 1000) : null
    const min = minutesDepuis(m.received_at, now)
    return (
      <Carte glissable sources={sources} occupe={occupe} sel={selId === m.id} onSel={choisir} key={m.id} m={m} niveau="r"
        titre={m.limite ? `À accepter chez ${getSourceLabel(m.source, sources)}` : titreVehicule(m)}
        delai={reste != null ? (reste > 0 ? `reste ${Math.floor(reste / 60)} min ${String(reste % 60).padStart(2, '0')}` : 'délai dépassé') : `reçue il y a ${duree(min)}`}
        delaiCls={reste != null ? (reste < 180 ? 'text-red-800' : 'text-amber-800') : couleurAnciennete(min)}>
        <Btn ton="g" grand disabled={occupe === m.id} onClick={() => setPicker(m)}>Valider et affecter</Btn>
        <Btn disabled={occupe === m.id} onClick={() => valider(m)}>Valider</Btn>
        <Btn ton="d" disabled={occupe === m.id} onClick={() => setRefus(m)}>Refuser</Btn>
      </Carte>
    )
  }
  const carteAtt = (m: M) => {
    const prevue = m.intervention_date && new Date(m.intervention_date).getTime() > now
    const min = minutesDepuis(prevue ? null : (m.intervention_date || m.received_at), now)
    return (
      <Carte glissable sources={sources} occupe={occupe} sel={selId === m.id} onSel={choisir} key={m.id} m={m} niveau={prevue ? 'b' : 'r'} titre={titreVehicule(m)}
        delai={prevue ? `prévue à ${hm(new Date(m.intervention_date))}` : `depuis ${duree(min)}`}
        delaiCls={prevue ? 'text-blue-800' : couleurAnciennete(min)}>
        <Btn ton="p" grand disabled={occupe === m.id} onClick={() => setPicker(m)}>Affecter un chauffeur</Btn>
      </Carte>
    )
  }
  const carteAlerte = (a: Alerte) => {
    const m = a.mission, min = minutesDepuis(a.depuis, now), fiche = () => { window.location.href = `/dispatch/${m.id}?fiche=1` }
    const prenom = (m.assigned_user?.name || 'le chauffeur').split(' ')[0]
    switch (a.type) {
      case 'autoroute': return (
        <Carte sources={sources} occupe={occupe} sel={selId === m.id} onSel={choisir} key={a.type + m.id} m={m} niveau="r" titre="Autoroute : tarification à trancher">
          <Btn ton="p" grand onClick={() => setSiabis({ m, next: null })}>Trancher</Btn>
        </Carte>)
      case 'adresse': return (
        <Carte sources={sources} occupe={occupe} sel={selId === m.id} onSel={choisir} key={a.type + m.id} m={m} niveau="a" titre={`Adresse modifiée par ${getSourceLabel(m.source, sources)}`} delai={a.depuis ? `depuis ${duree(min)}` : undefined} delaiCls="text-amber-800"
          detail={<>nouvelle : <b className="text-stone-900">{commune(a.nouvelle, null)}</b></>}>
          <Btn ton="p" grand disabled={occupe === m.id} onClick={() => adresse(a, 'apply')}>Appliquer</Btn>
          <Btn grand disabled={occupe === m.id} onClick={() => adresse(a, 'keep')}>Garder l'actuelle</Btn>
        </Carte>)
      case 'pas_acceptee': return (
        <Carte sources={sources} occupe={occupe} sel={selId === m.id} onSel={choisir} key={a.type + m.id} m={m} niveau="a" titre={`Pas encore acceptée par ${prenom}`}
          delai={`${duree(min)} · ${a.appel_fait ? 'appel automatique fait' : 'appel à 10'}`} delaiCls={min >= 10 ? 'text-red-800' : 'text-amber-800'}>
          {m.assigned_user?.phone && <a href={`tel:${m.assigned_user.phone}`} onClick={e => e.stopPropagation()} className="flex-1 min-h-[44px] px-3.5 rounded-xl font-bold text-sm bg-white border border-stone-300 text-stone-900 inline-flex items-center justify-center">Appeler {prenom}</a>}
          <Btn grand onClick={() => setPicker(m)}>Réaffecter</Btn>
        </Carte>)
      case 'derogation': return (
        <Carte sources={sources} occupe={occupe} sel={selId === m.id} onSel={choisir} key={a.type + m.id} m={m} niveau="b" titre="Dérogation de paiement" detail={a.motif || undefined} delai={`depuis ${duree(min)}`} delaiCls={couleurAnciennete(min)}>
          <Btn ton="p" grand onClick={fiche}>Décider</Btn>
        </Carte>)
      case 'pause_depassee': return (
        <Carte sources={sources} occupe={occupe} sel={selId === m.id} onSel={choisir} key={a.type + m.id} m={m} niveau="a" titre="Pause dépassée" detail={a.motif || undefined} delai={`depuis ${duree(min)}`} delaiCls="text-red-800">
          <Btn grand onClick={fiche}>Ouvrir la fiche</Btn>
        </Carte>)
      case 'annulee_ima': return (
        <Carte sources={sources} occupe={occupe} sel={selId === m.id} onSel={choisir} key={a.type + m.id} m={m} niveau="b" titre="Annulée par IMA après acceptation" detail="devient un trajet à vide">
          <Btn grand onClick={fiche}>Ouvrir la fiche</Btn>
        </Carte>)
    }
    return null
  }

  return (
    <AppShell title="Dispatch" userName={userName} userEmail={userEmail} userId={userId} userRole={userRole} userModules={userModules}>
      {/* Téléphone : le rappel des espèces et la pastille de Max passaient par-dessus les cartes (Olivier 11/11). Masqués ici seulement. */}
      <style>{`@media (max-width: 1023px) { [data-flottant="especes"], [data-flottant="max"] { display: none !important; } }`}</style>
      <div className="p-2.5 lg:p-3 flex flex-col gap-2.5 min-w-0 max-w-full [contain:inline-size]">
        {/* Repères du jour */}
        <div className="flex flex-wrap gap-2 items-center rounded-2xl px-3 py-2.5 text-white" style={{ background: 'linear-gradient(135deg,#1b1220 0%,#4a1230 55%,#E11D2E 100%)' }}>
          {([['À traiter', n, '#fca5a5'], ['En retard', enRetard, '#fcd34d'], ['En cours', board?.lances.length ?? 0, null]] as const).map(([l, v, c]) => (
            <span key={l} className="inline-flex items-center gap-2 min-h-[36px] px-3 rounded-full font-semibold text-sm bg-white/15 ring-1 ring-white/25 whitespace-nowrap">
              {c && <i className="w-2 h-2 rounded-full" style={{ background: c }} />}{l} <b className="text-base tabular-nums">{v}</b>
            </span>
          ))}
          <span className="flex-1" />
          <Link href="/dispatch/new" className="min-h-[44px] px-4 rounded-xl bg-white text-red-900 font-extrabold text-sm inline-flex items-center">+ Nouvelle mission</Link>
        </div>
        <div className="lg:hidden grid grid-cols-3 gap-1 bg-stone-100 rounded-xl p-1" role="tablist" aria-label="Vue">
          {([['traiter', `À traiter · ${n}`], ['cours', `En cours · ${board?.lances.length ?? 0}`], ['chauffeurs', 'Chauffeurs']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={ongletTel === k} onClick={() => setOngletTel(k)}
              className={`min-h-[44px] rounded-lg font-bold text-[13.5px] ${ongletTel === k ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'}`}>{l}</button>
          ))}
        </div>
        {erreur && <div className="rounded-xl bg-red-100 text-red-900 px-4 py-2.5 text-sm font-semibold">Les données n'ont pas pu être relues ({erreur}). Nouvel essai dans quelques secondes.</div>}
        {message && <div className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${message.ton === 'err' ? 'bg-red-100 text-red-900' : message.ton === 'info' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>{message.txt}</div>}

        <div className={`grid grid-cols-[minmax(0,1fr)] gap-2.5 min-w-0 lg:h-[calc(100vh-170px)] lg:grid-cols-[minmax(320px,1fr)_minmax(0,1.3fr)] xl:grid-cols-[minmax(320px,1fr)_minmax(0,1.3fr)_minmax(340px,1fr)]`}>
          {/* Colonne « À traiter » */}
          <section className={`rounded-2xl border bg-surface flex-col min-h-0 min-w-0 ${ongletTel === 'traiter' ? 'flex' : 'hidden lg:flex'}`}>
            <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2"><b className="text-[16px] text-ink whitespace-nowrap">À traiter · {n}</b><span className="text-stone-500 text-[13px] truncate hidden sm:inline">le plus récent en haut</span></header>
            {!board ? <p className="px-3 pb-3 text-stone-500">Chargement…</p> : <>
              {/* Rien d'épinglé (Olivier 12/11) : En commande et En attente en tête, puis Alertes ; toute la colonne défile d'un bloc. */}
              <div className="px-3 pb-3 flex flex-col gap-2 lg:overflow-y-auto min-h-0">
                <Section titre="En commande" sous="à valider" nb={board.cmd.length} vide="Rien à valider.">{board.cmd.map(carteCmd)}</Section>
                <Section titre="En attente" sous="à affecter" nb={board.att.length} vide="Toutes les missions ont un chauffeur.">{board.att.map(carteAtt)}</Section>
                <Section titre="Alertes" sous="missions déjà lancées" nb={board.alertes.length} vide="Aucune alerte.">{board.alertes.map(carteAlerte)}</Section>
              </div>
            </>}
          </section>

          {/* Liste des missions lancées */}
          <section className={`rounded-2xl border bg-surface flex-col min-h-0 min-w-0 ${ongletTel === 'cours' ? 'flex' : 'hidden lg:flex'}`}>
            <header className="px-3 pt-3 pb-2 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <b className="text-[16px] text-ink">{vueCentre === 'planning' ? 'La journée des chauffeurs' : vueCentre === 'carte' ? 'Carte' : 'Missions'}</b>
                <span className="hidden lg:inline-flex bg-stone-100 rounded-xl p-1">
                  {([['liste', 'Liste'], ['planning', 'Planning'], ['carte', 'Carte']] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setVueCentre(k)} className={`min-h-[36px] px-3.5 rounded-lg font-bold text-sm ${vueCentre === k ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'}`}>{l}</button>
                  ))}
                </span>
              </div>
              {vueCentre === 'planning' && board && <div className="hidden lg:block"><Planning missions={board.planning || []} chauffeurs={drivers} etats={etatsChauffeurs} sources={sources} now={now} selId={selId}
                onSel={choisir} onDepot={(missionId, driverId) => { const m = [...board.cmd, ...board.att].find(x => x.id === missionId); if (m) affecter(m, driverId) }} /></div>}
              {vueCentre === 'carte' && board && (() => {
                const urgents = new Set([...board.cmd, ...board.att].map(m => m.id).concat(board.alertes.map(a => a.mission.id)))
                const missionsCarte = [...board.cmd, ...board.att, ...board.lances].filter(m => m.incident_lat != null && m.incident_lng != null)
                  .map(m => ({ id: m.id, lat: Number(m.incident_lat), lng: Number(m.incident_lng), couleur: getSourceColorHex(m.source, sources), texte: typeCourt(m), titre: `${getSourceLabel(m.source, sources)} ${typeCourt(m)} · ${m.vehicle_plate || ''} · ${etat(m).txt}`, urgent: urgents.has(m.id) }))
                const chauffeursCarte = (etatsChauffeurs || []).filter((d: any) => d.lat != null && d.lng != null && !d.on_conge)
                  .map((d: any) => ({ id: d.id, lat: Number(d.lat), lng: Number(d.lng), initiales: String(d.name || '?').split(' ').map((x: string) => x[0]).join('').slice(0, 2).toUpperCase(), titre: `${d.name} · ${d.status === 'en_mission' ? 'en mission' : d.status === 'en_service' ? 'libre' : 'hors service'}`, occupe: d.status === 'en_mission' }))
                const sansPosition = [...board.cmd, ...board.att, ...board.lances].length - missionsCarte.length
                return (
                  <div className="hidden lg:flex flex-col gap-1.5">
                    <CarteDispatch missions={missionsCarte} chauffeurs={chauffeursCarte} onMission={id => setSelId(id)} />
                    <p className="text-stone-500 text-[12.5px]">Missions à la couleur de l'assistance, cerclées de rouge quand elles attendent un geste · chauffeurs : vert libre, orange en mission (position relevée seulement pendant une mission).{sansPosition > 0 ? ` ${sansPosition} mission${sansPosition > 1 ? 's' : ''} sans adresse localisée : ouvrez-les pour la vérifier.` : ''}</p>
                  </div>
                )
              })()}
              <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="Plaque, client, adresse, n° de fiche…" aria-label="Chercher une mission"
                className={`min-h-[44px] rounded-xl border border-stone-300 bg-stone-50 px-3 text-stone-900 ${vueCentre !== 'liste' ? 'lg:hidden' : ''}`} />
              <div className={`flex gap-1.5 flex-wrap ${vueCentre !== 'liste' ? 'lg:hidden' : ''}`}>
                {([['cours', `En cours · ${board?.lances.length ?? 0}`], ['rdv', 'Rendez-vous'], ['vhu', 'VHU'], ['parked', 'À relivrer'], ['all', 'Toutes']] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setFiltre(k)}
                    className={`min-h-[40px] px-3.5 rounded-full border font-semibold text-sm ${filtre === k ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-900 border-stone-200'}`}>{l}</button>
                ))}
                <Link href="/missions-terminees" className="min-h-[40px] px-3.5 rounded-full border border-stone-200 bg-white text-stone-900 font-semibold text-sm inline-flex items-center">Terminées ↗</Link>
              </div>
            </header>
            <div className={`overflow-auto min-h-0 px-1 ${vueCentre !== 'liste' ? 'lg:hidden' : ''}`}>
              {!liste ? <p className="px-3 py-2 text-stone-500">Chargement…</p> : liste.length === 0 ? <p className="px-3 py-2 text-stone-500">{q ? 'Aucune mission ne correspond.' : filtre === 'cours' ? 'Aucune mission lancée pour l\'instant.' : 'Rien dans cette vue.'}</p> : (
                <>
                <div className="lg:hidden flex flex-col gap-2 px-2 pb-2">
                  {liste.map(m => { const e = etat(m); return (
                    <div key={m.id} role="button" tabIndex={0} onClick={() => choisir(m)} onKeyDown={ev => { if (ev.key === 'Enter') choisir(m) }} className={`cursor-pointer text-left rounded-xl border border-stone-200 p-2.5 flex flex-col gap-1.5 min-w-0 ${couleurType(m).fond}`}>
                      <div className="flex items-center justify-between gap-2"><b className="text-stone-900 text-[14px]">{m.assigned_user?.name || 'Sans chauffeur'}</b><span className={`px-2 py-0.5 rounded-full text-[12px] font-bold ${e.cls}`}>{e.txt}</span></div>
                      <div className="flex items-center gap-1.5 min-w-0"><Source m={m} sources={sources} /><span className={`px-1.5 py-0.5 rounded-md text-[11.5px] font-bold ${couleurType(m).pastille}`} title={couleurType(m).nom}>{typeCourt(m)}</span><Plaque m={m} /><span className="text-stone-600 text-[13px] truncate">{trajetCourt(m)}</span></div>
                      {m.status === 'assigned' && m.assigned_at && <span className={`text-[12.5px] font-bold ${minutesDepuis(m.assigned_at, now) >= 10 ? 'text-red-800' : 'text-amber-800'}`}>pas encore acceptée · {duree(minutesDepuis(m.assigned_at, now))}</span>}
                      <DetailTel m={m} />
                      {(m.accepted_at || m.on_way_at || m.on_site_at) && <Avancement m={m} />}
                      {m.assigned_user?.phone && (
                        <a href={`tel:${m.assigned_user.phone}`} onClick={ev => ev.stopPropagation()} className="min-h-[44px] rounded-xl border border-stone-300 bg-white font-bold text-sm text-stone-900 inline-flex items-center justify-center">Appeler {String(m.assigned_user.name || '').split(' ')[0]}</a>
                      )}
                    </div>) })}
                </div>
                <table className="hidden lg:table w-full min-w-[520px] text-[13.5px]">
                  <thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-stone-500"><th className="px-2 py-2">État</th><th className="px-2 py-2">Mission</th><th className="px-2 py-2">Trajet</th><th className="px-2 py-2">Chauffeur</th></tr></thead>
                  <tbody>
                    {liste.map(m => {
                      const e = etat(m)
                      return (
                        <tr key={m.id} className="border-t border-stone-200 hover:bg-stone-50 cursor-pointer align-top" onClick={() => choisir(m)} style={selId === m.id ? { background: '#f5f5f4', boxShadow: 'inset 3px 0 0 #1c1917' } : undefined}>
                          <td className="px-2 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[12px] font-bold whitespace-nowrap ${e.cls}`}>{e.txt}</span>
                            {m.status === 'assigned' && m.assigned_at && <div className={`mt-1 text-[12.5px] font-bold tabular-nums ${minutesDepuis(m.assigned_at, now) >= 10 ? 'text-red-800' : 'text-amber-800'}`}>{duree(minutesDepuis(m.assigned_at, now))}</div>}
                            {m.intervention_date && new Date(m.intervention_date).getTime() > now && <div className="mt-1 text-[12.5px] text-stone-600">{new Date(m.intervention_date).toLocaleString('fr-BE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })}</div>}
                          </td>
                          <td className="px-2 py-2"><div className="flex gap-1.5 items-center flex-wrap"><Source m={m} sources={sources} /><span className={`px-1.5 py-0.5 rounded-md text-[11.5px] font-bold ${couleurType(m).pastille}`} title={couleurType(m).nom}>{typeCourt(m)}</span></div>
                            <div className="mt-1 flex gap-1.5 items-center flex-wrap"><Plaque m={m} /><span className="text-stone-600">{vehicule(m)}</span></div></td>
                          <td className="px-2 py-2 text-stone-800 max-w-[420px]"><div className="truncate">{court(m.incident_address) || m.incident_city || '—'}</div>{(m.destination_name || m.destination_address) && <div className="text-stone-500 truncate">→ {court(m.destination_name || m.destination_address)}</div>}{m.incident_description && <div className="text-stone-500 text-[12.5px] line-clamp-1" title={m.incident_description}>{panneLisible(m.incident_description)}</div>}</td>
                          <td className="px-2 py-2 text-stone-900">{m.assigned_user?.name || <span className="text-stone-400">—</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </>
              )}
            </div>
          </section>

          {/* Chauffeurs (téléphone) : mêmes états que l'écran actuel, missions en cours de chacun */}
          {ongletTel === 'chauffeurs' && (
            <section className="lg:hidden rounded-2xl border bg-surface p-3 flex flex-col gap-2">
              {!etatsChauffeurs ? <p className="text-stone-500">Chargement…</p> : etatsChauffeurs.length === 0 ? <p className="text-stone-500">Aucun chauffeur.</p> : etatsChauffeurs.map((d: any) => {
                const ms = (board?.lances || []).filter(m => m.assigned_to === d.id)
                const st = d.on_conge ? ['En congé', 'bg-stone-200 text-stone-700'] : d.manual_offline ? ['Hors ligne', 'bg-red-100 text-red-800'] : d.status === 'en_mission' ? ['En mission', 'bg-amber-100 text-amber-900'] : d.status === 'en_service' ? ['Libre', 'bg-emerald-100 text-emerald-800'] : ['Hors service', 'bg-stone-200 text-stone-700']
                return (
                  <div key={d.id} className="rounded-xl border border-stone-200 bg-white p-2.5 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2"><b className="text-stone-900">{d.name}</b><span className={`px-2 py-0.5 rounded-full text-[12px] font-bold ${st[1]}`}>{st[0]}</span></div>
                    {(d.schedule_day || d.schedule_night) && <span className="text-stone-500 text-[12.5px]">De garde {d.schedule_day && d.schedule_night ? 'jour et nuit' : d.schedule_day ? 'de jour' : 'de nuit'}</span>}
                    {ms.map(m => <button key={m.id} type="button" onClick={() => choisir(m)} className="min-h-[44px] rounded-lg border border-stone-200 px-2.5 text-left text-[13px] text-stone-800"><b>{m.vehicle_plate || '—'}</b> · {etat(m).txt} · {trajetCourt(m)}</button>)}
                  </div>
                )
              })}
            </section>
          )}

          {/* Volet de droite : toujours présent sur grand écran, même vide (Olivier 12/11). */}
          {!sel && (
            <aside className="hidden xl:flex rounded-2xl border border-dashed border-stone-300 bg-surface flex-col items-center justify-center text-center gap-2 p-6 min-h-0">
              <b className="text-stone-700">Aucune mission ouverte</b>
              <span className="text-stone-500 text-sm max-w-[260px]">Touchez une carte à gauche ou une ligne de la liste pour voir son détail, le chauffeur proposé et les actions.</span>
            </aside>
          )}
          {/* Volet de droite : le détail de la mission choisie. */}
          {sel && (
            <aside className="rounded-2xl border bg-surface flex flex-col min-h-0 fixed inset-0 z-40 lg:inset-y-0 lg:left-auto lg:w-[420px] xl:static xl:w-auto xl:z-auto shadow-2xl xl:shadow-none">
              <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                <b className="text-[16px] text-ink">{sel.mission_number ? `#${sel.mission_number}` : 'Mission'}</b>
                <button type="button" onClick={() => setSelId(null)} aria-label="Fermer le détail" className="w-11 h-11 rounded-xl border border-stone-200 bg-white text-stone-900 text-lg">✕</button>
              </header>
              <div className="overflow-y-auto px-3 pb-3 flex flex-col gap-3 min-h-0">
                <div className="flex items-center gap-1.5 flex-wrap"><Plaque m={sel} /><Source m={sel} sources={sources} /><span className={`px-1.5 py-0.5 rounded-md text-[11.5px] font-bold ${couleurType(sel).pastille}`} title={couleurType(sel).nom}>{typeCourt(sel)}</span><span className={`px-2 py-0.5 rounded-full text-[12px] font-bold ${etat(sel).cls}`}>{etat(sel).txt}</span></div>
                <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[13.5px]">
                  {([
                    ['Client', [sel.client_name, sel.client_phone].filter(Boolean).join(' · ')],
                    ['Sur place', sel.assisted_name && sel.assisted_name !== sel.client_name ? [sel.assisted_name, sel.assisted_phone].filter(Boolean).join(' · ') : ''],
                    ['Véhicule', vehicule(sel)],
                    ['Lieu', court(sel.incident_address) || sel.incident_city],
                    ['Vers', sel.destination_name || sel.destination_address ? [court(sel.destination_name), court(sel.destination_address)].filter(Boolean).join(', ') : ''],
                    ['Panne', panneLisible(sel.incident_description)],
                    ['Délai', sel.limite ? `accepter chez ${getSourceLabel(sel.source, sources)} avant ${hm(new Date(sel.limite))}` : sel.intervention_date && new Date(sel.intervention_date).getTime() > now ? `prévue à ${hm(new Date(sel.intervention_date))}` : ''],
                    ['Chauffeur', sel.assigned_user?.name || 'Aucun'],
                    ['Dossier', sel.dossier_number || sel.external_id],
                  ] as const).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-stone-500">{k}</dt><dd className="text-stone-900 font-semibold break-words">{v}</dd></div>
                  ))}
                </dl>
                {Array.isArray(sel.warnings) && sel.warnings.length > 0 && <div className="flex flex-wrap gap-1">{sel.warnings.map((w: string) => <span key={w} className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[12px] font-bold">⚠ {w}</span>)}</div>}
                {alertesSel.map(a => <div key={a.type}>{carteAlerte(a)}</div>)}
                {aAffecter && (
                  <div className="rounded-xl border-2 border-emerald-600 bg-emerald-50 p-2.5 flex flex-col gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800">Chauffeur proposé</span>
                    {!prop?.data ? <span className="text-stone-600 text-sm">Calcul en cours…</span>
                      : !prop.data.propositions?.length ? <span className="text-stone-700 text-sm">{prop.data.raison || 'Aucune proposition.'}</span>
                      : <>
                        {(() => { const p0 = prop.data.propositions[0]; return (
                          <>
                            <div className="flex items-start gap-2">
                              <span className="w-9 h-9 rounded-xl bg-emerald-700 text-white font-extrabold text-xs flex items-center justify-center flex-none">{String(p0.nom).split(' ').map((x: string) => x[0]).join('').slice(0, 2)}</span>
                              <span className="min-w-0"><b className="text-stone-900">{p0.nom}{p0.eta_min != null ? ` · sur place dans ${p0.eta_min} min` : ''}</b><br /><span className="text-stone-600 text-[13px]">{p0.raison}</span></span>
                            </div>
                            <Btn ton="g" disabled={occupe === sel.id} onClick={() => affecter(sel, p0.id)}>{sel.status === 'new' ? 'Valider et affecter' : 'Affecter'} à {String(p0.nom).split(' ')[0]}</Btn>
                          </>) })()}
                        {prop.data.propositions.slice(1).map((p: any) => (
                          <div key={p.id} className="flex items-center gap-2 border-t border-dashed border-emerald-200 pt-2">
                            <span className="flex-1 min-w-0 text-[13px]"><b className="text-stone-900">{p.nom}</b>{p.eta_min != null ? ` · ${p.eta_min} min` : ''} <span className="text-stone-600">{p.raison.split(', ')[0]}</span></span>
                            <Btn disabled={occupe === sel.id} onClick={() => affecter(sel, p.id)}>Choisir</Btn>
                          </div>
                        ))}
                        <span className="text-stone-500 text-[12px]">Tri {prop.data.tri}.</span>
                      </>}
                    <Btn onClick={() => setPicker(sel)}>Voir tous les chauffeurs</Btn>
                  </div>
                )}
                <div className="flex gap-1.5 flex-wrap">
                  {sel.status === 'new' && <><Btn grand disabled={occupe === sel.id} onClick={() => valider(sel)}>Valider sans affecter</Btn><Btn ton="d" disabled={occupe === sel.id} onClick={() => setRefus(sel)}>Refuser</Btn></>}
                  {['assigned', 'accepted', 'in_progress', 'delivering'].includes(sel.status) && <Btn grand onClick={() => setPicker(sel)}>Réaffecter</Btn>}
                  {sel.status === 'parked' && <Relivrer m={sel} onCree={id => { dire('Relivraison créée. Choisissez le chauffeur.'); apres(); setSelId(id); setPicker({ id, status: 'dispatching', vehicle_plate: sel.vehicle_plate }) }} />}
                </div>
                <Avancement m={sel} />
                <div className="flex gap-1.5 flex-wrap">
                  <Btn ton="p" grand onClick={() => setComplete({ id: sel.id, titre: [sel.vehicle_plate, sel.mission_number ? '#' + sel.mission_number : ''].filter(Boolean).join(' · ') })}>Tout le détail et les actions</Btn>
                  <Link href={`/dispatch/dossier/${sel.id}`} className="flex-1 min-h-[44px] px-3.5 rounded-xl font-bold text-sm bg-white border border-stone-300 text-stone-900 inline-flex items-center justify-center">Dossier</Link>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>

      {complete && (
        <FicheComplete missionId={complete.id} titre={complete.titre} drivers={drivers} sources={sources} onFermer={() => { setComplete(null); apres() }} />
      )}
      {picker && <DriverPickerModal missionId={picker.id} incidentLat={picker.incident_lat} incidentLng={picker.incident_lng} onPick={id => affecter(picker, id)} onClose={() => setPicker(null)} />}
      {siabis && (
        <HighwaySiabisModal missionId={siabis.m.id} highwayRef={shouldOfferSiabis(siabis.m.source, siabis.m.incident_address).highwayRef} blocking={!!siabis.next}
          onClose={decided => { const nx = siabis.next; setSiabis(null); if (decided && nx) nx(); else apres() }} />
      )}
      {refus && <FenetreRefus m={refus} libelle={getSourceLabel(refus.source, sources)} onAnnuler={() => setRefus(null)} onConfirmer={motif => refuser(refus, motif)} />}
    </AppShell>
  )
}

// Refus avec motif (remplace la boîte native du navigateur). Fermeture par ✕ ou bouton, jamais au clic sur le fond.
const MOTIFS = ['Pas de chauffeur disponible dans le délai', 'Hors de notre zone', 'Doublon', 'Erreur de l\'assistance', 'Autre']
function FenetreRefus({ m, libelle, onAnnuler, onConfirmer }: { m: M; libelle: string; onAnnuler: () => void; onConfirmer: (motif: string) => void }) {
  const [motif, setMotif] = useState(MOTIFS[0])
  const [precision, setPrecision] = useState('')
  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-start justify-center p-4 pt-16 overflow-y-auto">
      <div role="dialog" aria-modal="true" aria-label="Refuser la mission" className="bg-white rounded-2xl w-full max-w-md p-5 flex flex-col gap-3 text-stone-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Refuser {m.vehicle_plate || 'la mission'} · {libelle}</h2>
          <button type="button" onClick={onAnnuler} aria-label="Fermer" className="w-11 h-11 rounded-xl border border-stone-200 text-lg flex-none">✕</button>
        </div>
        <label className="flex flex-col gap-1"><span className="text-sm font-bold">Motif</span>
          <select value={motif} onChange={e => setMotif(e.target.value)} className="min-h-[46px] rounded-xl border border-stone-300 bg-stone-50 px-3">{MOTIFS.map(x => <option key={x}>{x}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-sm font-bold">Précision <span className="font-normal text-stone-500">· facultatif</span></span>
          <input value={precision} onChange={e => setPrecision(e.target.value)} className="min-h-[46px] rounded-xl border border-stone-300 bg-stone-50 px-3" />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => onConfirmer(precision.trim() ? `${motif} — ${precision.trim()}` : motif)} className="flex-1 min-h-[46px] rounded-xl bg-red-100 text-red-800 font-bold">Refuser</button>
          <button type="button" onClick={onAnnuler} className="flex-1 min-h-[46px] rounded-xl border border-stone-300 font-bold">Ne pas refuser</button>
        </div>
      </div>
    </div>
  )
}
