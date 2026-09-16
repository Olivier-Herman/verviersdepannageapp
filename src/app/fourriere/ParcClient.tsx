'use client'
// src/app/fourriere/ParcClient.tsx
//
// « PARC » — refonte Fourrière, temps 1 (16/09/2026, artefact 3A6toUwGRKP7EgEtKGLKJF),
// pilote Olivier + Jona (flag fourriere_v2). Un véhicule = une FRISE
// (Entrée → Documents → Gardiennage → Sortie), une PROCHAINE ACTION, et QUI A LA
// MAIN : À nous · Robot · Chez eux (policier, Parquet, Domaine, client) · En veille.
// Liste / Plan / Scanner / Non localisés sont des VUES du même parc (liens vers
// les écrans existants, intacts). Décisions Olivier 16/09 : tout est « au cas par
// cas » → chaque carte porte ses propres boutons, aucune action de masse.
// Hypothèses réversibles : legacy = « à qualifier », Transit = zone comme les
// autres, > 60 j = badge seulement, restitution = flux actuel (QR / chauffeur).

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import OfficerAutocomplete from '@/components/missions/OfficerAutocomplete'
import VehicleFicheSheet from './VehicleFicheSheet'
import TabLegend from '@/components/ui/TabLegend'

interface V {
  id: string; mission_number: number | null; external_id: string | null; dossier_number: string | null
  source: string | null; status: string; mission_type: string | null
  plate: string | null; vin: string | null; brand: string | null; model: string | null
  zone: string | null; zone_label: string | null; row: number | null; slot: number | null
  entered_at: string | null; nights: number; regime: string; storage_htva: number; storage_note: string
  client_name: string | null; officer_name: string | null; officer_partner_id: number | null; police_zone: string | null; pv: string | null
  motif: string | null; motif_code: string | null
  requisitoire_ok: boolean; requisitoire_at: string | null; requisitoire_reminders: number; requisitoire_last_reminder_at: string | null; requisitoire_stop: boolean
  levee_date: string | null; levee_type: string | null; levee_payer: string | null
  domaine_remise_date: string | null; domaine_enlevement_date: string | null
  avp_asked_at: string | null; avp_asked_count: number; abandon_at: string | null
  parquet: { state: string; billed_to_date: string | null; ef_number: string | null; paused: boolean; recipient: string } | null
  destruction: { id: string; status: string | null } | null
  redelivery: { status: string; at: string | null } | null
  redelivery_address: string | null; key_location: string | null
  unlocated: boolean; odoo_vehicle_id: number | null
}

const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmt = (v?: string | null) => v ? new Date(v).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit' }) : '—'
const fmtY = (v?: string | null) => v ? new Date(v).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const daysSince = (v?: string | null) => v ? Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 86400000)) : null

// Familles de sources (pastilles). Le catalogue reste la vérité des libellés ; ici on regroupe pour filtrer.
const FAMILY: { key: string; label: string; test: (s: string) => boolean }[] = [
  { key: 'saisie',     label: 'Saisie',     test: s => s === 'police_saisie' },
  { key: 'accident',   label: 'Accident',   test: s => s === 'police_accident' },
  { key: 'avp',        label: 'AVP',        test: s => s === 'police_avp' },
  { key: 'snc',        label: 'SNC',        test: s => s === 'police_snc' || s === 'sia_couvert' },
  { key: 'mg',         label: 'Mal garée',  test: s => s === 'police_mg' || s === 'police_mal_garee' },
  { key: 'rodeo',      label: 'Rodéo',      test: s => s === 'police_rodeo' },
  { key: 'assistance', label: 'Assistance', test: s => /^(kaze|vab|touring|tgr_touring|ethias|mondial|allianz|axa|pv_assistance|eurocross|ima)/.test(s) },
  { key: 'legacy',     label: 'Legacy',     test: s => /^legacy/.test(s) },
]
const familyOf = (s: string | null) => FAMILY.find(f => f.test(String(s || '').toLowerCase()))?.key || 'autre'
const SOURCE_LABEL: Record<string, string> = { police_saisie: 'Saisie', police_accident: 'Accident', police_avp: 'AVP', police_snc: 'Siabis non couvert', sia_couvert: 'Siabis couvert', police_mg: 'Mal garée', police_mal_garee: 'Mal garée', police_rodeo: 'Rodéo', legacy_odoo: 'Legacy Odoo', legacy_towsoft_migration: 'Legacy TowSoft', gardiennage: 'Gardiennage', fourriere_parc: 'Parc' }
const srcLabel = (s: string | null) => SOURCE_LABEL[String(s || '')] || (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—')

// ── Lecture d'un véhicule ────────────────────────────────────────────────────
type Who = 'nous' | 'robot' | 'eux' | 'veille'
type StepState = 'done' | 'now' | 'todo' | 'bad' | 'wait'
interface Step { key: string; label: string; state: StepState; note?: string }
interface Reading {
  who: Who; headline: string; detail?: string
  primary?: { label: string; kind: 'place' | 'locate' | 'officer' | 'relance' | 'qualify' | 'destruction' | 'restitute' | 'sell' | 'link' | 'fiche'; href?: string; tone?: 'brand' | 'ghost' | 'sky' }
  steps: Step[]
}

function readVehicle(v: V): Reading {
  const src = String(v.source || '').toLowerCase()
  const fam = familyOf(src)
  const legacy = fam === 'legacy' || !src
  const saisie = fam === 'saisie'
  const mg = fam === 'mg'
  const leveeFJ = !!v.levee_date && v.levee_payer === 'frais_justice' && v.levee_type !== 'temporaire'
  const leveeClient = !!v.levee_date && v.levee_type !== 'temporaire' && !leveeFJ
  const docsOk = legacy ? false : saisie ? v.requisitoire_ok : true
  const gardWho: 'parquet' | 'client' | 'assistance' = saisie && !leveeClient ? 'parquet' : fam === 'assistance' || src === 'sia_couvert' ? 'assistance' : 'client'
  const exitKnown = !!v.destruction || !!v.domaine_remise_date || !!v.redelivery || !!v.abandon_at
  const steps: Step[] = [
    { key: 'in', label: 'Entrée', state: v.unlocated ? 'bad' : (v.zone ? 'done' : 'now'), note: v.unlocated ? 'non localisé' : v.zone ? `${fmt(v.entered_at)} · ${v.zone_label || v.zone}${v.row != null ? ` R${v.row}` : ''}` : 'à placer' },
    { key: 'doc', label: 'Documents', state: legacy ? 'bad' : saisie ? (v.requisitoire_ok ? 'done' : 'bad') : 'done', note: legacy ? 'à qualifier' : saisie ? (v.requisitoire_ok ? `réquisitoire${v.levee_date ? ' · levée' : ''}` : 'réquisitoire manquant') : (v.pv ? `PV ${v.pv}` : mg && v.avp_asked_at ? '60 j · abandon demandé' : (v.motif || 'ok')) },
    { key: 'gard', label: 'Gardiennage', state: !docsOk ? 'todo' : v.parquet ? (v.parquet.paused ? 'wait' : ['ef_envoye', 'accepte', 'justinvoice', 'liquide', 'facture', 'gardiennage_recurrent'].includes(v.parquet.state) ? 'done' : 'now') : 'now', note: !docsOk ? (gardWho === 'parquet' ? 'Parquet · bloqué' : undefined) : v.parquet ? `Parquet · ${v.parquet.ef_number ? v.parquet.ef_number : v.parquet.state}` : `${gardWho === 'assistance' ? 'assisteur' : 'client'} · ${v.nights} nuit${v.nights > 1 ? 's' : ''}` },
    { key: 'out', label: 'Sortie', state: exitKnown ? 'now' : 'todo', note: v.destruction ? 'destruction' : v.domaine_remise_date ? `Domaine ${fmt(v.domaine_remise_date)}` : v.redelivery ? `relivraison ${fmt(v.redelivery.at)}` : v.abandon_at ? 'abandon signé' : leveeFJ || leveeClient ? 'restitution attendue' : undefined },
  ]
  const base = { steps }

  if (v.unlocated) return { ...base, who: 'nous', headline: 'Introuvable au dernier inventaire', detail: 'Retrouve-le au scanner, ou déclare-le sorti si le véhicule n\'est plus là.', primary: { label: 'Localiser', kind: 'locate', href: '/fourriere/non-localises', tone: 'brand' } }
  if (!v.zone || v.row == null) return { ...base, who: 'nous', headline: !v.zone ? 'Arrivé — à placer' : `En ${v.zone_label || v.zone} — rangée à définir`, detail: 'La zone proposée vient de la source ; choisis la rangée sur le plan.', primary: { label: 'Placer', kind: 'place', href: '/fourriere/plan', tone: 'brand' } }
  if (legacy) return { ...base, who: 'nous', headline: 'Fiche d\'avant VD Soft — à qualifier', detail: `Entré le ${fmtY(v.entered_at)} (${v.nights} nuits). Saisie, AVP, épave, ou déjà sorti ? Le choix se fait sur la fiche (source), le véhicule entre alors dans son circuit.`, primary: { label: 'Qualifier', kind: 'qualify', href: `/dispatch/${v.id}`, tone: 'brand' } }
  if (v.destruction) return { ...base, who: 'nous', headline: `Dossier de destruction ${v.destruction.status ? `· ${v.destruction.status}` : 'ouvert'}`, detail: 'Présentation, frais à la date de présentation, épaviste.', primary: { label: 'Ouvrir le dossier', kind: 'destruction', href: '/fourriere/destruction/dossiers', tone: 'ghost' } }
  if (v.domaine_remise_date) return { ...base, who: 'eux', headline: `Remis au Domaine le ${fmtY(v.domaine_remise_date)} — enlèvement attendu`, detail: v.domaine_enlevement_date ? `Enlèvement prévu le ${fmtY(v.domaine_enlevement_date)}.` : 'Date d\'enlèvement pas encore connue.', primary: { label: 'Domaine', kind: 'link', href: '/fourriere/domaine', tone: 'ghost' } }
  if (v.redelivery) return { ...base, who: 'veille', headline: `Relivraison programmée${v.redelivery.at ? ` le ${fmtY(v.redelivery.at)}` : ''}`, detail: v.redelivery_address ? `Vers ${v.redelivery_address}.` : undefined }
  if (v.abandon_at && !saisie) return { ...base, who: 'nous', headline: `Abandon signé le ${fmtY(v.abandon_at)} — épave ou vente ?`, detail: 'Le véhicule est à nous : destruction (dossier) ou mise en vente sur le site.', primary: { label: 'Mettre en vente', kind: 'sell', href: '/admin/ventes', tone: 'ghost' } }
  if (saisie) {
    if (!v.requisitoire_ok) {
      if (!v.officer_partner_id) return { ...base, who: 'nous', headline: 'Réquisitoire manquant — policier non identifié', detail: `${v.nights} nuits de gardiennage bloquées${v.officer_name ? ` · nom relevé : « ${v.officer_name} »` : ''}. Lie le policier (contact Odoo) ; le robot le relance ensuite, ou il se l'attribue via son portail.`, primary: { label: 'Identifier le policier', kind: 'officer', tone: 'brand' } }
      return { ...base, who: 'eux', headline: `Réquisitoire réclamé à ${v.officer_name || 'la police'}${v.requisitoire_reminders ? ` · ${v.requisitoire_reminders} rappel${v.requisitoire_reminders > 1 ? 's' : ''}` : ''}`, detail: `${v.requisitoire_last_reminder_at ? `Dernier rappel le ${fmtY(v.requisitoire_last_reminder_at)} · ` : ''}portail policier + rappel automatique à 7 j${v.requisitoire_stop ? ' (rappels stoppés)' : ''}.`, primary: { label: 'Relancer', kind: 'relance', tone: 'ghost' } }
    }
    if (leveeFJ || leveeClient) return { ...base, who: 'eux', headline: `Levée le ${fmtY(v.levee_date)} — restitution attendue`, detail: `${leveeFJ ? 'Frais de justice : états de frais au Parquet jusqu\'à la levée. ' : ''}Depuis, ${v.storage_note} à charge du client (${eur(v.storage_htva)} HTVA à ce jour). À la restitution : facture, paiement dans Odoo, clés contre paiement.`, primary: { label: 'Restituer', kind: 'restitute', href: `/qr/mission/${v.id}`, tone: 'ghost' } }
    if (v.parquet?.paused) return { ...base, who: 'veille', headline: 'Dossier Parquet en pause', detail: 'Le robot n\'établit rien tant qu\'il est en pause (États de frais).' }
    return { ...base, who: 'robot', headline: `Saisie — états de frais au Parquet${v.parquet?.ef_number ? ` (${v.parquet.ef_number}, ${v.parquet.state.replace('_', ' ')})` : v.parquet ? ' (dossier ouvert)' : ' (dossier à venir)'}`, detail: `${v.nights} nuits · le robot établit et envoie seul ; suivi dans Facturation → États de frais.` }
  }
  if (mg && v.nights >= 60) return v.avp_asked_at
    ? { ...base, who: 'robot', headline: `60 jours dépassés — confirmation d'abandon demandée au policier le ${fmtY(v.avp_asked_at)}${v.avp_asked_count > 1 ? ` (${v.avp_asked_count} fois)` : ''}`, detail: 'Dès le réquisitoire « abandon » reçu, la fiche bascule en AVP toute seule et entre dans le circuit destruction.' }
    : { ...base, who: 'nous', headline: `Mal garée depuis ${v.nights} jours — abandon à faire confirmer`, detail: 'Le robot demande la confirmation au policier lié ; sans policier lié, à toi.', primary: { label: 'Identifier le policier', kind: 'officer', tone: 'brand' } }
  if (fam === 'avp') return { ...base, who: 'nous', headline: 'Abandon (AVP) — destruction à lancer', detail: `${v.nights} nuits. Ouvre un dossier de destruction (présentation, épaviste) ou remets au Domaine.`, primary: { label: 'Sortie AVP', kind: 'destruction', href: '/fourriere/destruction', tone: 'brand' } }
  if (fam === 'accident' || fam === 'rodeo') return { ...base, who: 'eux', headline: `${srcLabel(v.source)} — en attente du propriétaire / de l'assurance`, detail: `${v.nights} nuits · ${v.storage_note} (${eur(v.storage_htva)} HTVA à ce jour). Restitution : QR de l'étiquette ou encaissement chauffeur.`, primary: { label: 'Restituer', kind: 'restitute', href: `/qr/mission/${v.id}`, tone: 'ghost' } }
  if (fam === 'snc') return { ...base, who: 'eux', headline: 'Siabis — en attente du client (dépôt)', detail: `${v.nights} nuits · ${v.storage_note} (${eur(v.storage_htva)} HTVA). Le client se présente au bureau : relivraison, abandon ou reprise par une assistance.`, primary: { label: 'Gérer', kind: 'fiche', tone: 'ghost' } }
  if (fam === 'assistance') return { ...base, who: 'eux', headline: `${srcLabel(v.source)} — en attente de la relivraison`, detail: `${v.nights} nuits${v.redelivery_address ? ` · vers ${v.redelivery_address}` : ' · adresse de relivraison à recevoir'}.`, primary: { label: 'Fiche', kind: 'fiche', tone: 'ghost' } }
  return { ...base, who: 'veille', headline: `${srcLabel(v.source)} — ${v.nights} nuits au parc`, detail: v.storage_note ? `${v.storage_note} (${eur(v.storage_htva)} HTVA).` : undefined, primary: { label: 'Fiche', kind: 'fiche', tone: 'ghost' } }
}

const WHO: Record<Who, { label: string; cls: string; dot: string }> = {
  nous:   { label: 'À nous',   cls: 'bg-amber-50 border-amber-300 text-amber-900',   dot: 'bg-amber-500' },
  robot:  { label: 'Robot',    cls: 'bg-violet-50 border-violet-300 text-violet-900', dot: 'bg-violet-500' },
  eux:    { label: 'Chez eux', cls: 'bg-sky-50 border-sky-300 text-sky-900',         dot: 'bg-sky-500' },
  veille: { label: 'En veille', cls: 'bg-slate-50 border-slate-200 text-slate-700',  dot: 'bg-slate-400' },
}
const TONE = { brand: 'bg-brand hover:bg-brand-hover text-white', ghost: 'bg-surface hover:bg-surface-hover border text-ink', sky: 'bg-sky-600 hover:bg-sky-700 text-white' }
const STEP: Record<StepState, { dot: string; text: string }> = {
  done: { dot: 'bg-green-500 border-green-500 text-white', text: 'text-ink' },
  now:  { dot: 'bg-amber-400 border-amber-400 text-white ring-4 ring-amber-100', text: 'text-ink font-bold' },
  wait: { dot: 'bg-sky-400 border-sky-400 text-white', text: 'text-ink' },
  todo: { dot: 'bg-surface border-slate-300 text-slate-300', text: 'text-ink-faint' },
  bad:  { dot: 'bg-red-500 border-red-500 text-white ring-4 ring-red-100', text: 'text-red-700 font-bold' },
}
function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex items-start overflow-x-auto pb-1">
      {steps.map((s, i) => { const c = STEP[s.state]; return (
        <li key={s.key} className="flex items-start min-w-[96px] flex-1">
          <div className="flex flex-col items-center w-full">
            <div className="flex items-center w-full">
              <div className={`h-0.5 flex-1 ${i === 0 ? 'bg-transparent' : steps[i - 1].state === 'done' ? 'bg-green-400' : 'bg-slate-200'}`} />
              <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] font-bold shrink-0 ${c.dot}`}>{s.state === 'done' ? '✓' : s.state === 'bad' ? '!' : s.state === 'now' ? '●' : s.state === 'wait' ? '…' : ''}</span>
              <div className={`h-0.5 flex-1 ${i === steps.length - 1 ? 'bg-transparent' : s.state === 'done' ? 'bg-green-400' : 'bg-slate-200'}`} />
            </div>
            <div className={`text-[11px] leading-tight text-center mt-1 ${c.text}`}>{s.label}</div>
            {s.note && <div className="text-[10px] text-ink-faint text-center leading-tight mt-0.5 max-w-[140px] truncate" title={s.note}>{s.note}</div>}
          </div>
        </li>) })}
    </ol>
  )
}

type Filter = 'all' | Who
export default function ParcClient({ userRole, userName, userEmail, userModules }: { userRole: string; userName: string; userEmail?: string | null; userModules: string[] }) {
  const [rows, setRows] = useState<V[]>([])
  const [zones, setZones] = useState<{ key: string; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('nous')
  const [fam, setFam] = useState<string>('all')
  const [zone, setZone] = useState<string>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [fiche, setFiche] = useState<string | null>(null)
  const [officerFor, setOfficerFor] = useState<string | null>(null)
  const [officerName, setOfficerName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try { const r = await fetch('/api/fourriere/parc', { cache: 'no-store' }); const j = await r.json(); if (r.ok) { setRows(j.vehicles || []); setZones(j.zones || []) } else setMsg(`⚠ ${j.error || 'Erreur'}`) }
    catch { setMsg('⚠ Erreur réseau') } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 7000); return () => clearTimeout(t) }, [msg])

  const readings = useMemo(() => new Map(rows.map(v => [v.id, readVehicle(v)] as const)), [rows])
  const norm = (s: string) => s.toLowerCase().replace(/[\s.\-_/]/g, '')
  const scoped = useMemo(() => {
    const nq = norm(q)
    return rows.filter(v => (fam === 'all' || familyOf(v.source) === fam) && (zone === 'all' || v.zone === zone)
      && (!nq || norm([v.plate, v.vin, v.pv, v.dossier_number, v.officer_name, v.client_name, v.brand, v.model, String(v.mission_number ?? '')].filter(Boolean).join(' ')).includes(nq)))
  }, [rows, fam, zone, q])
  const counts = useMemo(() => { const c: Record<string, number> = { all: scoped.length }; for (const v of scoped) { const w = readings.get(v.id)!.who; c[w] = (c[w] || 0) + 1 } return c }, [scoped, readings])
  const rank: Record<Who, number> = { nous: 0, robot: 1, eux: 2, veille: 3 }
  const visible = useMemo(() => scoped.filter(v => filter === 'all' || readings.get(v.id)!.who === filter).sort((a, b) => (rank[readings.get(a.id)!.who] - rank[readings.get(b.id)!.who]) || (b.nights - a.nights)), [scoped, filter, readings])
  const famCounts = useMemo(() => Object.fromEntries(['all', ...FAMILY.map(f => f.key), 'autre'].map(k => [k, rows.filter(v => (k === 'all' || familyOf(v.source) === k) && (zone === 'all' || v.zone === zone)).length])), [rows, zone])
  const over60 = scoped.filter(v => v.nights >= 60).length

  const linkOfficer = async (v: V, pid: number) => {
    setBusy(v.id)
    try { const r = await fetch(`/api/missions/${v.id}/officer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partner_id: pid }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur'); setMsg(`✓ ${v.plate} : policier ${j.officer_name || ''} lié${j.email ? ` (${j.email})` : ' — contact sans email'}`); setOfficerFor(null); setOfficerName(''); await load() }
    catch (e: any) { setMsg(`⚠ ${e.message}`) } finally { setBusy(null) }
  }
  const relance = async (v: V) => {
    setBusy(v.id)
    try {
      const r = v.officer_partner_id
        ? await fetch('/api/fourriere/relance-requisitoire/officer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partner_id: v.officer_partner_id }) })
        : await fetch(`/api/missions/${v.id}/requisitoire-relance`, { method: 'POST' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur')
      setMsg(`✓ Relance envoyée${j.email ? ` à ${j.email}` : ''}${j.count > 1 ? ` (${j.count} véhicules)` : ''}`); await load()
    } catch (e: any) { setMsg(`⚠ ${e.message}`) } finally { setBusy(null) }
  }
  const printLabel = async (v: V) => {
    setBusy(v.id)
    try { const r = await fetch(`/api/missions/${v.id}/reprint-label`, { method: 'POST' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Impression impossible'); setMsg(`✓ Étiquette ${v.plate} envoyée à l'imprimante`) }
    catch (e: any) { setMsg(`⚠ ${e.message}`) } finally { setBusy(null) }
  }
  const primary = (v: V, r: Reading) => {
    const p = r.primary; if (!p) return
    if (p.kind === 'officer') { setOfficerFor(officerFor === v.id ? null : v.id); setOfficerName(v.officer_name || '') }
    else if (p.kind === 'relance') relance(v)
    else if (p.kind === 'fiche') setFiche(v.id)
    else if (p.href) window.location.href = p.href
  }

  const TABS: { key: Filter; label: string; dot?: string; help: string }[] = [
    { key: 'nous', label: 'À nous', dot: WHO.nous.dot, help: 'placer, localiser, identifier le policier, qualifier, sortir : un bouton' },
    { key: 'robot', label: 'Robot', dot: WHO.robot.dot, help: 'relances, états de frais, bascule AVP à 60 j : rien à faire' },
    { key: 'eux', label: 'Chez eux', dot: WHO.eux.dot, help: 'on attend un policier, le Parquet, le Domaine, une assistance ou le propriétaire' },
    { key: 'veille', label: 'En veille', dot: WHO.veille.dot, help: 'rien avant une date connue (relivraison programmée, dossier en pause)' },
    { key: 'all', label: 'Tous', help: 'tout le parc' },
  ]

  return (
    <AppShell title="Parc" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <div className="px-3 lg:px-6 py-5 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-ink text-2xl font-bold leading-tight">🚓 Parc</h1>
            <p className="text-ink-muted text-sm mt-0.5"><b className="text-ink">{rows.length}</b> véhicules · <b className="text-ink">{counts.nous || 0}</b> nous attend{(counts.nous || 0) > 1 ? 'ent' : ''}{counts.eux ? ` · ${counts.eux} chez eux` : ''}{counts.robot ? ` · ${counts.robot} au robot` : ''}{over60 ? ` · ${over60} depuis plus de 60 j` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Plaque, VIN, PV, policier, client…" className="w-64 bg-surface-2 border rounded-xl pl-3 pr-8 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand" />
              {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">×</button>}
            </div>
            <button onClick={load} className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-sm text-ink-secondary" title="Rafraîchir">↻</button>
          </div>
        </div>

        {/* Vues du même parc */}
        <div className="inline-flex items-center gap-1 bg-surface-2 border rounded-xl p-1 text-sm">
          <span className="px-3 py-1.5 rounded-lg bg-surface text-ink font-semibold shadow-sm">Liste</span>
          <Link href="/fourriere/plan" className="px-3 py-1.5 rounded-lg text-ink-secondary hover:text-ink">Plan</Link>
          <Link href="/fourriere/inventaire" className="px-3 py-1.5 rounded-lg text-ink-secondary hover:text-ink">Scanner</Link>
          <Link href="/fourriere/non-localises" className="px-3 py-1.5 rounded-lg text-ink-secondary hover:text-ink">Non localisés{rows.some(v => v.unlocated) ? ` · ${rows.filter(v => v.unlocated).length}` : ''}</Link>
          <Link href="/fourriere/recherche" className="px-3 py-1.5 rounded-lg text-ink-secondary hover:text-ink">Recherche avancée</Link>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setFilter(t.key)} title={t.help} className={`px-3 py-1.5 rounded-xl text-sm font-semibold border transition flex items-center gap-1.5 ${filter === t.key ? 'bg-ink text-surface border-ink' : 'bg-surface-2 text-ink-secondary hover:bg-surface-hover'}`}>
              {t.dot && <span className={`inline-block w-2 h-2 rounded-full ${t.dot}`} />}{t.label} <span className={filter === t.key ? 'opacity-80' : 'text-ink-faint'}>{counts[t.key] || 0}</span>
            </button>
          ))}
        </div>
        <TabLegend items={TABS.filter(t => t.dot).map(t => ({ dot: t.dot, label: t.label, text: t.help }))} />
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <button onClick={() => setFam('all')} className={`px-2.5 py-1 rounded-full border ${fam === 'all' ? 'bg-surface-2 text-ink border-strong font-semibold' : 'bg-surface text-ink-muted hover:text-ink'}`}>Toutes <span className="opacity-60">{famCounts.all}</span></button>
          {FAMILY.map(f => famCounts[f.key] ? <button key={f.key} onClick={() => setFam(f.key)} className={`px-2.5 py-1 rounded-full border ${fam === f.key ? 'bg-surface-2 text-ink border-strong font-semibold' : 'bg-surface text-ink-muted hover:text-ink'}`}>{f.label} <span className="opacity-60">{famCounts[f.key]}</span></button> : null)}
          {famCounts.autre ? <button onClick={() => setFam('autre')} className={`px-2.5 py-1 rounded-full border ${fam === 'autre' ? 'bg-surface-2 text-ink border-strong font-semibold' : 'bg-surface text-ink-muted hover:text-ink'}`}>Autres <span className="opacity-60">{famCounts.autre}</span></button> : null}
          <select value={zone} onChange={e => setZone(e.target.value)} className="ml-auto bg-surface-2 border rounded-full px-2.5 py-1 text-ink">
            <option value="all">Toutes les zones</option>
            {zones.map(z => <option key={z.key} value={z.key}>{z.label} · {rows.filter(v => v.zone === z.key).length}</option>)}
          </select>
        </div>

        {msg && <div className="text-sm px-4 py-2.5 rounded-xl bg-surface-2 border text-ink">{msg}</div>}

        {loading ? <div className="text-center py-16 text-ink-faint text-sm">Chargement du parc…</div>
          : visible.length === 0 ? (
            <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted"><p className="text-4xl mb-2">{filter === 'nous' ? '🎉' : '🚓'}</p><p className="font-medium text-ink">{filter === 'nous' ? 'Rien ne nous attend' : 'Aucun véhicule ici'}</p></div>
          ) : visible.map(v => {
            const r = readings.get(v.id)!; const who = WHO[r.who]; const isOpen = open.has(v.id); const p = r.primary
            return (
              <div key={v.id} className="bg-surface border rounded-2xl overflow-hidden">
                <div className="px-4 pt-3.5 pb-3 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-black text-ink text-xl tracking-wide">{v.plate || v.vin || '—'}</span>
                      <span className="text-ink-secondary text-sm">{[v.brand, v.model].filter(Boolean).join(' ') || '—'}</span>
                      {v.mission_number && <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface-2 border text-ink-muted">#{v.mission_number}</span>}
                      <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-ink text-surface" title="Zone du parc">{v.zone_label || v.zone || '?'}{v.row != null ? ` · R${v.row}` : ''}{v.slot != null ? `/${v.slot}` : ''}</span>
                      {v.nights >= 60 && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-300">{v.nights} j</span>}
                    </div>
                    <div className="text-ink-muted text-xs mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
                      <span>{srcLabel(v.source)}{v.motif ? ` · ${v.motif}` : ''}</span>
                      {v.pv && <span>PV <span className="font-mono">{v.pv}</span></span>}
                      <span>entrée {fmt(v.entered_at)}{v.nights < 60 ? ` · ${v.nights} j` : ''}</span>
                      {v.officer_name ? <span>🚔 {v.officer_name}{v.police_zone ? ` (${v.police_zone})` : ''}</span> : v.police_zone ? <span>🚔 {v.police_zone} · policier non identifié</span> : null}
                      {v.client_name && <span>👤 {v.client_name}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right tabular-nums"><div className="font-bold text-ink text-lg leading-tight">{v.storage_htva > 0 ? eur(v.storage_htva) : '—'}</div><div className="text-[10.5px] text-ink-faint">{v.storage_htva > 0 ? 'gardiennage HTVA à ce jour' : v.storage_note || ''}</div></div>
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border ${who.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${who.dot}`} />{who.label}</span>
                  </div>
                </div>
                <div className="px-4 pb-3"><Timeline steps={r.steps} /></div>
                <div className={`mx-4 mb-3 rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-3 flex-wrap ${who.cls}`}>
                  <div className="min-w-0"><div className="text-sm font-bold">{r.headline}</div>{r.detail && <div className="text-xs opacity-80 mt-0.5">{r.detail}</div>}</div>
                  {p && <button disabled={busy === v.id} onClick={() => primary(v, r)} className={`px-3.5 py-2 rounded-xl text-sm font-bold shrink-0 disabled:opacity-50 ${TONE[p.tone || 'brand']}`}>{busy === v.id ? '…' : p.label}{p.href && p.kind !== 'officer' ? ' ↗' : ''}</button>}
                </div>
                {officerFor === v.id && (
                  <div className="mx-4 mb-3 p-3 bg-surface-2 border rounded-xl max-w-md">
                    <OfficerAutocomplete allZones label="Policier (contact de la zone)" value={officerName} companyId={null} onChange={setOfficerName} onPickPartner={pid => { if (pid != null) linkOfficer(v, pid) }} />
                  </div>
                )}
                <div className="px-4 py-2 border-t bg-surface-2/60 flex items-center gap-3 text-xs">
                  <button onClick={() => setOpen(s => { const n = new Set(s); n.has(v.id) ? n.delete(v.id) : n.add(v.id); return n })} className="text-ink-secondary hover:text-ink font-semibold">{isOpen ? '▾' : '▸'} Détails</button>
                  <span className="ml-auto flex items-center gap-3">
                    <button disabled={busy === v.id} onClick={() => printLabel(v)} className="text-ink-secondary hover:text-ink">🖨 Étiquette</button>
                    <button onClick={() => setFiche(v.id)} className="text-ink-secondary hover:text-ink">Fiche véhicule</button>
                    <Link href={`/dispatch/dossier/${v.id}`} className="text-ink-secondary hover:text-ink">Vue dossier ↗</Link>
                  </span>
                </div>
                {isOpen && (
                  <div className="px-4 pb-4 pt-3 border-t bg-surface-2/30 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs text-ink-secondary">
                    <div><b className="text-ink">Véhicule</b> · {[v.brand, v.model].filter(Boolean).join(' ') || '—'}{v.vin ? ` · VIN ${v.vin}` : ''}</div>
                    <div><b className="text-ink">Position</b> · {v.zone_label || v.zone || '—'}{v.row != null ? ` · rangée ${v.row}` : ''}{v.slot != null ? ` · place ${v.slot}` : ''}{v.key_location ? ` · clés : ${v.key_location}` : ''}</div>
                    <div><b className="text-ink">Entrée</b> · {fmtY(v.entered_at)} · {v.nights} nuit{v.nights > 1 ? 's' : ''} · régime {v.regime}</div>
                    <div><b className="text-ink">Gardiennage</b> · {v.storage_note || '—'}{v.storage_htva > 0 ? ` = ${eur(v.storage_htva)} HTVA` : ''}</div>
                    {(v.pv || v.dossier_number) && <div><b className="text-ink">PV / dossier</b> · {v.pv || v.dossier_number}{v.motif ? ` · ${v.motif}` : ''}</div>}
                    {(v.officer_name || v.police_zone) && <div><b className="text-ink">Police</b> · {v.officer_name || 'policier non identifié'}{v.police_zone ? ` · ${v.police_zone}` : ''}{v.officer_partner_id ? ' · contact lié' : ' · pas de contact Odoo'}</div>}
                    {familyOf(v.source) === 'saisie' && <div><b className="text-ink">Réquisitoire</b> · {v.requisitoire_ok ? `reçu le ${fmtY(v.requisitoire_at)}` : `manquant${v.requisitoire_reminders ? ` · ${v.requisitoire_reminders} rappel(s), dernier ${fmtY(v.requisitoire_last_reminder_at)}` : ''}`}{v.levee_date ? ` · levée ${fmtY(v.levee_date)} (${v.levee_payer === 'frais_justice' ? 'frais de justice' : v.levee_payer === 'client' ? 'client' : v.levee_type || ''})` : ''}</div>}
                    {v.parquet && <div><b className="text-ink">Parquet</b> · {v.parquet.ef_number || 'dossier ouvert'} · {v.parquet.state.replace('_', ' ')}{v.parquet.billed_to_date ? ` · facturé jusqu'au ${fmtY(v.parquet.billed_to_date)}` : ''}{v.parquet.paused ? ' · en pause' : ''}</div>}
                    {v.avp_asked_at && <div><b className="text-ink">Abandon (60 j)</b> · confirmation demandée le {fmtY(v.avp_asked_at)}{v.avp_asked_count > 1 ? ` (${v.avp_asked_count}×)` : ''}</div>}
                    {v.abandon_at && <div><b className="text-ink">Abandon signé</b> · {fmtY(v.abandon_at)}</div>}
                    {v.domaine_remise_date && <div><b className="text-ink">Domaine</b> · Date IN {fmtY(v.domaine_remise_date)}{v.domaine_enlevement_date ? ` · enlèvement ${fmtY(v.domaine_enlevement_date)}` : ''}</div>}
                    {v.destruction && <div><b className="text-ink">Destruction</b> · dossier {v.destruction.status || 'ouvert'}</div>}
                    {v.redelivery_address && <div><b className="text-ink">Relivraison</b> · {v.redelivery_address}{v.redelivery?.at ? ` · ${fmtY(v.redelivery.at)}` : ''}</div>}
                    {v.client_name && <div><b className="text-ink">Client</b> · {v.client_name}</div>}
                  </div>
                )}
              </div>
            )
          })}
      </div>
      {fiche && <VehicleFicheSheet missionId={fiche} onClose={() => { setFiche(null); load() }} userModules={userModules} userRole={userRole} />}
    </AppShell>
  )
}
