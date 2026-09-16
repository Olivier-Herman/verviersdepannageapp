'use client'
// src/app/facturation/dossiers/AFacturerClient.tsx
//
// « À FACTURER » — refonte 16/09/2026 (artefact HunVFDnNSQSBiK9VMhmJdu, validé),
// pilote Olivier + Jona (flag facturation_v2). Même lecture que les états de
// frais : une FRISE par dossier (Intervention → Clôture → Montant → Facture →
// Payé), une seule PROCHAINE ACTION, et un badge qui dit QUI A LA MAIN :
//   À nous · Robot (auto-facturation, heure annoncée) · Chez eux (assisteur :
//   COMEX, Hexalite, Comet, Kaze, Parquet, Domaine) · Client (facture émise,
//   paiement suivi dans Odoo) · En cours (parc / relivraison).
// Décisions Olivier 16/09 : le robot ne facture que les missions sèches DSP/REM
// des assisteurs configurés ; combinés, transports, particuliers, garages =
// manuel ; l'encaissement bureau se fait dans Odoo (jamais de bouton Encaisser).
// La mécanique de données (tarification progressive, éligibilité robot, COMEX,
// modale Facturer) est celle de DossiersClient — inchangée.

import { useEffect, useMemo, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Dossier, DossierLeg } from '@/lib/dossier/build'
import BillingModal, { cleanRef, isLegBilled, canPickLeg } from '@/components/dossier/BillingModal'

const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const TVA = 1.21
const eurTvac = (n: number) => eur(Math.round(n * TVA * 100) / 100)
const fmtDay = (v: string | null | undefined) => v ? new Date(v).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit' }) : ''
const fmtDT  = (v: string | null | undefined) => v ? new Date(v).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
const fmtHM  = (v: string | null | undefined) => v ? new Date(v).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }) : ''
const daysSince = (v?: string | null) => v ? Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 86400000)) : null
const AUTO_MAX = 500

// ── Groupes assureur (mêmes règles que la liste par dossier) ─────────────────
interface SourceGroup { key: string; label: string; sources: string[] | null }
const GROUP_LABELS: Record<string, string> = { vab: 'VAB', kaze: 'Kaze · Ethias · P&V · IMA', mondial: 'Mondial', axa: 'AXA', touring: 'Touring' }
const buildGroups = (bg: Record<string, string[]>): SourceGroup[] => [{ key: 'all', label: 'Toutes (hors Touring)', sources: null }, ...Object.keys(GROUP_LABELS).map(k => ({ key: k, label: GROUP_LABELS[k], sources: bg[k] || [] }))]
const isTouringBilled = (d: Dossier) => /touring/i.test(String(d.billed_to.name || '')) || d.legs.some(l => /touring/i.test(String(l.billed_to_name || '')))
const inGroup = (d: Dossier, g: SourceGroup) => {
  const source = (d.source || '').toLowerCase()
  const isTransport = String(d.root_type || '').toLowerCase() === 'transport'
  // Groupe Touring = le circuit COMEX (source touring / TGR) et le Siabis couvert.
  // Un Siabis NON couvert facturé à Touring (client remis à la main, 16/09/2026,
  // 2JEM405) reste dans la liste générale : ce n'est pas un dossier COMEX.
  const touring = (source === 'touring' || source === 'tgr_touring' || (isTouringBilled(d) && source !== 'police_snc')) && !(source === 'touring' && isTransport)
  return g.sources === null ? !touring : g.key === 'touring' ? touring : !!source && g.sources.includes(source)
}

type AutoInfo = { status: string; eligibleAt?: string; reason?: string }
type ComexInfo = { verdict: string | null; montant: number | null; accepted_at: string | null; dossier: string | null }

const isOdoo = (l: DossierLeg) => (l.channel || 'odoo') === 'odoo'
const ready  = (d: Dossier) => d.legs.filter(l => isOdoo(l) && (canPickLeg(l) || (l.amount_unknown && !isLegBilled(l) && !l.nothing_to_bill)) && !(l.kind === 'gard' && l.open))
const isCircuitLegs = (d: Dossier) => d.legs.some(l => !isOdoo(l) && !isLegBilled(l) && !l.nothing_to_bill) && ready(d).length === 0
const isPending  = (d: Dossier) => !!d.light
const unknownLegs = (d: Dossier) => d.legs.filter(l => l.amount_unknown && !isLegBilled(l) && !l.nothing_to_bill)
const hasUnknown = (d: Dossier) => !d.light && unknownLegs(d).length > 0
const isDone = (d: Dossier) => !!d.cancelled || (!d.state.open && d.legs.every(l => isLegBilled(l) || !!l.nothing_to_bill || (l.amount_htva === 0 && !l.amount_unknown)))
const rest   = (d: Dossier) => d.totals.remaining
const remarks = (d: Dossier) => d.legs.flatMap(l => l.billing_remarks || [])
const alerts  = (d: Dossier) => d.legs.flatMap(l => l.alerts || [])

// ── Lecture du dossier : où en est-on, qui a la main, quelle est l'action ────
type Who = 'nous' | 'robot' | 'eux' | 'client' | 'veille' | 'fini'
type StepState = 'done' | 'now' | 'todo' | 'bad' | 'wait'
interface Step { key: string; label: string; state: StepState; note?: string }
interface Reading {
  who: Who
  headline: string
  detail?: string
  primary?: { label: string; kind: 'bill' | 'bill_ready' | 'link' | 'dossier' | 'odoo' | 'verify'; href?: string; tone?: 'brand' | 'ghost' | 'sky' }
  steps: Step[]
}

function readDossier(d: Dossier, ai: AutoInfo | undefined, comex: ComexInfo | undefined, autoRule: boolean, now: number): Reading {
  const done = isDone(d)
  const rd = ready(d)
  const inComex = !!comex && !comex.accepted_at && !done
  const circuit = isCircuitLegs(d) || inComex
  const unknown = hasUnknown(d)
  const pending = isPending(d)
  const remarksN = remarks(d).length
  const siabisOpen = alerts(d).some(a => /siabis/i.test(a))
  const autoEligible = !done && (ai ? (ai.status === 'eligible' || (ai.status === 'waiting' && !!ai.eligibleAt && new Date(ai.eligibleAt).getTime() <= now))
    : (!d.state.open && rd.length > 0 && autoRule && rest(d) <= AUTO_MAX))
  const autoWaiting = !done && ai?.status === 'waiting' && !!ai.eligibleAt && new Date(ai.eligibleAt).getTime() > now
  const invoices = d.invoices || []
  const lastEnded = d.legs.map(l => l.ended_at).filter(Boolean).sort().pop() || null
  const mainInv = invoices[0]

  const steps: Step[] = [
    { key: 'int', label: 'Intervention', state: 'done', note: fmtDay(d.received_at) },
    { key: 'clo', label: 'Clôture', state: d.state.open ? 'now' : 'done', note: d.state.open ? (d.state.reason || 'en cours') : fmtDT(lastEnded) },
    { key: 'amt', label: 'Montant', state: pending ? 'wait' : unknown ? 'bad' : 'done', note: pending ? 'calcul…' : unknown ? 'à calculer' : (rest(d) > 0 || invoices.length ? eur(rest(d) > 0 ? rest(d) : (invoices.reduce((s, i) => s + i.amount, 0))) + ' HTVA' : '0 €') },
    { key: 'fac', label: 'Facture', state: done && invoices.length ? 'done' : done ? 'done' : circuit ? 'wait' : (rd.length ? 'now' : 'todo'), note: done && invoices.length ? cleanRef(mainInv.number) : done ? (d.cancelled ? 'annulé' : 'rien à facturer') : circuit ? (inComex ? 'COMEX' : d.parquet ? 'Parquet' : 'Domaine') : undefined },
    { key: 'pay', label: 'Payé', state: done && invoices.length ? 'now' : 'todo', note: done && invoices.length ? 'suivi dans Odoo' : d.totals.collected > 0 ? `${eur(d.totals.collected)} sur place` : undefined },
  ]
  const base = { steps }

  if (d.cancelled) return { ...base, who: 'fini', headline: 'Dossier annulé' }
  if (done) {
    if (invoices.length) return { ...base, who: 'client', headline: `Facture ${invoices.map(i => cleanRef(i.number)).join(', ')} émise${mainInv.at ? ` le ${fmtDay(mainInv.at)}` : ''}`, detail: `${eur(invoices.reduce((s, i) => s + i.amount, 0))} HTVA · ${invoices.map(i => i.client).filter(Boolean).join(', ')} · le paiement se suit dans Odoo.`, primary: mainInv.url ? { label: 'Ouvrir dans Odoo', kind: 'odoo', href: mainInv.url, tone: 'ghost' } : undefined }
    return { ...base, who: 'fini', headline: 'Rien à facturer', detail: d.legs.map(l => l.nothing_to_bill).filter(Boolean)[0] || undefined }
  }
  if (inComex) return { ...base, who: 'eux', headline: `Chez Touring (COMEX BKO) — ${comex!.verdict === 'verify' ? 'à vérifier' : 'en attente de validation'}`, detail: `Dossier ${comex!.dossier || '—'}${comex!.montant != null ? ` · montant Touring ${eur(Number(comex!.montant))}` : ''}. Pas de facture avant l'accord Touring.`, primary: { label: 'Ouvrir COMEX', kind: 'link', href: '/touring-comex', tone: 'ghost' } }
  if (isCircuitLegs(d)) {
    const ef = d.parquet?.efs?.length ? d.parquet.efs[d.parquet.efs.length - 1] : null
    return d.parquet
      ? { ...base, who: 'eux', headline: ef ? `Parquet — état de frais n°${ef.numero ?? ''} ${ef.status === 'refuse' ? 'refusé' : ef.liquide_at ? 'liquidé' : 'en attente'}` : 'Parquet — état de frais à venir', detail: 'Circuit états de frais : rien ne se facture d\'ici.', primary: { label: 'États de frais', kind: 'link', href: '/fourriere/saisies', tone: 'ghost' } }
      : { ...base, who: 'eux', headline: 'Domaine — relevé trimestriel', detail: 'Facturé via le module Domaine.', primary: { label: 'Domaine', kind: 'link', href: '/fourriere/domaine', tone: 'ghost' } }
  }
  if (ai?.status === 'hexalite') return { ...base, who: 'nous', headline: 'Dans Hexalite — à clôturer via Clôture Allianz', detail: 'La facture part par la clôture Hexalite, pas d\'ici.', primary: { label: 'Clôture Allianz', kind: 'link', href: '/facturation/allianz', tone: 'sky' } }
  if (d.state.open) {
    const gardOpen = d.legs.find(l => l.kind === 'gard' && l.open)
    const relOpen  = d.legs.find(l => l.kind === 'rel' && l.open)
    const why = relOpen ? `Relivraison ${relOpen.letter} en cours` : gardOpen ? `Véhicule au parc (${gardOpen.subtitle || 'gardiennage'} · ${gardOpen.days ?? 0} j)` : (d.state.reason || 'Dossier en cours')
    return { ...base, who: 'veille', headline: `${why} — on facture à la clôture`, detail: rd.length ? `Groupe${rd.length > 1 ? 's' : ''} ${rd.map(l => l.letter).join(', ')} déjà prêt${rd.length > 1 ? 's' : ''} : tu peux facturer maintenant, le reste partira à la sortie.` : 'Tout part ensemble quand le dernier groupe est clos (combiné = manuel).', primary: rd.length ? { label: 'Facturer les groupes prêts', kind: 'bill_ready', tone: 'ghost' } : undefined }
  }
  if (unknown) {
    const why = unknownLegs(d).map(l => l.amount_note || 'raison inconnue')[0]
    const transient = /réessaie|robot|passager|indisponible|quota/i.test(why)
    return transient
      ? { ...base, who: 'robot', headline: 'Km à calculer — le robot réessaie toutes les 10 min', detail: why }
      : { ...base, who: 'nous', headline: `Montant impossible : ${why}`, detail: 'Corrige la fiche (adresse, tarif) ; le montant se recalcule seul, puis la facturation suit.', primary: { label: 'Corriger la fiche', kind: 'dossier', tone: 'brand' } }
  }
  if (siabisOpen) return { ...base, who: 'nous', headline: 'Siabis : couvert ou non couvert à trancher', detail: alerts(d).find(a => /siabis/i.test(a)), primary: { label: 'Trancher sur le dossier', kind: 'dossier', tone: 'brand' } }
  if (autoEligible) return { ...base, who: 'robot', headline: 'Le robot facture au prochain passage', detail: `${eur(rest(d))} HTVA → ${d.billed_to.name || '—'}${remarksN ? ` · ${remarksN} remarque(s) de facturation à lire` : ''}.`, primary: { label: 'Facturer maintenant', kind: 'bill', tone: 'ghost' } }
  if (autoWaiting) return { ...base, who: 'robot', headline: `Le robot facture à ${fmtHM(ai!.eligibleAt)}`, detail: `${eur(rest(d))} HTVA → ${d.billed_to.name || '—'} · délai après clôture.${remarksN ? ` ${remarksN} remarque(s) à lire.` : ''}`, primary: { label: 'Facturer maintenant', kind: 'bill', tone: 'ghost' } }
  if (rd.length) {
    // Payeur inconnu (Siabis non couvert avant décision, particulier sans fiche client) : on nomme la personne sur place, sinon on le dit.
    const clients = Array.from(new Set(rd.map(l => l.billed_to_name || d.billed_to.name || d.client.name || 'client à préciser')))
    const why = ai?.reason ? ` · hors robot : ${ai.reason}` : ''
    return { ...base, who: 'nous', headline: `Facturer à ${clients.join(' + ')}`, detail: `${d.legs.length > 1 ? `${rd.length} groupe(s) prêt(s) sur ${d.legs.length} · ` : ''}${eur(rest(d))} HTVA · ${eurTvac(rest(d))} TVAC${d.totals.collected > 0 ? ` · ${eur(d.totals.collected)} déjà encaissé sur place` : ''}${remarksN ? ` · ${remarksN} remarque(s) à lire` : ''}${why}`, primary: { label: 'Facturer', kind: 'bill', tone: 'brand' } }
  }
  // Rien de prêt et rien d'ouvert : on dit POURQUOI, groupe par groupe.
  const why = d.legs.map(l => `${l.letter} : ${isLegBilled(l) ? 'facturé' : l.nothing_to_bill ? l.nothing_to_bill : l.amount_htva === 0 ? '0 €' : l.status_label}`).join(' · ')
  return { ...base, who: 'veille', headline: pending ? 'Montant en cours de calcul' : 'Rien à facturer pour l\'instant', detail: [ai?.reason, why].filter(Boolean).join(' — ') }
}

const WHO: Record<Who, { label: string; cls: string; dot: string }> = {
  nous:   { label: 'À nous',   cls: 'bg-amber-50 border-amber-300 text-amber-900',   dot: 'bg-amber-500' },
  robot:  { label: 'Robot',    cls: 'bg-violet-50 border-violet-300 text-violet-900', dot: 'bg-violet-500' },
  eux:    { label: 'Chez eux', cls: 'bg-sky-50 border-sky-300 text-sky-900',         dot: 'bg-sky-500' },
  client: { label: 'Client',   cls: 'bg-teal-50 border-teal-300 text-teal-900',      dot: 'bg-teal-500' },
  veille: { label: 'Pas prêt', cls: 'bg-slate-50 border-slate-200 text-slate-700',   dot: 'bg-slate-400' },
  fini:   { label: 'Terminé',  cls: 'bg-slate-50 border-slate-200 text-slate-500',   dot: 'bg-slate-300' },
}
const TONE = { brand: 'bg-brand hover:bg-brand-hover text-white', ghost: 'bg-surface hover:bg-surface-hover border text-ink', sky: 'bg-sky-600 hover:bg-sky-700 text-white' }
const STEP: Record<StepState, { dot: string; text: string; line: string }> = {
  done: { dot: 'bg-green-500 border-green-500 text-white', text: 'text-ink', line: 'bg-green-400' },
  now:  { dot: 'bg-amber-400 border-amber-400 text-white ring-4 ring-amber-100', text: 'text-ink font-bold', line: 'bg-slate-200' },
  wait: { dot: 'bg-sky-400 border-sky-400 text-white', text: 'text-ink', line: 'bg-slate-200' },
  todo: { dot: 'bg-surface border-slate-300 text-slate-300', text: 'text-ink-faint', line: 'bg-slate-200' },
  bad:  { dot: 'bg-red-500 border-red-500 text-white ring-4 ring-red-100', text: 'text-red-700 font-bold', line: 'bg-slate-200' },
}
function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex items-start overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const c = STEP[s.state]
        return (
          <li key={s.key} className="flex items-start min-w-[86px] flex-1">
            <div className="flex flex-col items-center w-full">
              <div className="flex items-center w-full">
                <div className={`h-0.5 flex-1 ${i === 0 ? 'bg-transparent' : steps[i - 1].state === 'done' ? STEP.done.line : 'bg-slate-200'}`} />
                <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] font-bold shrink-0 ${c.dot}`}>{s.state === 'done' ? '✓' : s.state === 'bad' ? '!' : s.state === 'now' ? '●' : s.state === 'wait' ? '…' : ''}</span>
                <div className={`h-0.5 flex-1 ${i === steps.length - 1 ? 'bg-transparent' : s.state === 'done' ? STEP.done.line : 'bg-slate-200'}`} />
              </div>
              <div className={`text-[11px] leading-tight text-center mt-1 ${c.text}`}>{s.label}</div>
              {s.note && <div className="text-[10px] text-ink-faint text-center leading-tight mt-0.5 max-w-[120px] truncate" title={s.note}>{s.note}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

type Filter = 'all' | Who
export default function AFacturerClient({ initial, autoById, comexById = {}, isSuperadmin, capped, billingGroups = {} }: {
  initial: Dossier[]; autoById: Record<string, boolean>; comexById?: Record<string, ComexInfo>; isSuperadmin: boolean; capped: boolean; billingGroups?: Record<string, string[]>
}) {
  const router = useRouter()
  const SOURCE_GROUPS = useMemo(() => buildGroups(billingGroups), [billingGroups])
  const [rows, setRows] = useState<Dossier[]>(initial)
  const [filter, setFilter] = useState<Filter>('nous')
  const [group, setGroupState] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [billing, setBilling] = useState<Dossier | null>(null)
  const [loadingBill, setLoadingBill] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [reportLinks, setReportLinks] = useState<{ label: string; url: string }[]>([])
  const [now, setNow] = useState(Date.now())
  const [showTools, setShowTools] = useState(false)
  const [autoElig, setAutoElig] = useState<{ eligible: number; waiting: number; hexalite?: number; delayHours: number; byMission?: Record<string, AutoInfo> } | null>(null)

  useEffect(() => { try { const g = localStorage.getItem('fact_group_filter'); if (g && SOURCE_GROUPS.some(x => x.key === g)) setGroupState(g) } catch {} }, [SOURCE_GROUPS])
  const setGroup = (k: string) => { setGroupState(k); try { localStorage.setItem('fact_group_filter', k) } catch {} }
  useEffect(() => {
    const load = () => fetch('/api/facturation/auto-eligible').then(r => r.ok ? r.json() : null).then(j => { if (j) setAutoElig(j) }).catch(() => {})
    load(); const t = setInterval(load, 60_000); return () => clearInterval(t)
  }, [])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t) }, [])
  useEffect(() => { if (!report) return; const t = setTimeout(() => { setReport(null); setReportLinks([]) }, 12_000); return () => clearTimeout(t) }, [report])

  const activeGroup = SOURCE_GROUPS.find(g => g.key === group) || SOURCE_GROUPS[0]
  const readings = useMemo(() => new Map(rows.map(d => [d.root_id, readDossier(d, autoElig?.byMission?.[d.root_id], comexById[d.root_id], !!autoById[d.root_id], now)] as const)), [rows, autoElig, comexById, autoById, now])
  const norm = (s: string) => s.toLowerCase().replace(/[\s.-]/g, '')
  const matches = (d: Dossier) => {
    const q = norm(search); if (!q) return true
    return norm([d.ref, String(d.number ?? ''), d.vehicle.plate, d.vehicle.brand, d.vehicle.model, d.client.name, d.billed_to.name, d.dossier_number, d.source_label,
      ...d.legs.map(l => l.billed_to_name), ...d.legs.flatMap(l => l.billed_refs), ...d.legs.map(l => l.external_id)].filter(Boolean).join(' ')).includes(q)
  }
  const scoped = useMemo(() => rows.filter(d => inGroup(d, activeGroup) && matches(d)), [rows, activeGroup, search])   // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => { const c: Record<string, number> = { all: scoped.length }; for (const d of scoped) { const w = readings.get(d.root_id)!.who; c[w] = (c[w] || 0) + 1 } return c }, [scoped, readings])
  const rank: Record<Who, number> = { nous: 0, robot: 1, eux: 2, veille: 3, client: 4, fini: 5 }
  const visible = useMemo(() => scoped.filter(d => filter === 'all' || readings.get(d.root_id)!.who === filter)
    .sort((a, b) => (rank[readings.get(a.root_id)!.who] - rank[readings.get(b.root_id)!.who]) || String(b.received_at || '').localeCompare(String(a.received_at || ''))), [scoped, filter, readings])
  const groupCounts = useMemo(() => Object.fromEntries(SOURCE_GROUPS.map(g => [g.key, rows.filter(d => inGroup(d, g) && matches(d) && (filter === 'all' || readings.get(d.root_id)!.who === filter)).length])), [rows, SOURCE_GROUPS, filter, search, readings])   // eslint-disable-line react-hooks/exhaustive-deps
  const totalNous = scoped.filter(d => readings.get(d.root_id)!.who === 'nous').reduce((s, d) => s + rest(d), 0)

  // Tarification progressive (identique à la liste par dossier) : montants figés d'abord, vrai montant ensuite.
  // Compteur « en cours de calcul » = ensemble des dossiers dont la requête est
  // partie et pas revenue. Un simple entier se bloquait quand on changeait de
  // pastille en plein calcul : le nettoyage de l'effet annulait les retours
  // sans décompter (Olivier 16/09 : « les calculs plantent sur 9 »).
  const [pricingIds, setPricingIds] = useState<Set<string>>(new Set())
  const pricing = pricingIds.size
  const refinedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const targets = initial.filter(d => d.light && !isDone(d) && !isCircuitLegs(d) && inGroup(d, activeGroup) && !refinedRef.current.has(d.root_id)).map(d => d.root_id)
    if (!targets.length) return
    targets.forEach(id => refinedRef.current.add(id))
    const drop = (id: string) => setPricingIds(p => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n })
    setPricingIds(p => new Set([...p, ...targets]))
    const got = new Set<string>()
    const one = async (id: string) => {
      try { const j = await fetch(`/api/dossier/${id}?mode=list`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null); if (j?.dossier) { got.add(id); setRows(p => p.map(d => d.root_id === id ? j.dossier : d)) } } catch {}
    }
    ;(async () => {
      for (let i = 0; i < targets.length; i += 6) await Promise.all(targets.slice(i, i + 6).map(one))
      // Seconde passe pour ceux qui n'ont pas répondu (Olivier 16/09 : « il n'arrive pas à tout calculer »).
      const missing = targets.filter(id => !got.has(id))
      for (let i = 0; i < missing.length; i += 3) await Promise.all(missing.slice(i, i + 3).map(one))
      targets.forEach(drop)
    })()
    // Pas d'annulation : une réponse qui arrive après un changement de pastille
    // reste bonne à prendre (la ligne se met à jour où qu'elle soit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup.key])

  const refreshOne = async (rootId: string) => {
    try { const j = await fetch(`/api/dossier/${rootId}?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()); if (j?.dossier) setRows(p => p.map(d => d.root_id === rootId ? j.dossier : d)) } catch {}
  }
  const openBilling = async (d: Dossier) => {
    if (!d.light) { setBilling(d); return }
    setLoadingBill(d.root_id)
    try { const j = await fetch(`/api/dossier/${d.root_id}?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()); setBilling(j?.dossier || d) }
    catch { setBilling(d) } finally { setLoadingBill(null) }
  }
  const primary = (d: Dossier, r: Reading) => {
    const p = r.primary; if (!p) return
    if (p.kind === 'bill') openBilling(d)
    else if (p.kind === 'bill_ready') openBilling(d)
    else if (p.kind === 'dossier') router.push(`/dispatch/dossier/${d.root_id}`)
    else if ((p.kind === 'link' || p.kind === 'odoo') && p.href) { if (p.kind === 'odoo') window.open(p.href, '_blank'); else router.push(p.href) }
  }
  const verifyAll = async () => {
    setBusy('verify'); setShowTools(false); setReport('🔎 Vérification des factures…')
    try { const r = await fetch('/api/facturation/verify-invoices', { method: 'POST' }); const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); const s = j.summary || {}; setReport(`✓ ${s.completed ?? 0} fiche(s) complétée(s), ${s.draft ?? 0} brouillon(s), ${s.none ?? 0} sans facture.`); router.refresh() }
    catch (e: any) { setReport(`⚠ ${e.message}`) } finally { setBusy(null) }
  }
  const siabis = async () => {
    setBusy('siabis'); setShowTools(false); setReport('🔎 Analyse Siabis non couvert (factures + prises en charge ANWB)…')
    try { const r = await fetch('/api/facturation/check-siabis-anwb', { method: 'POST' }); const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); setReport(j.message || j.report || `✓ Check Siabis / ANWB terminé.`); if (Array.isArray(j.links)) setReportLinks(j.links); router.refresh() }
    catch (e: any) { setReport(`⚠ ${e.message}`) } finally { setBusy(null) }
  }
  // Lot : tous les dossiers « À nous » prêts (sortis, tout Odoo, montant connu) → une facture par client.
  const lotTargets = visible.filter(d => readings.get(d.root_id)!.who === 'nous' && readings.get(d.root_id)!.primary?.kind === 'bill' && !isPending(d) && !hasUnknown(d))
  const runLot = async () => {
    const targets = lotTargets
    if (!targets.length) return
    setShowTools(false)
    if (!window.confirm(`Créer les factures de ${targets.length} dossier(s) « À nous » prêts ? Une facture par client, tous les groupes prêts.`)) return
    const tabs: (Window | null)[] = Array.from({ length: targets.length }, () => { try { return window.open('', '_blank') } catch { return null } })
    let tabIdx = 0, okN = 0; const links: { label: string; url: string }[] = []; const errs: string[] = []
    setBusy('lot'); setReport(`🧾 Facturation du lot : 0/${targets.length}…`)
    for (const d of targets) {
      try {
        const full = await fetch(`/api/dossier/${d.root_id}?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json())
        const dd: Dossier = full?.dossier || d
        const ids = dd.legs.filter(l => isOdoo(l) && canPickLeg(l) && !(l.kind === 'gard' && l.open)).map(l => l.mission_id)
        if (!ids.length) { errs.push(`${dd.ref} : rien de prêt`); continue }
        const r = await fetch(`/api/dossier/${dd.root_id}/invoice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_ids: ids }) })
        const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
        okN++
        for (const inv of j.invoices || []) { if (!inv.url) continue; links.push({ label: `${dd.ref} → ${inv.client_name}`, url: inv.url }); const t = tabs[tabIdx++]; if (t) { try { t.location.href = inv.url } catch {} } else { try { window.open(inv.url, '_blank') } catch {} } }
        await refreshOne(dd.root_id)
      } catch (e: any) { errs.push(`${d.ref} : ${String(e.message || e)}`) }
      setReport(`🧾 Facturation du lot : ${okN}/${targets.length}…`)
    }
    for (let i = tabIdx; i < tabs.length; i++) { try { tabs[i]?.close() } catch {} }
    setReport(`✓ Lot terminé : ${okN} dossier(s) facturé(s), ${links.length} facture(s) en brouillon${errs.length ? ` · ${errs.length} en erreur — ${errs.join(' | ')}` : ''}`)
    setReportLinks(links); setBusy(null)
  }

  const TABS: { key: Filter; label: string; dot?: string }[] = [
    { key: 'nous', label: 'À nous', dot: WHO.nous.dot }, { key: 'robot', label: 'Robot', dot: WHO.robot.dot }, { key: 'eux', label: 'Chez eux', dot: WHO.eux.dot },
    { key: 'veille', label: 'Pas prêt', dot: WHO.veille.dot }, { key: 'client', label: 'Facturées', dot: WHO.client.dot }, { key: 'all', label: 'Tous' },
  ]

  return (
    <div className="px-3 lg:px-6 py-5 space-y-4 max-w-5xl mx-auto">
      {/* En-tête */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-ink text-2xl font-bold leading-tight">🧾 À facturer</h1>
          <p className="text-ink-muted text-sm mt-0.5">
            <b className="text-ink">{counts.nous || 0}</b> dossier{(counts.nous || 0) > 1 ? 's' : ''} nous attend{(counts.nous || 0) > 1 ? 'ent' : ''}{totalNous > 0 ? ` · ${eur(totalNous)} HTVA` : ''}
            {counts.robot ? ` · ${counts.robot} au robot` : ''}{counts.eux ? ` · ${counts.eux} chez eux` : ''}{pricing > 0 ? ` · ⏳ ${pricing} en cours de calcul` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Plaque, n°, client, dossier, facture…" className="w-56 bg-surface-2 border rounded-xl pl-3 pr-8 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand" />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">×</button>}
          </div>
          <button onClick={() => router.refresh()} className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-sm text-ink-secondary" title="Rafraîchir">↻</button>
          <div className="relative">
            <button onClick={() => setShowTools(s => !s)} className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-sm text-ink-secondary" title="Outils">⋯</button>
            {showTools && (
              <div className="absolute right-0 mt-1 w-80 bg-surface border rounded-2xl shadow-xl p-2 z-20 space-y-1">
                <button onClick={runLot} disabled={!lotTargets.length || !!busy} className="w-full text-left px-3 py-2 rounded-xl hover:bg-surface-hover text-sm text-ink disabled:opacity-40">🧾 Facturer les {lotTargets.length} dossiers « À nous » prêts</button>
                <button onClick={verifyAll} disabled={!!busy} className="w-full text-left px-3 py-2 rounded-xl hover:bg-surface-hover text-sm text-ink disabled:opacity-40">🔎 Vérifier les factures (numéros, liens)</button>
                <button onClick={siabis} disabled={!!busy} className="w-full text-left px-3 py-2 rounded-xl hover:bg-surface-hover text-sm text-ink disabled:opacity-40">🇳🇱 Check Siabis / ANWB</button>
                <Link href="/facturation/allianz" className="block px-3 py-2 rounded-xl hover:bg-surface-hover text-sm text-ink">🟦 Clôture Allianz (Hexalite)</Link>
                <Link href="/touring-comex" className="block px-3 py-2 rounded-xl hover:bg-surface-hover text-sm text-ink">🅣 Touring COMEX</Link>
                {isSuperadmin && <Link href="/touring-check" className="block px-3 py-2 rounded-xl hover:bg-surface-hover text-sm text-ink">🅣 Check Touring</Link>}
                <Link href="/facturation?classic=1" className="block px-3 py-2 rounded-xl hover:bg-surface-hover text-sm text-ink-secondary border-t mt-1">Liste par fiche (ancienne) ↗</Link>
                {autoElig && <div className="px-3 py-1.5 text-[11px] text-ink-faint border-t mt-1">Robot : {autoElig.eligible} prêt(s), {autoElig.waiting} en attente du délai ({autoElig.delayHours} h)</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Onglets = qui a la main */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)} className={`px-3 py-1.5 rounded-xl text-sm font-semibold border transition flex items-center gap-1.5 ${filter === t.key ? 'bg-ink text-surface border-ink' : 'bg-surface-2 text-ink-secondary hover:bg-surface-hover'}`}>
            {t.dot && <span className={`inline-block w-2 h-2 rounded-full ${t.dot}`} />}{t.label} <span className={filter === t.key ? 'opacity-80' : 'text-ink-faint'}>{counts[t.key] || 0}</span>
          </button>
        ))}
      </div>
      {/* Assisteurs */}
      <div className="flex items-center gap-1.5 flex-wrap text-xs">
        {SOURCE_GROUPS.map(g => (
          <button key={g.key} onClick={() => setGroup(g.key)} className={`px-2.5 py-1 rounded-full border ${group === g.key ? 'bg-surface-2 text-ink border-strong font-semibold' : 'bg-surface text-ink-muted hover:text-ink'}`}>{g.label} <span className="opacity-60">{groupCounts[g.key]}</span></button>
        ))}
      </div>

      {report && (
        <div className="bg-surface border rounded-xl px-4 py-2 text-xs text-ink-secondary">{report}
          {reportLinks.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2">{reportLinks.map(l => <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="px-2 py-1 rounded-lg border bg-surface-2 text-brand hover:underline">🧾 {l.label}</a>)}</div>}
        </div>
      )}

      {visible.length === 0 && (
        <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted">
          <p className="text-4xl mb-2">{filter === 'nous' ? '🎉' : '🧾'}</p>
          <p className="font-medium text-ink">{filter === 'nous' ? 'Rien ne nous attend' : search ? 'Aucun dossier ne correspond' : 'Aucun dossier ici'}</p>
          <p className="text-sm mt-1">{filter === 'nous' ? `${counts.robot || 0} au robot · ${counts.eux || 0} chez eux · ${counts.veille || 0} en cours.` : 'Change d\'onglet ou vide la recherche.'}</p>
        </div>
      )}

      {visible.map(d => {
        const r = readings.get(d.root_id)!
        const who = WHO[r.who]
        const isOpen = open.has(d.root_id)
        const p = r.primary
        return (
          <div key={d.root_id} className="bg-surface border rounded-2xl overflow-hidden">
            <div className="px-4 pt-3.5 pb-3 flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-black text-ink text-xl tracking-wide">{d.vehicle.plate || '—'}</span>
                  <span className="text-ink-secondary text-sm">{[d.vehicle.brand, d.vehicle.model].filter(Boolean).join(' ') || '—'}</span>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface-2 border text-ink-muted">{d.ref}</span>
                  {d.dossier_number && <span className="text-[11px] font-mono text-ink-muted">{d.dossier_number}</span>}
                </div>
                <div className="text-ink-muted text-xs mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
                  <span>{d.source_label}{d.root_type ? ` · ${d.root_type}` : ''}</span>
                  <span>{d.legs.length} groupe{d.legs.length > 1 ? 's' : ''} {d.legs.map(l => l.letter).join('')}</span>
                  <span>→ {d.billed_to.name || (d.client.name ? `${d.client.name} (client)` : 'payeur à préciser')}</span>
                  {d.totals.collected > 0 && <span className="text-amber-700">💶 {eur(d.totals.collected)} encaissé sur place</span>}
                  {d.stamps?.touring_check && <span className="text-sky-700">{d.stamps.touring_check}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right tabular-nums">
                  <div className={`font-bold text-ink text-lg leading-tight ${isPending(d) ? 'opacity-40' : ''}`}>{hasUnknown(d) ? <span className="text-amber-700 text-sm font-semibold">à calculer</span> : rest(d) > 0 ? eur(rest(d)) : d.invoices.length ? eur(d.invoices.reduce((s, i) => s + i.amount, 0)) : '—'}</div>
                  <div className="text-[10.5px] text-ink-faint">{isPending(d) ? (pricing > 0 ? 'calcul en cours' : <button onClick={() => refreshOne(d.root_id)} className="underline hover:text-ink">montant figé · recalculer</button>) : rest(d) > 0 ? `HTVA · ${eurTvac(rest(d))} TVAC` : d.invoices.length ? 'HTVA facturé' : ''}</div>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border ${who.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${who.dot}`} />{who.label}</span>
              </div>
            </div>
            <div className="px-4 pb-3"><Timeline steps={r.steps} /></div>
            <div className={`mx-4 mb-3 rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-3 flex-wrap ${who.cls}`}>
              <div className="min-w-0"><div className="text-sm font-bold">{r.headline}</div>{r.detail && <div className="text-xs opacity-80 mt-0.5">{r.detail}</div>}</div>
              {p && <button disabled={!!busy || loadingBill === d.root_id} onClick={() => primary(d, r)} className={`px-3.5 py-2 rounded-xl text-sm font-bold shrink-0 disabled:opacity-50 ${TONE[p.tone || 'brand']}`}>{loadingBill === d.root_id ? '…' : p.label}{p.kind === 'bill' ? ' →' : p.kind === 'odoo' || p.kind === 'link' ? ' ↗' : ''}</button>}
            </div>
            <div className="px-4 py-2 border-t bg-surface-2/60 flex items-center gap-3 text-xs">
              <button onClick={() => setOpen(s => { const n = new Set(s); n.has(d.root_id) ? n.delete(d.root_id) : n.add(d.root_id); return n })} className="text-ink-secondary hover:text-ink font-semibold">{isOpen ? '▾' : '▸'} Détails · {d.legs.length} groupe{d.legs.length > 1 ? 's' : ''}{d.invoices.length ? ` · ${d.invoices.length} facture${d.invoices.length > 1 ? 's' : ''}` : ''}</button>
              <span className="ml-auto flex items-center gap-3">
                {d.legs.some(l => l.billed_refs.some(x => /^brouillon Odoo/i.test(x))) && <button disabled={busy === d.root_id} onClick={async () => { setBusy(d.root_id); try { await fetch(`/api/dossier/${d.root_id}/verify-invoices`, { method: 'POST' }); await refreshOne(d.root_id) } finally { setBusy(null) } }} className="text-ink-secondary hover:text-ink">Vérifier la facture</button>}
                <Link href={`/dispatch/dossier/${d.root_id}`} className="text-ink-secondary hover:text-ink">Vue dossier ↗</Link>
              </span>
            </div>
            {isOpen && (
              <div className="px-4 pb-4 pt-3 border-t bg-surface-2/30 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mb-1">Groupes</p>
                  {d.legs.map(l => (
                    <div key={l.letter} className="grid grid-cols-[24px_1fr_auto_auto] gap-2 items-center py-1 border-t first:border-t-0 text-ink-secondary">
                      <span className="font-mono font-bold text-ink">{l.letter}</span>
                      <span>{l.title}{l.kind === 'gard' && l.days != null ? ` · ${l.days} j` : ''}{l.billed_to_name && l.billed_to_name !== d.billed_to.name ? <span className="text-ink-muted"> · → {l.billed_to_name}</span> : null}{l.driver_name ? <span className="text-ink-muted"> · {l.driver_name}</span> : null}</span>
                      <span className="tabular-nums text-right">{l.amount_unknown && !isLegBilled(l) ? <span className="text-amber-700" title={l.amount_note || ''}>à calculer</span> : eur(l.amount_htva)}</span>
                      <span>{isLegBilled(l) ? <span className="px-1.5 py-0.5 rounded-full bg-surface border text-ink-muted font-mono">{cleanRef(l.billed_refs[0])}</span> : l.nothing_to_bill ? <span className="text-ink-faint">{l.nothing_to_bill}</span> : l.open ? <span className="text-sky-700">en cours</span> : <span className="text-green-700">prêt</span>}</span>
                    </div>
                  ))}
                  {remarks(d).length > 0 && (<><p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mt-3 mb-1">Remarques de facturation</p>{remarks(d).map((m, i) => <p key={i} className="text-ink-secondary border-l-2 pl-2 py-0.5">{m.text}{m.author ? <span className="text-ink-faint"> — {m.author}</span> : null}</p>)}</>)}
                  {alerts(d).length > 0 && (<><p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mt-3 mb-1">Alertes</p>{alerts(d).map((a, i) => <p key={i} className="text-amber-800 border-l-2 border-amber-400 pl-2 py-0.5">{a}</p>)}</>)}
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mb-1">Factures & encaissements</p>
                  {d.invoices.length ? d.invoices.map(i => (
                    <div key={i.number} className="flex items-center justify-between gap-2 py-1 border-t first:border-t-0">
                      <span>{i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="text-brand font-mono hover:underline">{cleanRef(i.number)}</a> : <span className="font-mono">{cleanRef(i.number)}</span>} <span className="text-ink-muted">{i.covers.join('')} · {i.client || '—'}{i.at ? ` · ${fmtDay(i.at)}` : ''}</span></span>
                      <span className="tabular-nums">{eur(i.amount)}</span>
                    </div>
                  )) : <p className="text-ink-muted">Aucune facture pour l'instant.</p>}
                  {d.legs.flatMap(l => l.payments || []).map((pm, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 py-1 border-t text-ink-secondary"><span>💶 {pm.mode || 'paiement'} sur place{pm.driver ? ` · ${pm.driver}` : ''}{pm.at ? ` · ${fmtDay(pm.at)}` : ''}</span><span className="tabular-nums">{eur(pm.amount)} TVAC</span></div>
                  ))}
                  {comexById[d.root_id] && <p className="mt-2 text-ink-muted border-l-2 pl-2">COMEX : dossier {comexById[d.root_id].dossier || '—'}{comexById[d.root_id].montant != null ? ` · ${eur(Number(comexById[d.root_id].montant))}` : ''}{comexById[d.root_id].accepted_at ? ` · accepté le ${fmtDay(comexById[d.root_id].accepted_at)}` : ' · pas encore accepté'}</p>}
                  {autoElig?.byMission?.[d.root_id]?.reason && <p className="mt-2 text-ink-muted border-l-2 pl-2">Robot : {autoElig.byMission[d.root_id].reason}</p>}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {capped && <p className="text-[11px] text-ink-faint px-1">Liste limitée aux 80 dossiers les plus récents — pour une autre fiche, passe par Recherche.</p>}
      {billing && <BillingModal d={billing} onClose={() => setBilling(null)} onDone={async (res) => { const id = billing.root_id; if (res?.invoices?.length) { setBilling(null); setReport(`✓ ${res.invoices.length} facture(s) brouillon créée(s)`); setReportLinks((res.invoices || []).filter((i: any) => i.url).map((i: any) => ({ label: `${billing.ref} → ${i.client_name}`, url: i.url }))) } await refreshOne(id) }} />}
    </div>
  )
}
