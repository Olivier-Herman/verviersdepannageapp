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
// TVA 21 % — même conversion que les totaux du dossier (due_tvac).
const TVA = 1.21
const eurTvac = (n: number) => eur(Math.round(n * TVA * 100) / 100)
// Encaissements chauffeur du dossier (table interventions) — TVAC, déjà payé
// sur place. Olivier 09/09/2026 : « il y a un encaissement mais je ne le vois
// pas sur la carte » — sans lui on refacture au client ce qu'il a déjà réglé.
const allPayments = (d: Dossier) => d.legs.flatMap(l => l.payments || [])
const paidLabel = (d: Dossier) => {
  const ps = allPayments(d)
  // Repli : le total peut venir du montant payé porté par la fiche, sans ligne
  // d'encaissement enregistrée — on le dit plutôt que d'afficher un vide.
  if (!ps.length) return 'montant payé porté par la fiche (aucun encaissement détaillé)'
  return ps.map(p => `${eur(p.amount)}${p.mode ? ' · ' + p.mode : ''}${p.driver ? ' · ' + p.driver : ''}${p.at ? ' · ' + new Date(p.at).toLocaleDateString('fr-BE') : ''}`).join('\n')
}
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
  { key: 'touring', label: 'Touring (tout ce qui lui est facturé)', sources: ['touring', 'tgr_touring'] },
]
// « Touring » se juge sur QUI on facture, pas sur la source (Olivier 09/09/2026 :
// « hors Touring = hors tout ce qui est facturé à Touring »). Un Siabis Couvert
// a sa propre source mais part chez Touring : il appartient au groupe Touring.
// Un Siabis NON couvert payé par le client sur place n'a pas Touring comme
// payeur (build.ts le retire) — il reste donc dans « Toutes ».
const isTouringBilled = (d: Dossier) =>
  /touring/i.test(String(d.billed_to.name || ''))
  || d.legs.some(l => /touring/i.test(String(l.billed_to_name || '')))
const inGroup = (d: Dossier, g: SourceGroup) => {
  const source = (d.source || '').toLowerCase()
  const touring = source === 'touring' || source === 'tgr_touring' || isTouringBilled(d)
  return g.sources === null ? !touring
    : g.key === 'touring' ? touring
    : !!source && g.sources.includes(source)
}

type AutoInfo = { status: string; eligibleAt?: string; reason?: string }

const isOdoo = (l: DossierLeg) => (l.channel || 'odoo') === 'odoo'
const ready  = (d: Dossier) => d.legs.filter(l => isOdoo(l) && (canPickLeg(l) || (l.amount_unknown && !isLegBilled(l) && !l.nothing_to_bill)) && !(l.kind === 'gard' && l.open))
// Dossier « circuit » = ce qui reste à régler passe par le Parquet (états de
// frais) ou le Domaine (relevé trimestriel), pas par une facture Odoo d'ici.
const isCircuitLegs = (d: Dossier) => d.legs.some(l => !isOdoo(l) && !isLegBilled(l) && !l.nothing_to_bill) && ready(d).length === 0
// Une ligne pas encore tarifée (montants figés) n'a rien à dire sur le tarif :
// elle affiche son montant figé et un sablier, jamais « à calculer ».
const isPending  = (d: Dossier) => !!d.light
const hasUnknown = (d: Dossier) => !d.light && d.legs.some(l => l.amount_unknown && !isLegBilled(l))
// Pourquoi le moteur n'a pas su chiffrer : la raison vit sur le groupe
// (amount_note). Sans elle, « à calculer » ne dit pas quoi corriger — il faut
// ouvrir le dossier pour la lire (Olivier 09/09/2026, 2CMX015 et 1DMC939).
const unknownLegs  = (d: Dossier) => d.legs.filter(l => l.amount_unknown && !isLegBilled(l))
const unknownWhy   = (d: Dossier) => unknownLegs(d).map(l => l.amount_note || 'raison inconnue')
const unknownTitle = (d: Dossier) => unknownLegs(d)
  .map(l => `${l.letter} · ${l.title} : ${l.amount_note || 'raison inconnue'}`).join('\n')
// Un groupe au montant INCONNU (tarif introuvable, destination non géocodée…)
// n'est pas « facturé » : il reste à facturer, avec « à calculer » affiché.
const isDone = (d: Dossier) => !d.state.open && d.legs.every(l => isLegBilled(l) || !!l.nothing_to_bill || (l.amount_htva === 0 && !l.amount_unknown))
const rest   = (d: Dossier) => d.totals.remaining

type ComexInfo = { verdict: string | null; montant: number | null; accepted_at: string | null; dossier: string | null }
export default function DossiersClient({ initial, autoById, comexById = {}, isSuperadmin, capped }: { initial: Dossier[]; autoById: Record<string, boolean>; comexById?: Record<string, ComexInfo>; isSuperadmin: boolean; capped: boolean }) {
  const router = useRouter()
  const [rows, setRows] = useState<Dossier[]>(initial)
  const [tab, setTab] = useState<'todo' | 'auto' | 'live' | 'circuit' | 'done'>('todo')
  const [group, setGroupState] = useState<string>('all')
  const [src, setSrc] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [billing, setBilling] = useState<Dossier | null>(null)
  const [loadingBill, setLoadingBill] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [importing, setImporting] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'verify' | 'siabis'>(null)
  const [report, setReport] = useState<string | null>(null)
  const [reportLinks, setReportLinks] = useState<{ label: string; url: string }[]>([])
  const [now, setNow] = useState(Date.now())
  // Facturation par lot : on coche des dossiers prêts (sortis, tout Odoo), un
  // bouton crée leurs factures à la suite (tous les groupes prêts de chacun).
  const [lot, setLot] = useState<Set<string>>(new Set())
  const [lotBusy, setLotBusy] = useState(false)
  const lotEligible = (d: Dossier) => !isPending(d) && !d.state.open && !isDone(d) && !isCircuit(d) && ready(d).length > 0 && !d.legs.some(l => l.amount_unknown && !isLegBilled(l))
  const runLot = async () => {
    const targets = rows.filter(d => lot.has(d.root_id))
    if (!targets.length) return
    if (!window.confirm(`Créer les factures Odoo de ${targets.length} dossier(s) ? Une facture par client, tous les groupes prêts.`)) return
    // Onglets Odoo pré-ouverts MAINTENANT (dans le clic) : un window.open après
    // un await est bloqué par le navigateur — le lot ne montrait que des petits
    // liens et Olivier allait chercher les brouillons dans Odoo (09/09/2026).
    // Un onglet par dossier ; s'il y a plus de factures que d'onglets, on tente
    // l'ouverture directe ; les onglets en trop sont refermés.
    const tabs: (Window | null)[] = Array.from({ length: targets.length }, () => { try { return window.open('', '_blank') } catch { return null } })
    let tabIdx = 0
    setLotBusy(true); setReport(`🧾 Facturation du lot : 0/${targets.length}…`); setReportLinks([])
    let okN = 0; const links: { label: string; url: string }[] = []; const errs: string[] = []
    for (const d of targets) {
      try {
        const full = await fetch(`/api/dossier/${d.root_id}?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json())
        const dd: Dossier = full?.dossier || d
        const ids = dd.legs.filter(l => isOdoo(l) && canPickLeg(l) && !(l.kind === 'gard' && l.open)).map(l => l.mission_id)
        if (!ids.length) { errs.push(`${dd.ref} : rien de prêt`); continue }
        const r = await fetch(`/api/dossier/${dd.root_id}/invoice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_ids: ids }) })
        const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
        okN++
        for (const inv of j.invoices || []) {
          if (!inv.url) continue
          links.push({ label: `${dd.ref} → ${inv.client_name}`, url: inv.url })
          const t = tabs[tabIdx++]
          if (t) { try { t.location.href = inv.url } catch {} } else { try { window.open(inv.url, '_blank') } catch {} }
        }
        await refreshOne(dd.root_id)
      } catch (e: any) { errs.push(`${d.ref} : ${String(e.message || e)}`) }
      setReport(`🧾 Facturation du lot : ${okN}/${targets.length}…`)
    }
    for (let i = tabIdx; i < tabs.length; i++) { try { tabs[i]?.close() } catch {} }   // onglets non utilisés
    setReport(`✓ Lot terminé : ${okN} dossier(s) facturé(s), ${links.length} facture(s) Odoo en brouillon${errs.length ? ` · ${errs.length} en erreur — ${errs.join(' | ')}` : ''}`)
    setReportLinks(links); setLot(new Set()); setLotBusy(false)
  }
  // « Tout ouvrir » : dans le clic, une fenêtre par facture (autorisé par le navigateur).
  const openAllLinks = () => { for (const l of reportLinks) { try { window.open(l.url, '_blank') } catch {} } }
  // Recherche avancée VD Soft + TowSoft (même API que la page Facturation).
  const [advType, setAdvType] = useState<'immatriculation' | 'niv' | 'num_dossier' | 'id_appel' | 'num_facture'>('immatriculation')
  const [advKey, setAdvKey] = useState('')
  const [advBusy, setAdvBusy] = useState(false)
  const [advResults, setAdvResults] = useState<any[] | null>(null)
  const [advErr, setAdvErr] = useState<string | null>(null)
  const runAdv = async () => {
    if (advKey.trim().length < 2) return
    setAdvBusy(true); setAdvErr(null)
    try {
      const r = await fetch('/api/facturation/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ searchType: advType, key: advKey.trim() }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setAdvResults(j.results || []); if (j.errors?.length) setAdvErr(j.errors.join(' · '))
    } catch (e: any) { setAdvErr(String(e.message || e)); setAdvResults([]) } finally { setAdvBusy(false) }
  }
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
    if (isDone(d)) return false   // déjà facturé / auto-facturé : plus jamais « éligible »
    const ai = autoInfo(d)
    if (ai) return ai.status === 'eligible' || (ai.status === 'waiting' && !!ai.eligibleAt && new Date(ai.eligibleAt).getTime() <= now)
    return !d.state.open && !isDone(d) && ready(d).length > 0 && !!autoById[d.root_id] && rest(d) <= AUTO_MAX
  }

  const inComex = (d: Dossier) => { const c = comexById[d.root_id]; return !!c && !c.accepted_at && !isDone(d) }
  const isCircuit = (d: Dossier) => isCircuitLegs(d) || inComex(d)
  const activeGroup = SOURCE_GROUPS.find(g => g.key === group) || SOURCE_GROUPS[0]
  const TABS: Array<[typeof tab, string, (d: Dossier) => boolean]> = [
    ['todo', 'À facturer', d => !isDone(d) && !isCircuit(d)],
    ['auto', 'Éligibles auto', d => isAuto(d)],
    ['live', 'En cours', d => d.state.open && !isDone(d) && !isCircuit(d)],
    ['circuit', 'Parquet / Domaine / COMEX', d => isCircuit(d) && !isDone(d)],
    ['done', 'Facturées', d => isDone(d)],
  ]
  const inScope = (d: Dossier) => inGroup(d, activeGroup) && (src === 'all' || d.source === src)
  const matches = (d: Dossier) => {
    const q = search.trim().toLowerCase(); if (!q) return true
    const hay = [d.ref, String(d.number ?? ''), d.vehicle.plate, d.vehicle.brand, d.vehicle.model, d.client.name, d.billed_to.name, d.dossier_number, d.source_label,
      ...d.legs.map(l => l.billed_to_name), ...d.legs.flatMap(l => l.billed_refs), ...d.legs.map(l => l.external_id)].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q) || hay.replace(/[-\s]/g, '').includes(q.replace(/[-\s]/g, ''))
  }
  const sources = useMemo(() => Array.from(new Set(rows.filter(d => inGroup(d, activeGroup)).map(d => d.source || ''))).filter(Boolean).sort(), [rows, activeGroup])
  const sourceLabel = (k: string) => rows.find(d => d.source === k)?.source_label || k
  // Le compteur d'un groupe annonce ce qu'on verra en cliquant dessus : même
  // onglet, même source, même recherche. Avant, il comptait TOUT le groupe hors
  // facturé, onglets confondus — « Toutes (hors Touring) 18 » au-dessus d'une
  // liste de 9, parce que 9 autres partaient par le Parquet / Domaine / COMEX
  // (Olivier 09/09/2026).
  const tabPredicate = TABS.find(t => t[0] === tab)![2]
  const groupCounts = useMemo(
    () => Object.fromEntries(SOURCE_GROUPS.map(g => [g.key, rows.filter(d =>
      inGroup(d, g) && (src === 'all' || d.source === src) && matches(d) && tabPredicate(d),
    ).length])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, tab, src, search],
  )
  const scoped = rows.filter(inScope).filter(matches)
  const visible = scoped.filter(TABS.find(t => t[0] === tab)![2])
  const todo = scoped.filter(d => !isDone(d) && !isCircuit(d))

  // Tarification progressive : la page arrive avec les montants figés (2 s), on
  // demande ensuite le vrai montant dossier par dossier et on remplace la ligne
  // dès qu'il arrive. Par petits paquets, pour ne pas noyer le serveur.
  // Olivier 09/09/2026 : « 24 sec pour que la page facturation s'affiche ».
  const [pricing, setPricing] = useState(0)   // nombre de dossiers encore à tarifer
  useEffect(() => {
    const todoIds = initial.filter(d => d.light).map(d => d.root_id)
    if (!todoIds.length) return
    let cancelled = false
    setPricing(todoIds.length)
    ;(async () => {
      for (let i = 0; i < todoIds.length; i += 6) {
        if (cancelled) return
        const batch = todoIds.slice(i, i + 6)
        await Promise.all(batch.map(async id => {
          try {
            const j = await fetch(`/api/dossier/${id}?mode=list`, { cache: 'no-store' }).then(r => r.json())
            if (!cancelled && j?.dossier) setRows(p => p.map(d => d.root_id === id ? j.dossier : d))
          } catch { /* la ligne garde son montant figé */ }
          if (!cancelled) setPricing(n => Math.max(0, n - 1))
        }))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshOne = async (rootId: string) => {
    try {
      const j = await fetch(`/api/dossier/${rootId}?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json())
      if (j?.dossier) setRows(p => p.map(d => d.root_id === rootId ? j.dossier : d))
    } catch {}
  }
  const openBilling = async (d: Dossier) => {
    // Ligne déjà tarifée (calcul progressif terminé) : la modale s'ouvre tout de
    // suite. Olivier 09/09/2026 : « Facturer ouvre le dossier et je dois
    // recliquer » — pendant le « Calcul… » le bouton était désactivé et le second
    // toucher tombait sur la ligne, qui ouvre le dossier.
    if (!d.light) { setBilling(d); return }
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
          <Link href="/facturation?classic=1" className="underline">← Facturation classique</Link>
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
          {reportLinks.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">Factures créées :</span>
              {reportLinks.map(l => <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="px-2 py-1 rounded-lg border bg-surface-2 text-brand hover:underline">🧾 {l.label}</a>)}
              {reportLinks.length > 1 && <button onClick={openAllLinks} className="px-2 py-1 rounded-lg bg-brand text-white font-semibold">Tout ouvrir dans Odoo</button>}
            </div>
          )}
        </div>
      )}

      {/* Filtres : groupes assureur + recherche + source */}
      <div className="bg-surface border rounded-2xl p-3 space-y-2.5">
        <div className="flex flex-wrap gap-2">
          {SOURCE_GROUPS.map(g => (
            <button key={g.key} onClick={() => setGroup(g.key)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${group === g.key ? 'bg-brand text-white border-brand' : 'bg-surface-2 text-ink-secondary hover:text-ink'}`}>
              {g.label}<span title={`Dossiers de ce groupe dans l'onglet « ${TABS.find(t => t[0] === tab)![1]} »`} className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${group === g.key ? 'bg-white/25' : 'bg-black/10 text-ink-muted'}`}>{groupCounts[g.key] ?? 0}</span>
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
        <Kpi label="Reste à facturer" value={eur(todo.reduce((s, d) => s + rest(d), 0))}
          sub={pricing > 0 ? `⏳ ${pricing} dossier(s) en cours de calcul` : `${eurTvac(todo.reduce((s, d) => s + rest(d), 0))} TVAC`} />
        <Kpi label="Éligibles au prochain cron" value={String(scoped.filter(isAuto).length)} />
        <Kpi label="Dossiers en cours (parc / relivraison)" value={String(scoped.filter(d => d.state.open && !isDone(d)).length)} />
        <Kpi label="Partiel possible maintenant" value={String(scoped.filter(d => d.state.open && ready(d).length > 0).length)} />
      </div>

      {/* Recherche avancée VD Soft + TowSoft : facturer une fiche qui n'est pas dans la liste */}
      <details className="bg-surface border rounded-2xl px-4 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-ink flex items-center gap-2">🔎 Facturer un autre dossier <span className="text-ink-muted font-normal text-xs">recherche VD Soft + TowSoft par plaque, VIN, dossier, n° mission ou n° facture</span></summary>
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {([['immatriculation', 'Plaque'], ['niv', 'VIN'], ['num_dossier', 'Dossier'], ['id_appel', 'N° mission'], ['num_facture', 'N° facture']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setAdvType(v)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${advType === v ? 'bg-brand text-white border-brand' : 'bg-surface-2 text-ink-secondary hover:text-ink'}`}>{l}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={advKey} onChange={e => setAdvKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runAdv() }} placeholder="Saisis la valeur à rechercher…" className="flex-1 bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint" />
            <button onClick={runAdv} disabled={advBusy || advKey.trim().length < 2} className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold">{advBusy ? '⏳…' : 'Rechercher'}</button>
          </div>
          {advErr && <p className="text-xs text-amber-700">⚠ {advErr}</p>}
          {advResults && (advResults.length ? (
            <div className="border rounded-xl overflow-hidden text-xs">
              {advResults.map((r: any, i: number) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-[90px_120px_1fr_1fr_140px_auto] gap-2 items-center px-3 py-2 border-t first:border-t-0">
                  <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold text-white w-fit ${r.source === 'vdsoft' ? 'bg-brand' : 'bg-slate-500'}`}>{r.source === 'vdsoft' ? 'VD Soft' : 'TowSoft'}</span>
                  <span className="font-mono text-ink">{r.ref}{r.dossier ? <span className="block text-ink-muted">{r.dossier}</span> : null}</span>
                  <span><span className="font-mono">{r.plate || '—'}</span> {[r.brand, r.model].filter(Boolean).join(' ')}<span className="block text-ink-muted">{r.type || ''}{r.date_iso ? ' · ' + fmtDay(r.date_iso) : ''}</span></span>
                  <span className="text-ink-secondary">{r.client || '—'}<span className="block text-ink-muted truncate" title={r.lieu || ''}>{r.lieu || ''}</span></span>
                  <span className="text-ink-secondary">{r.invoice_number ? `facture ${r.invoice_number}` : (r.status || '')}{r.montant_ttc != null ? <span className="block tabular-nums">{eur(Number(r.montant_ttc))} TTC</span> : null}</span>
                  <span>{r.source === 'vdsoft' && r.vdsoft_id ? <Link href={`/dispatch/dossier/${r.vdsoft_id}`} className="px-2.5 py-1 rounded-lg border text-brand font-semibold hover:bg-brand/10">Dossier ↗</Link>
                    : r.source === 'towsoft' && r.towsoft_num ? <button disabled={importing === String(r.towsoft_num)} onClick={async () => { setImporting(String(r.towsoft_num)); try { const rr = await fetch('/api/facturation/import-towsoft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ towsoft_num: r.towsoft_num }) }); const jj = await rr.json().catch(() => ({})); if (!rr.ok) throw new Error(jj.error || 'Import KO'); router.push(`/dispatch/dossier/${jj.mission_id}?open=none`) } catch (e: any) { setAdvErr('Import TowSoft : ' + (e?.message || e)) } finally { setImporting(null) } }} title="Importe la fiche TowSoft dans VD Soft (à facturer) et ouvre son dossier" className="px-2.5 py-1 rounded-lg border text-brand font-semibold hover:bg-brand/10 disabled:opacity-50">{importing === String(r.towsoft_num) ? '⏳ Import…' : '⬇ Importer + facturer'}</button>
                    : <span className="text-ink-faint">consultation</span>}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-ink-muted">Aucun résultat.</p>)}
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(([k, lbl, f]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${tab === k ? 'bg-brand text-white border-brand' : 'bg-surface text-ink-secondary'}`}>{lbl} <span className="opacity-70">{scoped.filter(f).length}</span></button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-xs">
          <button onClick={() => setLot(new Set(visible.filter(lotEligible).map(d => d.root_id)))} disabled={!visible.some(lotEligible)} className="px-2.5 py-1.5 rounded-lg border text-ink-secondary hover:text-ink disabled:opacity-40">Tout cocher</button>
          <button onClick={runLot} disabled={lotBusy || lot.size === 0} className="px-3 py-1.5 rounded-lg bg-brand text-white font-semibold disabled:opacity-40">{lotBusy ? '⏳ Facturation…' : `🧾 Facturer le lot (${lot.size})`}</button>
        </span>
      </div>

      {visible.length === 0 && <div className="bg-surface border rounded-2xl p-8 text-center text-ink-muted text-sm">Rien dans cet onglet.</div>}

      {visible.map(d => {
        const rd = ready(d); const isOpen = open.has(d.root_id); const ai = autoInfo(d)
        const clients = Array.from(new Set(d.legs.filter(l => !isLegBilled(l) && !l.nothing_to_bill).map(l => l.billed_to_name || '—')))
        const lastEf = d.parquet?.efs?.length ? d.parquet.efs[d.parquet.efs.length - 1] : null
        const badge = isDone(d) ? ['bg-surface-2 text-ink-muted border', 'Facturé']
          : inComex(d) ? ['bg-sky-600 text-white', `🅣 COMEX · ${comexById[d.root_id]?.verdict === 'verify' ? 'à vérifier' : 'à valider chez Touring'}`]
          : isCircuit(d) ? ['bg-violet-600 text-white', d.parquet ? (lastEf ? `Parquet · EF n°${lastEf.numero ?? ''} ${lastEf.status === 'refuse' ? 'refusé' : lastEf.liquide_at ? 'liquidé' : 'en attente'}` : 'Parquet · EF à venir') : 'Domaine · relevé']
          : ai?.status === 'hexalite' ? ['bg-blue-600 text-white', '🟦 Clôture Allianz']
          : isAuto(d) ? ['bg-emerald-600 text-white', '🎯 Éligible auto']
          : ai?.status === 'waiting' && ai.eligibleAt ? ['bg-amber-500 text-white', `⏳ auto dans ${countdown(new Date(ai.eligibleAt).getTime() - now)}`]
          : d.state.open ? ['bg-blue-600 text-white', 'En cours']
          : ['bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', 'Prêt · manuel']
        return (
          <div key={d.root_id} className="bg-surface border rounded-2xl overflow-hidden">
            {/* Olivier 08/09/2026 : un clic ouvre le dossier (groupes repliés) ; on facture depuis là. */}
            <div onClick={() => { if (loadingBill || billing) return; router.push(`/dispatch/dossier/${d.root_id}?open=none`) }} title="Ouvrir le dossier"
              className="grid grid-cols-1 md:grid-cols-[minmax(200px,1.2fr)_minmax(160px,1fr)_minmax(200px,1.3fr)_130px_170px_auto] gap-3 items-center px-4 py-2.5 cursor-pointer hover:bg-surface-2/60">
              <div className="text-ink font-bold text-sm flex items-start gap-2">
                {lotEligible(d) && <input type="checkbox" checked={lot.has(d.root_id)} onClick={e => e.stopPropagation()} onChange={() => setLot(p => { const n = new Set(p); n.has(d.root_id) ? n.delete(d.root_id) : n.add(d.root_id); return n })} className="mt-0.5 accent-[var(--tw-brand,#1f4fd8)]" title="Ajouter au lot à facturer" />}
                <span>{d.ref} · <span className="font-mono">{d.vehicle.plate}</span>
                <span className="block text-[11px] font-medium text-ink-muted">{[d.vehicle.brand, d.vehicle.model].filter(Boolean).join(' ')} · {d.source_label}{d.legs.length === 1 ? ' · dépannage simple' : ''}</span></span></div>
              <div className="text-xs text-ink-secondary">{d.billed_to.name || '—'}
                <span className="block text-[11px] text-ink-muted">{clients.length > 1 ? `+ ${clients.filter(c => c !== d.billed_to.name).join(', ')}` : d.state.open ? d.state.reason : d.legs.some(l => l.ended_at) ? `terminé le ${fmtDay(d.legs[d.legs.length - 1].ended_at)}` : ''}</span></div>
              <div className="flex flex-wrap gap-1">
                {d.legs.map(l => (
                  <span key={l.letter} title={`${l.letter} ${l.title} · ${isLegBilled(l) ? 'facturé ' + cleanRef(l.billed_refs[0]) : l.nothing_to_bill ? l.nothing_to_bill : l.open && l.kind === 'gard' ? 'en cours' : 'prêt'}`}
                    className={`w-6 h-6 rounded-md border inline-flex items-center justify-center text-[11px] font-bold font-mono ${L_KIND[l.kind]} ${isLegBilled(l) ? 'opacity-35 line-through' : ''} ${l.open && l.kind === 'gard' ? 'border-dashed !bg-transparent !text-amber-700 dark:!text-amber-300' : ''} ${l.nothing_to_bill ? 'opacity-45' : ''}`}>{l.letter}</span>
                ))}
              </div>
              <div className="text-right tabular-nums text-sm">
                <span className={`font-semibold text-ink ${isPending(d) ? 'opacity-40' : ''}`}>{hasUnknown(d)
                  ? <span className="text-amber-700 dark:text-amber-300 font-normal" title={unknownTitle(d)}>{rest(d) > 0 ? eur(rest(d)) + ' + ' : ''}à calculer</span>
                  : eur(rest(d))}</span>
                <span className={`block text-[10.5px] font-normal text-ink-muted ${isPending(d) ? 'opacity-40' : ''}`}>reste HTVA</span>
                {isPending(d)
                  ? <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[10.5px] font-semibold text-brand motion-safe:animate-pulse"
                      title="Le montant affiché est le dernier connu — le tarif exact est en train d'être calculé">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-ping" />
                      Calcul en cours
                    </span>
                  : hasUnknown(d)
                  ? <span className="block text-[10.5px] font-normal text-amber-700 dark:text-amber-300 whitespace-normal leading-tight" title={unknownTitle(d)}>{unknownWhy(d)[0]}</span>
                  : <span className="block text-[12px] font-semibold text-ink-secondary" title="TVA 21 %">{eurTvac(rest(d))} TVAC</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${badge[0]}`} title={ai?.reason || ''}>{badge[1]}</span>
                {d.totals.collected > 0 && (
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap bg-warning-soft border border-warning text-warning"
                    title={`Déjà encaissé par le chauffeur (TVAC) — à déduire avant de facturer :\n${paidLabel(d)}`}>
                    💶 {eur(d.totals.collected)} encaissé
                  </span>
                )}
                {d.stamps?.domaine && <span className="px-2 py-0.5 bg-purple-600 text-white text-[11px] rounded-lg font-black uppercase tracking-widest border border-purple-300 shadow -rotate-2 whitespace-nowrap" title={d.stamps.domaine}>🏛 Domaine</span>}
                {d.stamps?.touring_check && (d.stamps.touring_check.toUpperCase().startsWith('ANWB')
                  ? <span className="px-2 py-0.5 bg-blue-600 text-white text-[11px] rounded-lg font-black uppercase tracking-widest border border-blue-300 shadow -rotate-2 whitespace-nowrap" title="Prise en charge ANWB (facturer à ANWB)">🇳🇱 {d.stamps.touring_check}</span>
                  : <span className="px-2 py-0.5 bg-surface-2 border text-ink-secondary text-[11px] rounded-lg font-semibold whitespace-nowrap" title="Check Touring">{d.stamps.touring_check}</span>)}
              </div>
              <div className="flex gap-1.5">
                {isCircuit(d)
                  ? <Link href={inComex(d) ? '/touring-comex' : d.parquet ? '/fourriere/saisies' : '/fourriere/domaine'} onClick={e => e.stopPropagation()} className="px-3 py-1.5 rounded-lg text-xs font-semibold border text-ink-secondary hover:text-ink">{inComex(d) ? 'Touring COMEX ↗' : d.parquet ? 'Module Saisie ↗' : 'Module Domaine ↗'}</Link>
                  : <button disabled={!rd.length && !d.legs.some(l => canPickLeg(l))} aria-busy={loadingBill === d.root_id} onClick={e => { e.stopPropagation(); if (loadingBill) return; openBilling(d) }} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${rd.length ? 'bg-brand text-white' : 'border text-ink-secondary'} disabled:opacity-40`}>{loadingBill === d.root_id ? '⏳ Calcul…' : `Facturer${d.state.open && rd.length ? ' (partiel)' : ''}`}</button>}
                {d.legs.some(l => l.billed_refs.some(r => /^brouillon Odoo/i.test(r))) && (
                  <button disabled={verifying === d.root_id} onClick={async e => { e.stopPropagation(); setVerifying(d.root_id); try { const r = await fetch(`/api/dossier/${d.root_id}/verify-invoices`, { method: 'POST' }); const j = await r.json().catch(() => ({})); setReport(j.message || j.error || `Erreur ${r.status}`); await refreshOne(d.root_id) } finally { setVerifying(null) } }} title="Relit Odoo : si le brouillon est confirmé, le numéro remplace le tampon" className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">{verifying === d.root_id ? '⏳' : '✓ Facturation OK'}</button>
                )}
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
                      <span className="tabular-nums text-right">{l.amount_unknown && !isLegBilled(l)
                        ? <span className="text-amber-700" title={l.amount_note || ''}>à calculer{l.amount_note ? ` · ${l.amount_note}` : ''}</span>
                        : <>{eur(l.amount_htva)}<span className="block text-[10.5px] text-ink-muted" title="TVA 21 %">{eurTvac(l.amount_htva)} TVAC</span></>}</span>
                      <span>{isLegBilled(l) ? <span className="px-1.5 py-0.5 rounded-full bg-surface border text-ink-muted font-mono">{cleanRef(l.billed_refs[0])}</span> : l.nothing_to_bill ? <span className="text-ink-faint">{l.nothing_to_bill}</span> : l.open && l.kind === 'gard' ? <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white">en cours</span> : <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">prêt</span>}</span>
                    </div>
                  ))}
                  <div className="mt-1.5 pt-1.5 border-t flex items-center justify-between gap-2 text-ink-secondary">
                    <span className="font-semibold">Total à facturer</span>
                    <span className="tabular-nums text-right font-semibold">{hasUnknown(d) ? <span className="text-amber-700">à calculer</span> : <>{eur(rest(d))}<span className="block text-[10.5px] font-normal text-ink-muted">{eurTvac(rest(d))} TVAC</span></>}</span>
                  </div>
                  {allPayments(d).length > 0 && (
                    <>
                      <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mt-3 mb-1">Encaissé sur place (TVAC)</p>
                      {allPayments(d).map((p, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 py-1 border-t first:border-t-0 text-ink-secondary">
                          <span>{p.mode || 'paiement'}{p.driver ? <span className="text-ink-muted"> · {p.driver}</span> : null}{p.at ? <span className="text-ink-muted"> · {fmtDay(p.at)}</span> : null}</span>
                          <span className="tabular-nums">{eur(p.amount)}</span>
                        </div>
                      ))}
                      <p className="mt-1 text-ink-muted">Déjà réglé par le client : à déduire de ce qu'on facture.</p>
                    </>
                  )}
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mb-1">Factures du dossier</p>
                  {d.parquet?.efs?.map(e => (
                    <div key={String(e.numero)} className="flex items-center justify-between gap-2 py-1 border-t first:border-t-0">
                      <span><span className="font-mono">EF n°{e.numero ?? '?'}</span> <span className="text-ink-muted">{e.from?.slice(0, 10)} → {e.to?.slice(0, 10)} · {e.status === 'refuse' ? 'refusé' : e.liquide_at ? 'liquidé le ' + fmtDay(e.liquide_at) : (e.status || 'envoyé')}{e.justinvoice ? ' · JustInvoice ' + e.justinvoice : ''}{e.include_depannage ? ' · dépannage inclus' : ''}</span></span>
                      <span className="tabular-nums">{eur(e.total_htva)}</span>
                    </div>
                  ))}
                  {d.invoices.length ? d.invoices.map(i => (
                    <div key={i.number} className="flex items-center justify-between gap-2 py-1 border-t first:border-t-0">
                      <span>{i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="text-brand font-mono hover:underline">{cleanRef(i.number)}</a> : <span className="font-mono">{cleanRef(i.number)}</span>} <span className="text-ink-muted">couvre {i.covers.join(' ')} · {i.client || '—'}{i.at ? ' · ' + fmtDay(i.at) : ''}</span></span>
                      <span className="tabular-nums">{eur(i.amount)}</span>
                    </div>
                  )) : (!d.parquet?.efs?.length && <p className="text-ink-muted">Aucune facture pour l'instant.</p>)}
                  {comexById[d.root_id] && <p className="mt-2 text-ink-muted border-l-2 pl-2">COMEX BKO : dossier {comexById[d.root_id].dossier || '—'} · montant Touring {comexById[d.root_id].montant != null ? eur(Number(comexById[d.root_id].montant)) : '—'} · {comexById[d.root_id].accepted_at ? `accepté le ${fmtDay(comexById[d.root_id].accepted_at)}` : (comexById[d.root_id].verdict === 'verify' ? 'écart à vérifier' : 'à valider chez Touring')}</p>}
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
      {billing && <BillingModal d={billing} onClose={() => setBilling(null)} onDone={async (res) => { const id = billing.root_id; if (res?.invoices?.length) { setBilling(null); setReport(`✓ ${res.invoices.length} facture(s) brouillon créée(s) dans Odoo pour le dossier — confirme-la(les) dans Odoo, le numéro remontera (bouton « Facturation OK » du dossier ou cron).`) } await refreshOne(id) }} />}
    </div>
  )
}

function countdown(ms: number): string {
  if (ms <= 0) return '0:00'
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), mn = Math.floor((t % 3600) / 60), s = t % 60
  return h > 0 ? `${h}h${String(mn).padStart(2, '0')}` : `${mn}:${String(s).padStart(2, '0')}`
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="bg-surface border rounded-xl px-3.5 py-2.5 text-[11px] text-ink-muted">{label}<b className="block text-lg text-ink tabular-nums font-semibold">{value}</b>{sub && <span className="block tabular-nums text-ink-secondary font-medium">{sub}</span>}</div>
}
