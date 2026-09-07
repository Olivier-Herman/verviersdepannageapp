'use client'
// Module Facturation par dossier — écran. Une ligne = un dossier. Mêmes outils
// que la page Facturation actuelle : groupes assureur, recherche, sources,
// compteurs d'auto-facturation (cron), badges Éligible / délai / Clôture
// Allianz, liens Touring / Allianz / COMEX / Check, vérification Odoo, check
// Siabis-ANWB. « Facturer » ouvre la modale partagée. Olivier 07/09/2026.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Dossier, DossierLeg } from '@/lib/dossier/build'
import BillingModal, { cleanRef, isLegBilled, canPickLeg } from '@/components/dossier/BillingModal'

const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtDay = (v: string | null) => v ? new Date(v).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit' }) : ''
const L_KIND: Record<DossierLeg['kind'], string> = {
  rem: 'bg-blue-600 text-white border-blue-700', gard: 'bg-amber-500 text-white border-amber-600',
  rel: 'bg-emerald-600 text-white border-emerald-700', out: 'bg-violet-600 text-white border-violet-700',
}
const AUTO_MAX = 500

// Groupes assureur — mêmes clés que la page Facturation (isolation par
// assureur pour la facturation semi-auto). « Toutes » exclut Touring, qui a son
// propre groupe ici au lieu d'une page à part.
interface SourceGroup { key: string; label: string; sources: string[] | null }
const SOURCE_GROUPS: SourceGroup[] = [
  { key: 'all',     label: 'Toutes (hors Touring)',     sources: null },
  { key: 'vab',     label: 'VAB',                       sources: ['vab'] },
  { key: 'kaze',    label: 'Kaze · Ethias · P&V · IMA', sources: ['kaze', 'ethias', 'pv', 'pv_assistance', 'ima'] },
  { key: 'mondial', label: 'Mondial (hors Hexalite)',   sources: ['mondial'] },
  { key: 'axa',     label: 'AXA',                       sources: ['axa'] },
  { key: 'touring', label: 'Touring',                   sources: ['touring', 'tgr_touring'] },
]
const inGroup = (source: string | null, g: SourceGroup) =>
  g.sources === null ? (source || '').toLowerCase() !== 'touring' : !!source && g.sources.includes(source.toLowerCase())

type AutoInfo = { status: string; eligibleAt?: string; reason?: string }

const ready  = (d: Dossier) => d.legs.filter(l => (canPickLeg(l) || (l.amount_unknown && !isLegBilled(l) && !l.nothing_to_bill)) && !(l.kind === 'gard' && l.open))
const hasUnknown = (d: Dossier) => d.legs.some(l => l.amount_unknown && !isLegBilled(l))
// Un groupe au montant INCONNU (tarif introuvable, destination non géocodée…)
// n'est pas « facturé » : il reste à facturer, avec « à calculer » affiché.
const isDone = (d: Dossier) => d.legs.every(l => isLegBilled(l) || !!l.nothing_to_bill || (l.amount_htva === 0 && !l.amount_unknown))
const rest   = (d: Dossier) => d.totals.remaining

export default function DossiersClient({ initial, autoById, isSuperadmin, capped }: { initial: Dossier[]; autoById: Record<string, boolean>; isSuperadmin: boolean; capped: boolean }) {
  const router = useRouter()
  const [rows, setRows] = useState<Dossier[]>(initial)
  const [tab, setTab] = useState<'todo' | 'auto' | 'live' | 'done'>('todo')
  const [group, setGroupState] = useState<string>('all')
  const [src, setSrc] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [billing, setBilling] = useState<Dossier | null>(null)
  const [loadingBill, setLoadingBill] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'verify' | 'siabis'>(null)
  const [report, setReport] = useState<string | null>(null)
  const [reportLinks, setReportLinks] = useState<{ label: string; url: string }[]>([])
  const [now, setNow] = useState(Date.now())
  const [autoElig, setAutoElig] = useState<{ eligible: number; waiting: number; hexalite?: number; delayHours: number; byMission?: Record<string, AutoInfo> } | null>(null)

  // Même mémoire de filtre que la page Facturation (localStorage).
  useEffect(() => { try { const g = localStorage.getItem('fact_group_filter'); if (g && SOURCE_GROUPS.some(x => x.key === g)) setGroupState(g) } catch {} }, [])
  const setGroup = (k: string) => { setGroupState(k); setSrc('all'); try { localStorage.setItem('fact_group_filter', k) } catch {} }

  // Compteurs + statut par mission du cron d'auto-facturation (superadmin).
  useEffect(() => {
    if (!isSuperadmin) return
    const load = () => fetch('/api/facturation/auto-eligible').then(r => r.ok ? r.json() : null).then(j => { if (j) setAutoElig(j) }).catch(() => {})
    load(); const t = setInterval(load, 60_000); return () => clearInterval(t)
  }, [isSuperadmin])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  // Statut auto d'un dossier = celui de sa fiche racine dans le cron (le cron
  // raisonne par fiche ; la racine porte la règle source/type).
  const autoInfo = (d: Dossier): AutoInfo | undefined => autoElig?.byMission?.[d.root_id]
  const isAuto = (d: Dossier) => {
    const ai = autoInfo(d)
    if (ai) return ai.status === 'eligible' || (ai.status === 'waiting' && !!ai.eligibleAt && new Date(ai.eligibleAt).getTime() <= now)
    return !d.state.open && !isDone(d) && ready(d).length > 0 && !!autoById[d.root_id] && rest(d) <= AUTO_MAX
  }

  const activeGroup = SOURCE_GROUPS.find(g => g.key === group) || SOURCE_GROUPS[0]
  const TABS: Array<[typeof tab, string, (d: Dossier) => boolean]> = [
    ['todo', 'À facturer', d => !isDone(d)],
    ['auto', 'Éligibles auto', d => isAuto(d)],
    ['live', 'En cours', d => d.state.open && !isDone(d)],
    ['done', 'Facturées', d => isDone(d)],
  ]
  const inScope = (d: Dossier) => inGroup(d.source, activeGroup) && (src === 'all' || d.source === src)
  const matches = (d: Dossier) => {
    const q = search.trim().toLowerCase(); if (!q) return true
    const hay = [d.ref, String(d.number ?? ''), d.vehicle.plate, d.vehicle.brand, d.vehicle.model, d.client.name, d.billed_to.name, d.dossier_number, d.source_label,
      ...d.legs.map(l => l.billed_to_name), ...d.legs.flatMap(l => l.billed_refs), ...d.legs.map(l => l.external_id)].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q) || hay.replace(/[-\s]/g, '').includes(q.replace(/[-\s]/g, ''))
  }
  const sources = useMemo(() => Array.from(new Set(rows.filter(d => inGroup(d.source, activeGroup)).map(d => d.source || ''))).filter(Boolean).sort(), [rows, activeGroup])
  const sourceLabel = (k: string) => rows.find(d => d.source === k)?.source_label || k
  const groupCounts = useMemo(() => Object.fromEntries(SOURCE_GROUPS.map(g => [g.key, rows.filter(d => inGroup(d.source, g) && !isDone(d)).length])), [rows])
  const scoped = rows.filter(inScope).filter(matches)
  const visible = scoped.filter(TABS.find(t => t[0] === tab)![2])
  const todo = scoped.filter(d => !isDone(d))

  const refreshOne = async (rootId: string) => {
    try {
      const j = await fetch(`/api/dossier/${rootId}?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json())
      if (j?.dossier) setRows(p => p.map(d => d.root_id === rootId ? j.dossier : d))
    } catch {}
  }
  const openBilling = async (d: Dossier) => {
    setLoadingBill(d.root_id)
    try { const j = await fetch(`/api/dossier/${d.root_id}?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()); setBilling(j?.dossier || d) }
    catch { setBilling(d) } finally { setLoadingBill(null) }
  }
  const verify = async () => {
    setBusy('verify'); setReport('🔎 Vérification dans Odoo…'); setReportLinks([])
    try {
      const r = await fetch('/api/facturation/verify-invoices', { method: 'POST' }); const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      const s = j.summary || {}
      setReport(`✓ Vérification Odoo : ${s.completed ?? 0} fiche(s) complétée(s) avec leur numéro, ${s.draft ?? 0} brouillon(s) en attente, ${s.none ?? 0} sans facture.`)
      router.refresh()
    } catch (e: any) { setReport(`⚠ ${e.message}`) } finally { setBusy(null) }
  }
  const siabis = async () => {
    setBusy('siabis'); setReport('🔎 Analyse Siabis non couvert (factures Odoo + prises en charge ANWB par mail)…'); setReportLinks([])
    try {
      const r = await fetch('/api/facturation/check-siabis-anwb', { method: 'POST' }); const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setReport(j.message || j.report || `✓ Check Siabis / ANWB terminé (${j.updated ?? j.count ?? 0} fiche(s) mise(s) à jour).`)
      if (Array.isArray(j.links)) setReportLinks(j.links)
      router.refresh()
    } catch (e: any) { setReport(`⚠ ${e.message}`) } finally { setBusy(null) }
  }

  return (
    <div className="px-3 lg:px-6 py-5 space-y-3">
      {isSuperadmin && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-2 text-xs text-amber-700 dark:text-amber-300 font-semibold flex flex-wrap justify-between gap-2">
          <span>🧪 Preview « Facturation par dossier » — visible par toi seul. Le module Facturation actuel n'est pas modifié.</span>
          <Link href="/facturation" className="underline">← Facturation actuelle</Link>
        </div>
      )}

      {/* En-tête : compteurs du cron + liens des circuits d'auto-facturation */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-ink text-2xl font-bold leading-tight">Facturation par dossier</h1>
          <p className="text-ink-muted text-sm mt-0.5">{todo.length} dossier{todo.length > 1 ? 's' : ''} à facturer{activeGroup.key !== 'all' ? ` · ${activeGroup.label}` : ''}.</p>
          {isSuperadmin && autoElig && (
            <div className="mt-2 inline-flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold" title="Fiches qui seront auto-facturées au prochain passage du cron (règle source+type, sèche, tarif présent, hors Hexalite, délai écoulé, dossier sorti).">🎯 Éligible auto : {autoElig.eligible}</span>
              {autoElig.waiting > 0 && <span className="px-2.5 py-1 rounded-lg bg-amber-500 text-white font-medium" title={`Éligibles mais en attente du délai de ${autoElig.delayHours}h après clôture.`}>⏳ {autoElig.waiting} en attente ({autoElig.delayHours}h)</span>}
              {!!autoElig.hexalite && autoElig.hexalite > 0 && <span className="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-medium" title="Allianz/Mondial dans Hexalite : facturées via « Clôture Allianz ».">🟦 {autoElig.hexalite} → Clôture Allianz</span>}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/facturation/allianz" className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm font-semibold transition">🟦 Clôture Allianz</Link>
          <Link href="/touring-comex" title="Rapprochement auto-facturation Touring COMEX BKO" className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm font-semibold transition">🅣 Touring COMEX</Link>
          {isSuperadmin && <Link href="/touring-check" title="Dossiers Touring hors comex à faire trancher par Touring" className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm font-semibold transition">🅣 Check Touring</Link>}
          <button onClick={siabis} disabled={busy !== null} title="Siabis non couvert : facture Siabis (Odoo) ou prise en charge ANWB (mail info/administration)" className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm font-semibold transition disabled:opacity-50">{busy === 'siabis' ? '⏳ Check…' : '🔎 Check Siabis / ANWB'}</button>
          <button onClick={verify} disabled={busy !== null} title="Vérifie dans Odoo quelles factures sont postées et ramène les numéros sur les groupes" className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">{busy === 'verify' ? '🔎 Vérification…' : '🔎 Vérification facturation Odoo'}</button>
        </div>
      </div>
      {report && (
        <div className="bg-surface border rounded-xl px-4 py-2 text-xs text-ink-secondary">
          {report}
          {reportLinks.length > 0 && <span className="ml-2">{reportLinks.map(l => <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-brand hover:underline mr-2">{l.label}</a>)}</span>}
        </div>
      )}

      {/* Filtres : groupes assureur + recherche + source */}
      <div className="bg-surface border rounded-2xl p-3 space-y-2.5">
        <div className="flex flex-wrap gap-2">
          {SOURCE_GROUPS.map(g => (
            <button key={g.key} onClick={() => setGroup(g.key)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${group === g.key ? 'bg-brand text-white border-brand' : 'bg-surface-2 text-ink-secondary hover:text-ink'}`}>
              {g.label}<span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${group === g.key ? 'bg-white/25' : 'bg-black/10 text-ink-muted'}`}>{groupCounts[g.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Recherche (plaque, client, dossier, n° facture…)" className="sm:col-span-2 bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint" />
          <select value={src} onChange={e => setSrc(e.target.value)} className="bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm">
            <option value="all">Toutes sources</option>
            {sources.map(s => <option key={s} value={s}>{sourceLabel(s)}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Reste à facturer" value={eur(todo.reduce((s, d) => s + rest(d), 0))} />
        <Kpi label="Éligibles au prochain cron" value={String(scoped.filter(isAuto).length)} />
        <Kpi label="Dossiers en cours (parc / relivraison)" value={String(scoped.filter(d => d.state.open && !isDone(d)).length)} />
        <Kpi label="Partiel possible maintenant" value={String(scoped.filter(d => d.state.open && ready(d).length > 0).length)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(([k, lbl, f]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${tab === k ? 'bg-brand text-white border-brand' : 'bg-surface text-ink-secondary'}`}>{lbl} <span className="opacity-70">{scoped.filter(f).length}</span></button>
        ))}
      </div>

      {visible.length === 0 && <div className="bg-surface border rounded-2xl p-8 text-center text-ink-muted text-sm">Rien dans cet onglet.</div>}

      {visible.map(d => {
        const rd = ready(d); const isOpen = open.has(d.root_id); const ai = autoInfo(d)
        const clients = Array.from(new Set(d.legs.filter(l => !isLegBilled(l) && !l.nothing_to_bill).map(l => l.billed_to_name || '—')))
        const badge = isDone(d) ? ['bg-surface-2 text-ink-muted border', 'Facturé']
          : ai?.status === 'hexalite' ? ['bg-blue-600 text-white', '🟦 Clôture Allianz']
          : isAuto(d) ? ['bg-emerald-600 text-white', '🎯 Éligible auto']
          : ai?.status === 'waiting' && ai.eligibleAt ? ['bg-amber-500 text-white', `⏳ auto dans ${countdown(new Date(ai.eligibleAt).getTime() - now)}`]
          : d.state.open ? ['bg-blue-600 text-white', 'En cours']
          : ['bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', 'Prêt · manuel']
        return (
          <div key={d.root_id} className="bg-surface border rounded-2xl overflow-hidden">
            <div onClick={() => setOpen(p => { const n = new Set(p); n.has(d.root_id) ? n.delete(d.root_id) : n.add(d.root_id); return n })}
              className="grid grid-cols-1 md:grid-cols-[minmax(200px,1.2fr)_minmax(160px,1fr)_minmax(200px,1.3fr)_110px_170px_auto] gap-3 items-center px-4 py-2.5 cursor-pointer hover:bg-surface-2/60">
              <div className="text-ink font-bold text-sm">{d.ref} · <span className="font-mono">{d.vehicle.plate}</span>
                <span className="block text-[11px] font-medium text-ink-muted">{[d.vehicle.brand, d.vehicle.model].filter(Boolean).join(' ')} · {d.source_label}{d.legs.length === 1 ? ' · dépannage simple' : ''}</span></div>
              <div className="text-xs text-ink-secondary">{d.billed_to.name || '—'}
                <span className="block text-[11px] text-ink-muted">{clients.length > 1 ? `+ ${clients.filter(c => c !== d.billed_to.name).join(', ')}` : d.state.open ? d.state.reason : d.legs.some(l => l.ended_at) ? `terminé le ${fmtDay(d.legs[d.legs.length - 1].ended_at)}` : ''}</span></div>
              <div className="flex flex-wrap gap-1">
                {d.legs.map(l => (
                  <span key={l.letter} title={`${l.letter} ${l.title} · ${isLegBilled(l) ? 'facturé ' + cleanRef(l.billed_refs[0]) : l.nothing_to_bill ? l.nothing_to_bill : l.open && l.kind === 'gard' ? 'en cours' : 'prêt'}`}
                    className={`w-6 h-6 rounded-md border inline-flex items-center justify-center text-[11px] font-bold font-mono ${L_KIND[l.kind]} ${isLegBilled(l) ? 'opacity-35 line-through' : ''} ${l.open && l.kind === 'gard' ? 'border-dashed !bg-transparent !text-amber-700 dark:!text-amber-300' : ''} ${l.nothing_to_bill ? 'opacity-45' : ''}`}>{l.letter}</span>
                ))}
              </div>
              <div className="text-right font-semibold tabular-nums text-ink text-sm">{hasUnknown(d) ? <span className="text-ink-muted font-normal">{rest(d) > 0 ? eur(rest(d)) + ' + ' : ''}à calculer</span> : eur(rest(d))}<span className="block text-[10.5px] font-normal text-ink-muted">reste HTVA</span></div>
              <div><span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${badge[0]}`} title={ai?.reason || ''}>{badge[1]}</span></div>
              <div className="flex gap-1.5">
                <button disabled={(!rd.length && !d.legs.some(l => canPickLeg(l))) || loadingBill === d.root_id} onClick={e => { e.stopPropagation(); openBilling(d) }} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${rd.length ? 'bg-brand text-white' : 'border text-ink-secondary'} disabled:opacity-40`}>{loadingBill === d.root_id ? '⏳ Calcul…' : `Facturer${d.state.open && rd.length ? ' (partiel)' : ''}`}</button>
                <Link href={`/dispatch/dossier/${d.root_id}`} onClick={e => e.stopPropagation()} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border text-ink-secondary hover:text-ink">Dossier ↗</Link>
              </div>
            </div>
            {isOpen && (
              <div className="border-t bg-surface-2 px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mb-1">Groupes du dossier</p>
                  {d.legs.map(l => (
                    <div key={l.letter} className="grid grid-cols-[24px_1fr_auto_auto] gap-2 items-center py-1 border-t first:border-t-0 text-ink-secondary">
                      <span className="font-mono">{l.letter}</span>
                      <span>{l.title}{l.kind === 'gard' && l.days != null ? ` ${l.days} j` : ''}{l.billed_to_name !== d.billed_to.name ? <span className="text-ink-muted"> · → {l.billed_to_name || '?'}</span> : null}</span>
                      <span className="tabular-nums">{l.amount_unknown && !isLegBilled(l) ? <span className="text-ink-muted">à calculer</span> : eur(l.amount_htva)}</span>
                      <span>{isLegBilled(l) ? <span className="px-1.5 py-0.5 rounded-full bg-surface border text-ink-muted font-mono">{cleanRef(l.billed_refs[0])}</span> : l.nothing_to_bill ? <span className="text-ink-faint">{l.nothing_to_bill}</span> : l.open && l.kind === 'gard' ? <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white">en cours</span> : <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">prêt</span>}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mb-1">Factures du dossier</p>
                  {d.invoices.length ? d.invoices.map(i => (
                    <div key={i.number} className="flex items-center justify-between gap-2 py-1 border-t first:border-t-0">
                      <span>{i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="text-brand font-mono hover:underline">{cleanRef(i.number)}</a> : <span className="font-mono">{cleanRef(i.number)}</span>} <span className="text-ink-muted">couvre {i.covers.join(' ')} · {i.client || '—'}{i.at ? ' · ' + fmtDay(i.at) : ''}</span></span>
                      <span className="tabular-nums">{eur(i.amount)}</span>
                    </div>
                  )) : <p className="text-ink-muted">Aucune facture pour l'instant.</p>}
                  {ai?.reason && <p className="mt-2 text-ink-muted border-l-2 pl-2">Auto-facturation : {ai.reason}</p>}
                  {d.state.open && rd.length > 0 && <p className="mt-2 text-ink-muted border-l-2 pl-2">Dossier en cours ({d.state.reason}) : pas de facturation automatique. Tu peux facturer maintenant les groupes prêts ; le reste partira à la sortie du véhicule.</p>}
                  {isAuto(d) && <p className="mt-2 text-ink-muted border-l-2 pl-2">Sera facturé automatiquement au prochain cron : référence « {d.number} {rd.map(l => l.letter).join(' ')} ».</p>}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {capped && <p className="text-[11px] text-ink-faint px-1">Liste limitée aux 80 dossiers les plus récents. Pour une autre fiche, la recherche VD Soft + TowSoft reste sur la page Facturation actuelle.</p>}
      {billing && <BillingModal d={billing} onClose={() => setBilling(null)} onDone={() => refreshOne(billing.root_id)} />}
    </div>
  )
}

function countdown(ms: number): string {
  if (ms <= 0) return '0:00'
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), mn = Math.floor((t % 3600) / 60), s = t % 60
  return h > 0 ? `${h}h${String(mn).padStart(2, '0')}` : `${mn}:${String(s).padStart(2, '0')}`
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="bg-surface border rounded-xl px-3.5 py-2.5 text-[11px] text-ink-muted">{label}<b className="block text-lg text-ink tabular-nums font-semibold">{value}</b></div>
}
