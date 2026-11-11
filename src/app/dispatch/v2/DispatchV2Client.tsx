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
import { getSourceLabel, getSourceColor, type SourceDisplay } from '@/lib/missions/source-display'
import { pollWhenVisible } from '@/lib/client/poll'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

interface Props {
  userName: string; userEmail?: string; userId?: string; userRole: string; userModules: string[]
  sources: SourceDisplay[]
}
type M = Record<string, any>
type Alerte = { type: string; depuis: string | null; mission: M; [k: string]: any }
type Board = { cmd: M[]; att: M[]; alertes: Alerte[]; lances: M[] }

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
function duree(min: number) {
  if (min < 60) return `${min} min`
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
  const j = Math.floor(min / 1440); return `${j} jour${j > 1 ? 's' : ''}`
}
function couleurAnciennete(min: number) { return min >= 30 ? 'text-red-800' : min >= 15 ? 'text-amber-800' : 'text-emerald-800' }
// Adresse courte : sans le pays final ni ce qui suit un « | » (doublons d'adresse des assistances).
const court = (a?: string | null) => String(a || '').replace(/\s*\|.*$/, '').replace(/,?\s*(BEL|Belgique|Belgium|BE)\s*$/i, '').replace(/\s+/g, ' ').trim()
const trajet = (m: M) => [court(m.incident_address) || m.incident_city, m.destination_name || m.destination_address ? '→ ' + court(m.destination_name || m.destination_address) : ''].filter(Boolean).join(' ')
const vehicule = (m: M) => [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')

// ── Morceaux d'affichage (hors du composant : pas recréés à chaque seconde) ──
const Source = ({ m, sources }: { m: M; sources: SourceDisplay[] }) => (
  <span className={`px-2 py-0.5 rounded-md text-[11.5px] font-bold text-white whitespace-nowrap ${getSourceColor(m.source, sources)}`}>{getSourceLabel(m.source, sources)}</span>
)
const Plaque = ({ m }: { m: M }) => m.vehicle_plate
  ? <span className="font-mono font-bold text-[12.5px] border-[1.5px] border-ink rounded px-1.5 bg-white text-stone-900 whitespace-nowrap">{m.vehicle_plate}</span>
  : <span className="text-ink-muted text-xs">plaque inconnue</span>
const Btn = ({ children, onClick, ton = 'o', disabled, grand }: { children: React.ReactNode; onClick: () => void; ton?: 'p' | 'g' | 'o' | 'd'; disabled?: boolean; grand?: boolean }) => (
  <button type="button" onClick={e => { e.stopPropagation(); onClick() }} disabled={disabled}
    className={`min-h-[44px] px-3.5 rounded-xl font-bold text-sm disabled:opacity-50 ${grand ? 'flex-1' : ''} ${
      ton === 'p' ? 'bg-stone-900 text-white' : ton === 'g' ? 'bg-emerald-700 text-white' : ton === 'd' ? 'bg-red-100 text-red-800' : 'bg-white border border-stone-300 text-stone-900'}`}>
    {children}
  </button>
)
const Carte = ({ m, sources, occupe, titre, delai, delaiCls, niveau, detail, children }: { m: M; sources: SourceDisplay[]; occupe: string | null; titre: string; delai?: string; delaiCls?: string; niveau: 'r' | 'a' | 'b'; detail?: React.ReactNode; children?: React.ReactNode }) => (
  <div className={`rounded-xl border border-stone-200 border-l-[5px] p-2.5 flex flex-col gap-1.5 ${niveau === 'r' ? 'border-l-red-600 bg-red-50/60' : niveau === 'a' ? 'border-l-amber-500 bg-white' : 'border-l-blue-600 bg-white'} ${occupe === m.id ? 'opacity-60' : ''}`}>
    <div className="flex items-start justify-between gap-2">
      <Link href={`/dispatch/${m.id}?fiche=1`} className="font-bold text-[14px] text-stone-900 hover:underline">{titre}</Link>
      {delai && <span className={`font-extrabold text-[13px] tabular-nums whitespace-nowrap ${delaiCls || ''}`}>{delai}</span>}
    </div>
    <div className="flex items-center gap-1.5 flex-wrap">
      <Source m={m} sources={sources} /><span className="px-1.5 py-0.5 rounded-md bg-stone-100 text-stone-800 text-[11.5px] font-bold">{typeCourt(m)}</span><Plaque m={m} />
      <span className="text-stone-600 text-[13px]">{vehicule(m)}</span>
    </div>
    <div className="text-stone-700 text-[13px] truncate" title={detail ? undefined : trajet(m)}>{detail ?? trajet(m)}</div>
    {m.incident_description && !detail && <div className="text-stone-500 text-[12.5px] line-clamp-1" title={m.incident_description}>{m.incident_description}</div>}
    {Array.isArray(m.warnings) && m.warnings.length > 0 && (
      <div className="flex flex-wrap gap-1">{m.warnings.map((w: string) => <span key={w} className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11.5px] font-bold">⚠ {w}</span>)}</div>
    )}
    {children && <div className="flex gap-1.5 flex-wrap">{children}</div>}
  </div>
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


export default function DispatchV2Client({ userName, userEmail, userId, userRole, userModules, sources }: Props) {
  const [board, setBoard] = useState<Board | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [filtre, setFiltre] = useState<'cours' | 'rdv' | 'vhu' | 'parked' | 'all'>('cours')
  const [autres, setAutres] = useState<M[] | null>(null)
  const [q, setQ] = useState('')
  const [occupe, setOccupe] = useState<string | null>(null)
  const [message, setMessage] = useState<{ txt: string; ton: 'ok' | 'info' | 'err' } | null>(null)
  const [picker, setPicker] = useState<M | null>(null)
  const [siabis, setSiabis] = useState<{ m: M; next: (() => void) | null } | null>(null)
  const [refus, setRefus] = useState<M | null>(null)
  const modalOuverte = useRef(false)
  modalOuverte.current = !!(picker || siabis || refus)

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
      <Carte sources={sources} occupe={occupe} key={m.id} m={m} niveau="r"
        titre={m.limite ? `À accepter chez ${getSourceLabel(m.source, sources)}` : 'À valider'}
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
      <Carte sources={sources} occupe={occupe} key={m.id} m={m} niveau={prevue ? 'b' : 'r'} titre="Sans chauffeur"
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
        <Carte sources={sources} occupe={occupe} key={a.type + m.id} m={m} niveau="r" titre="Autoroute : tarification à trancher">
          <Btn ton="p" grand onClick={() => setSiabis({ m, next: null })}>Trancher</Btn>
        </Carte>)
      case 'adresse': return (
        <Carte sources={sources} occupe={occupe} key={a.type + m.id} m={m} niveau="a" titre={`Adresse modifiée par ${getSourceLabel(m.source, sources)}`} delai={a.depuis ? `depuis ${duree(min)}` : undefined} delaiCls="text-amber-800"
          detail={<>{a.ancienne || '—'} → <b className="text-stone-900">{a.nouveau_nom ? a.nouveau_nom + ', ' : ''}{a.nouvelle}</b></>}>
          <Btn ton="p" grand disabled={occupe === m.id} onClick={() => adresse(a, 'apply')}>Appliquer</Btn>
          <Btn grand disabled={occupe === m.id} onClick={() => adresse(a, 'keep')}>Garder l'actuelle</Btn>
        </Carte>)
      case 'pas_acceptee': return (
        <Carte sources={sources} occupe={occupe} key={a.type + m.id} m={m} niveau="a" titre={`Pas encore acceptée par ${prenom}`}
          delai={`${duree(min)} · ${a.appel_fait ? 'appel automatique fait' : 'appel à 10'}`} delaiCls={min >= 10 ? 'text-red-800' : 'text-amber-800'}>
          {m.assigned_user?.phone && <a href={`tel:${m.assigned_user.phone}`} onClick={e => e.stopPropagation()} className="flex-1 min-h-[44px] px-3.5 rounded-xl font-bold text-sm bg-white border border-stone-300 text-stone-900 inline-flex items-center justify-center">Appeler {prenom}</a>}
          <Btn grand onClick={() => setPicker(m)}>Réaffecter</Btn>
        </Carte>)
      case 'derogation': return (
        <Carte sources={sources} occupe={occupe} key={a.type + m.id} m={m} niveau="b" titre="Dérogation de paiement" detail={a.motif || 'Le chauffeur demande une dérogation.'} delai={`depuis ${duree(min)}`} delaiCls={couleurAnciennete(min)}>
          <Btn ton="p" grand onClick={fiche}>Décider</Btn>
        </Carte>)
      case 'pause_depassee': return (
        <Carte sources={sources} occupe={occupe} key={a.type + m.id} m={m} niveau="a" titre="Pause dépassée" detail={a.motif || undefined} delai={`depuis ${duree(min)}`} delaiCls="text-red-800">
          <Btn grand onClick={fiche}>Ouvrir la fiche</Btn>
        </Carte>)
      case 'annulee_ima': return (
        <Carte sources={sources} occupe={occupe} key={a.type + m.id} m={m} niveau="b" titre="Annulée par IMA après acceptation" detail="Elle devient un trajet à vide.">
          <Btn grand onClick={fiche}>Ouvrir la fiche</Btn>
        </Carte>)
    }
    return null
  }

  return (
    <AppShell title="Dispatch" userName={userName} userEmail={userEmail} userId={userId} userRole={userRole} userModules={userModules}>
      <div className="p-2.5 lg:p-3 flex flex-col gap-2.5">
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
        {erreur && <div className="rounded-xl bg-red-100 text-red-900 px-4 py-2.5 text-sm font-semibold">Les données n'ont pas pu être relues ({erreur}). Nouvel essai dans quelques secondes.</div>}
        {message && <div className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${message.ton === 'err' ? 'bg-red-100 text-red-900' : message.ton === 'info' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>{message.txt}</div>}

        <div className="grid gap-2.5 lg:grid-cols-[minmax(340px,1fr)_minmax(0,1.6fr)] lg:h-[calc(100vh-170px)]">
          {/* Colonne « À traiter » */}
          <section className="rounded-2xl border bg-surface flex flex-col min-h-0">
            <header className="flex items-center justify-between px-3 pt-3 pb-2"><b className="text-[16px] text-ink">À traiter · {n}</b><span className="text-stone-500 text-[13px]">le plus pressé en haut</span></header>
            {!board ? <p className="px-3 pb-3 text-stone-500">Chargement…</p> : <>
              <div className="px-3 pb-2 flex flex-col gap-2 lg:max-h-[66%] lg:overflow-y-auto lg:flex-none lg:border-b-2 lg:border-dashed lg:border-stone-200">
                <Section titre="En commande" sous="à valider" nb={board.cmd.length} vide="Rien à valider.">{board.cmd.map(carteCmd)}</Section>
                <Section titre="En attente" sous="à affecter" nb={board.att.length} vide="Toutes les missions ont un chauffeur.">{board.att.map(carteAtt)}</Section>
              </div>
              <div className="px-3 py-2 flex flex-col gap-2 lg:overflow-y-auto min-h-0">
                <Section titre="Alertes" sous="missions déjà lancées" nb={board.alertes.length} vide="Aucune alerte.">{board.alertes.map(carteAlerte)}</Section>
              </div>
            </>}
          </section>

          {/* Liste des missions lancées */}
          <section className="rounded-2xl border bg-surface flex flex-col min-h-0 min-w-0">
            <header className="px-3 pt-3 pb-2 flex flex-col gap-2">
              <b className="text-[16px] text-ink">Missions</b>
              <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="Plaque, client, adresse, n° de fiche…" aria-label="Chercher une mission"
                className="min-h-[44px] rounded-xl border border-stone-300 bg-stone-50 px-3 text-stone-900" />
              <div className="flex gap-1.5 flex-wrap">
                {([['cours', `En cours · ${board?.lances.length ?? 0}`], ['rdv', 'Rendez-vous'], ['vhu', 'VHU'], ['parked', 'À relivrer'], ['all', 'Toutes']] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setFiltre(k)}
                    className={`min-h-[40px] px-3.5 rounded-full border font-semibold text-sm ${filtre === k ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-900 border-stone-200'}`}>{l}</button>
                ))}
                <Link href="/missions-terminees" className="min-h-[40px] px-3.5 rounded-full border border-stone-200 bg-white text-stone-900 font-semibold text-sm inline-flex items-center">Terminées ↗</Link>
              </div>
            </header>
            <div className="overflow-auto min-h-0 px-1">
              {!liste ? <p className="px-3 py-2 text-stone-500">Chargement…</p> : liste.length === 0 ? <p className="px-3 py-2 text-stone-500">{q ? 'Aucune mission ne correspond.' : filtre === 'cours' ? 'Aucune mission lancée pour l\'instant.' : 'Rien dans cette vue.'}</p> : (
                <table className="w-full min-w-[520px] text-[13.5px]">
                  <thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-stone-500"><th className="px-2 py-2">État</th><th className="px-2 py-2">Mission</th><th className="px-2 py-2">Trajet</th><th className="px-2 py-2">Chauffeur</th></tr></thead>
                  <tbody>
                    {liste.map(m => {
                      const e = etat(m)
                      return (
                        <tr key={m.id} className="border-t border-stone-200 hover:bg-stone-50 cursor-pointer align-top" onClick={() => { window.location.href = `/dispatch/${m.id}?fiche=1` }}>
                          <td className="px-2 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[12px] font-bold whitespace-nowrap ${e.cls}`}>{e.txt}</span>
                            {m.status === 'assigned' && m.assigned_at && <div className={`mt-1 text-[12.5px] font-bold tabular-nums ${minutesDepuis(m.assigned_at, now) >= 10 ? 'text-red-800' : 'text-amber-800'}`}>{duree(minutesDepuis(m.assigned_at, now))}</div>}
                            {m.intervention_date && new Date(m.intervention_date).getTime() > now && <div className="mt-1 text-[12.5px] text-stone-600">{new Date(m.intervention_date).toLocaleString('fr-BE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })}</div>}
                          </td>
                          <td className="px-2 py-2"><div className="flex gap-1.5 items-center flex-wrap"><Source m={m} sources={sources} /><span className="px-1.5 py-0.5 rounded-md bg-stone-100 text-stone-800 text-[11.5px] font-bold">{typeCourt(m)}</span></div>
                            <div className="mt-1 flex gap-1.5 items-center flex-wrap"><Plaque m={m} /><span className="text-stone-600">{vehicule(m)}</span></div></td>
                          <td className="px-2 py-2 text-stone-800 max-w-[420px]"><div className="truncate">{court(m.incident_address) || m.incident_city || '—'}</div>{(m.destination_name || m.destination_address) && <div className="text-stone-500 truncate">→ {court(m.destination_name || m.destination_address)}</div>}{m.incident_description && <div className="text-stone-500 text-[12.5px] line-clamp-1" title={m.incident_description}>{m.incident_description}</div>}</td>
                          <td className="px-2 py-2 text-stone-900">{m.assigned_user?.name || <span className="text-stone-400">—</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>

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
