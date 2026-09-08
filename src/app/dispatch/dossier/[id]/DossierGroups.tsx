'use client'
// Vue dossier — écran. Un groupe par action (REM, gardiennage, REL…), lettré,
// chronologique, le dernier ouvert. Chaque groupe : résumé, client de
// facturation (hérité du dossier, modifiable), estimation de TOUT le dossier
// avec total, et « Ouvrir la fiche complète » = ta fiche dispatch actuelle en
// embed. Les mails sans action sont des lignes fines. Olivier 07/09/2026.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import MissionDetailClient from '@/app/dispatch/[id]/MissionDetailClient'
import CreateClientModal from '@/components/CreateClientModal'
import BillingModal from '@/components/dossier/BillingModal'
import EidImportButton, { type EidData } from '@/components/caisse/EidImportButton'
import ManualInfoButton, { type ManualClientData } from '@/components/caisse/ManualInfoButton'
import IdPhotoButton from '@/components/caisse/IdPhotoButton'
import { loadGoogleMaps } from '@/components/AddressField'

// Pays lu sur la carte d'identité → code ISO pour Odoo (même règle que la fiche).
const countryToIso = (name?: string | null) => {
  const c = (name || '').trim().toLowerCase()
  if (!c) return undefined
  if (/belg|belgi/.test(c)) return 'BE'
  if (/france|français/.test(c)) return 'FR'
  if (/pays.?bas|nederl|holland/.test(c)) return 'NL'
  if (/allemagne|deutsch|german/.test(c)) return 'DE'
  if (/luxemb/.test(c)) return 'LU'
  return undefined
}
import type { Dossier, DossierLeg } from '@/lib/dossier/build'

const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmt = (v: string | null) => v ? new Date(v).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
const fmtDay = (v: string | null) => v ? new Date(v).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit' }) : ''

// Le numéro de facture est parfois stocké avec son commentaire (« Déjà facturé
// avec numéro d'accord 2026AC001812 ») : on n'affiche que le numéro, le reste
// va dans le title du tampon.
const cleanRef = (raw: string) => {
  const m = raw.match(/([0-9]{4}\/[0-9]{2}\/[0-9A-Z-]+|[0-9]{4}[A-Z]{1,3}[0-9]{3,}|[A-Z]{1,3}-?[0-9]{4,}[A-Z0-9-]*|[0-9]{6,})\s*$/i)
  return m ? m[1] : raw
}
const refKind = (raw: string) => /accord/i.test(raw) ? 'n° d’accord' : /EF|état de frais|justinvoice/i.test(raw) ? 'état de frais' : 'facture'

// Tampon « FACTURÉ » avec le numéro, comme sur les cartes du module Facturation.
function Stamp({ refs, small }: { refs: string[]; small?: boolean }) {
  if (!refs.length) return null
  const raw = refs[0]
  return (
    <span title={refs.join(' · ')} className={`inline-flex items-center gap-1.5 ${small ? 'px-1.5 py-0 text-[10px]' : 'px-2.5 py-0.5 text-[11.5px]'} rounded-md font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300 border-[3px] border-emerald-600 bg-emerald-500/15 shadow -rotate-2 whitespace-nowrap`}>
      <span>Facturé</span><span className="font-mono normal-case tracking-normal font-bold">{cleanRef(raw)}</span>{refs.length > 1 && <span className="font-mono normal-case tracking-normal">+{refs.length - 1}</span>}
    </span>
  )
}

const KIND = {
  rem:  { label: 'Remorquage / dépannage', head: 'bg-blue-600/15 border-l-4 border-l-blue-600',       dot: 'bg-blue-600 text-white border-blue-700' },
  gard: { label: 'Gardiennage',            head: 'bg-amber-500/20 border-l-4 border-l-amber-500',     dot: 'bg-amber-500 text-white border-amber-600' },
  rel:  { label: 'Relivraison',            head: 'bg-emerald-600/15 border-l-4 border-l-emerald-600', dot: 'bg-emerald-600 text-white border-emerald-700' },
  out:  { label: 'Sortie',                 head: 'bg-violet-600/15 border-l-4 border-l-violet-600',   dot: 'bg-violet-600 text-white border-violet-700' },
} as const
const TONE = {
  ok:    'bg-emerald-600 text-white',
  warn:  'bg-amber-500 text-white',
  live:  'bg-blue-600 text-white',
  bad:   'bg-red-600 text-white',
  muted: 'bg-surface-2 text-ink-muted border',
} as const

export default function DossierGroups({ initial, fiches, shared, isSuperadmin, openMissionId, compact = false, mobile = false, startCollapsed = false }: {
  initial: Dossier; fiches: Record<string, any>; shared: any; isSuperadmin: boolean; openMissionId: string
  // compact : rendu dans une ligne dépliée de la liste dispatch — pas de
  // bandeau preview, pas de bouton Retour, marges réduites.
  compact?: boolean
  // mobile : vue 2 de la maquette téléphone (Olivier 07/09/2026) — lettres,
  // champs modifiables, « Facturer à » ; PAS de fiche complète dépliée, pas de
  // légende ni de faits secondaires. Tout tient dans la largeur de l'écran.
  mobile?: boolean
  // startCollapsed : arrivée depuis la recherche → aucun groupe déplié (Olivier 08/09/2026).
  startCollapsed?: boolean
}) {
  const router = useRouter()
  const goBack = () => { if (typeof window !== 'undefined' && window.history.length > 1) router.back(); else router.push('/dispatch') }
  const [d, setD] = useState<Dossier>(initial)
  // Montants, « Facturer à », estimation du dossier et bouton Facturer : réservés
  // au module Facturation et aux admins (même règle que /facturation). Un
  // dispatcher voit le dossier, ses groupes et ses états, sans les chiffres.
  const canBill = ['admin', 'superadmin'].includes(String(shared.userRole || '')) || (Array.isArray(shared.userModules) && shared.userModules.includes('facturation'))
  const [flagMode, setFlagMode] = useState('')
  // Le dispatch doit voir la mission ENTIÈRE d'emblée (Olivier 07/09) : le
  // dernier groupe est déplié ET sa fiche complète est ouverte. Si le dernier
  // groupe n'est pas une fiche (Domaine, Sortie), on ouvre aussi la dernière
  // fiche réelle avec son embed.
  const initialTarget = initial.legs.find(l => l.mission_id === openMissionId) || initial.legs[initial.legs.length - 1]
  const lastFiche = [...initial.legs].reverse().find(l => l.kind !== 'out')
  const [open, setOpen] = useState<Set<string>>(() => startCollapsed ? new Set() : new Set([initialTarget?.letter, initialTarget?.kind === 'out' ? lastFiche?.letter : undefined].filter(Boolean) as string[]))
  const [embed, setEmbed] = useState<Set<string>>(() => {
    if (mobile || startCollapsed) return new Set()
    const t = initialTarget && initialTarget.kind !== 'out' ? initialTarget : lastFiche
    return new Set(t ? [t.letter] : [])
  })
  const [billing, setBilling] = useState(false)
  // Ne jamais ouvrir Facturer sur des montants légers/non recalculés : un remorquage
  // non figé y vaut 0 € et n'est pas cochable (2GUV245, Jona, 08/09/2026).
  const [openingBilling, setOpeningBilling] = useState(false)
  const billable = d.legs.filter(l => !l.nothing_to_bill && !(l.billed_refs.length && l.billed_htva >= l.amount_htva - 0.01) && l.amount_htva > 0)
  const toggle = (l: string) => setOpen(p => { const n = new Set(p); n.has(l) ? n.delete(l) : n.add(l); return n })
  const toggleEmbed = (l: string) => setEmbed(p => { const n = new Set(p); n.has(l) ? n.delete(l) : n.add(l); return n })

  // Client de facturation : mise à jour IMMÉDIATE de l'état du dossier après le
  // PATCH (le bouton Facturer et la modale lisent `d`), puis recalcul en fond.
  // Olivier 08/09/2026 : « qu'on ne doive pas faire de refresh pour que le
  // bouton Facturer affiche les infos modifiées ».
  const applyBilledTo = (ids: string[], c: { id: number | null; name: string | null }) => setD(prev => ({
    ...prev,
    billed_to: ids.includes(prev.root_id) ? { ...prev.billed_to, id: c.id, name: c.name } : prev.billed_to,
    legs: prev.legs.map(l => ids.includes(l.mission_id) ? { ...l, billed_to_id: c.id, billed_to_name: c.name, billed_inherited: ids.includes(prev.root_id) || (c.id ?? null) === (prev.billed_to.id ?? null) } : l),
  }))
  const [refining, setRefining] = useState(false)
  const refresh = async () => {
    try { const r = await fetch(`/api/dossier/${d.root_id}?t=${Date.now()}`, { cache: 'no-store' }); const j = await r.json(); if (j?.dossier) setD(j.dossier); else console.warn('[dossier] refresh KO', r.status, j?.error) } catch (e) { console.warn('[dossier] refresh KO', e) }
  }
  // Ouverture immédiate avec les montants figés, puis recalcul des tarifs en
  // arrière-plan (moteur de prix + itinéraires) pour qui les voit.
  useEffect(() => {
    if (!initial.light || !canBill) return
    let cancelled = false
    setRefining(true)
    fetch(`/api/dossier/${initial.root_id}?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (!cancelled && j?.dossier) setD(j.dossier) }).catch(() => {}).finally(() => { if (!cancelled) setRefining(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.root_id])

  useEffect(() => {
    if (!isSuperadmin) return
    fetch('/api/admin/feature-flags').then(r => r.json()).then(j => {
      const f = (j.flags || []).find((x: any) => x.key === 'dossier_view'); if (f) setFlagMode(f.mode)
    }).catch(() => {})
  }, [isSuperadmin])
  const setMode = async (mode: string) => {
    setFlagMode(mode)
    await fetch('/api/admin/feature-flags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'dossier_view', mode }) }).catch(() => {})
  }

  // Groupes + événements fusionnés dans l'ordre du temps.
  const timeline = useMemo(() => {
    const items: Array<{ t: number; leg?: DossierLeg; ev?: Dossier['events'][number] }> = []
    for (const leg of d.legs) items.push({ t: leg.started_at ? new Date(leg.started_at).getTime() : 0, leg })
    for (const ev of d.events) items.push({ t: ev.at ? new Date(ev.at).getTime() : 0, ev })
    // À date égale (REM créé à la mise en parc), l'ordre des lettres fait foi :
    // A avant B, jamais l'inverse. Un événement à la même date passe après.
    const rank = (x: typeof items[number]) => x.leg ? d.legs.indexOf(x.leg) : d.legs.length + 1
    return items.sort((a, b) => a.t - b.t || rank(a) - rank(b))
  }, [d])

  const vehicle = [d.vehicle.brand, d.vehicle.model].filter(Boolean).join(' ')

  return (
    <div className={`${compact ? 'px-2 py-3' : 'px-3 lg:px-6 py-5'} space-y-3 max-w-full overflow-x-hidden ${mobile ? 'break-words [&_.font-mono]:break-all' : ''}`}>

      {isSuperadmin && !compact && (
        <div className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-2">
          <span className="text-amber-700 dark:text-amber-300 text-xs font-semibold">🧪 Preview « Vue dossier » — visible par toi seul tant que le flag est sur « Moi »</span>
          <div className="flex items-center gap-1">
            {([['off', 'Off'], ['superadmin', 'Moi'], ['all', 'Tout le monde']] as const).map(([m, lbl]) => (
              <button key={m} onClick={() => setMode(m)} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${flagMode === m ? 'bg-amber-500 text-white' : 'bg-surface border text-ink-secondary hover:text-ink'}`}>{lbl}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── En-tête du dossier ── */}
      <div className="bg-surface border rounded-2xl overflow-hidden">
        <div className={`${mobile ? 'px-3' : 'px-5'} py-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-x-6 gap-y-2 items-start min-w-0`}>
          <div>
            <h1 className="text-ink font-bold text-lg flex flex-wrap items-center gap-2">
              {!compact && <button onClick={goBack} title="Retour à l'écran précédent" className="px-2.5 py-1 rounded-lg border bg-surface text-ink-secondary hover:text-ink text-sm font-semibold">← <span className="hidden sm:inline">Retour</span></button>}
              {compact && !mobile && <Link href={`/dispatch/dossier/${d.root_id}?open=${openMissionId}`} target="_blank" className="px-2.5 py-1 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-hover">Vue complète ↗</Link>}
              Dossier {d.ref}
              <span className="text-xs font-semibold text-ink-secondary bg-surface-2 border rounded-lg px-2 py-0.5">{d.source_label}</span>
              {d.dossier_number && <span className="text-xs font-mono text-ink-secondary bg-surface-2 border rounded-lg px-2 py-0.5">{d.dossier_number}</span>}
              <span className={`text-xs font-bold rounded-lg px-2.5 py-0.5 shadow-sm ${d.state.open ? TONE.live : TONE.ok}`}>{d.state.open ? `En cours · ${d.state.reason}` : 'Terminé'}</span>
            </h1>
            <p className="text-ink-secondary text-sm mt-0.5">{vehicle}{d.vehicle.plate ? <> · <span className="font-mono">{d.vehicle.plate}</span></> : null}{d.vehicle.vin ? <span className="text-ink-faint"> · VIN <span className="font-mono">{d.vehicle.vin}</span></span> : null}</p>
            <p className="text-ink-muted text-xs mt-0.5">{d.client.name ? `Client sur place : ${d.client.name}${d.client.phone ? ' · ' + d.client.phone : ''}` : 'Client sur place : —'} · reçu le {fmt(d.received_at)}</p>
            {/* Olivier 08/09/2026 : bloc relivraison en tête de dossier, entre le client
                sur place et le fil de suivi. Même adresse (racine) que dans les groupes. */}
            {(() => { const rootLeg = d.legs.find(l => l.mission_id === d.root_id) || d.legs[0]; return rootLeg && rootLeg.kind !== 'rel' && rootLeg.kind !== 'out' ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs bg-surface-2 border rounded-xl px-3 py-1.5">
                <span className="text-ink-muted font-semibold">🚚 Relivraison</span>
                <span className="min-w-0 flex-1"><EditableAddress value={rootLeg.redelivery_address} field="redelivery" missionId={d.root_id} gmKey={shared.googleMapsKey} onSaved={refresh} placeholder="adresse de relivraison à définir" /></span>
                <RelivrerFromDossier d={d} leg={rootLeg} />
              </div>
            ) : null })()}
          </div>
          {canBill && <div className="md:text-right">
            <div className="flex md:justify-end items-center gap-2 flex-wrap">
              {(() => { const rootLeg = d.legs.find(l => l.mission_id === d.root_id) || d.legs[0]; return rootLeg ? <BillingRow d={d} leg={rootLeg} onChanged={refresh} gmKey={shared.googleMapsKey} allLegs onApplied={applyBilledTo} /> : null })()}
              <button disabled={!billable.length || openingBilling} onClick={async () => { if (d.light || refining) { setOpeningBilling(true); try { await refresh() } finally { setOpeningBilling(false) } } setBilling(true) }} title={billable.length ? 'Une facture Odoo par client, créée directement' : 'Rien à facturer'} className={`px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-white ${billable.length ? 'hover:bg-brand-hover' : 'opacity-40 cursor-not-allowed'}`}>Facturer{billable.length ? ` (${billable.length})` : ''}</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-[11px] text-ink-muted md:justify-items-end">
              <div>Estimé HTVA<b className="block text-ink text-sm tabular-nums">{eur(d.totals.estimated)}</b></div>
              <div>Facturé<b className="block text-ink text-sm tabular-nums">{eur(d.totals.billed)}</b></div>
              <div>Encaissé<b className="block text-ink text-sm tabular-nums">{eur(d.totals.collected)}</b></div>
              <div>Reste<b className="block text-ink text-sm tabular-nums">{eur(d.totals.remaining)}</b></div>
            </div>
            {refining && <p className="text-[11px] text-brand mt-1 animate-pulse">⏳ Calcul des tarifs en cours…</p>}
            {d.state.open && <p className="text-[11px] text-ink-faint mt-1">Dossier en cours : pas de facturation automatique avant la sortie du véhicule.</p>}
          </div>}
        </div>
        {/* Frise */}
        <div className="border-t px-3 md:px-5 py-2.5 flex items-center overflow-x-auto gap-0 max-w-full">
          {timeline.map((it, i) => it.leg ? (
            <div key={`l${it.leg.letter}`} className="flex items-center flex-shrink-0">
              <button onClick={() => { toggle(it.leg!.letter); document.getElementById(`grp-${it.leg!.letter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                className={`w-8 h-8 rounded-lg border flex items-center justify-center text-[11px] font-bold font-mono shadow-sm ${KIND[it.leg.kind].dot} ${it.leg.open ? 'ring-2 ring-offset-1 ring-brand' : ''}`} title={it.leg.title}>{it.leg.letter}</button>
              <div className="ml-2 mr-3">
                <p className="text-xs font-semibold text-ink leading-tight">{it.leg.title}</p>
                <p className="text-[10.5px] text-ink-muted leading-tight">{fmtDay(it.leg.started_at)}{it.leg.ended_at ? ` → ${fmtDay(it.leg.ended_at)}` : it.leg.open ? ' → …' : ''}{it.leg.driver_name ? ` · ${it.leg.driver_name}` : ''}</p>
              </div>
              {i < timeline.length - 1 && <div className="w-5 h-0.5 bg-border mr-3" />}
            </div>
          ) : (
            <div key={`e${i}`} className="flex items-center flex-shrink-0">
              <div className="w-2.5 h-2.5 rounded-full border border-dashed border-ink-faint mx-2" title={it.ev!.label} />
              <div className="mr-3"><p className="text-[10.5px] text-ink-muted leading-tight max-w-[160px] truncate">{it.ev!.label}</p><p className="text-[10px] text-ink-faint leading-tight">{fmtDay(it.ev!.at)}</p></div>
              {i < timeline.length - 1 && <div className="w-5 h-0.5 bg-border mr-3" />}
            </div>
          ))}
        </div>
      </div>

      {!mobile && <div className="flex flex-wrap gap-3 text-[11px] text-ink-muted px-1">
        {(Object.keys(KIND) as Array<keyof typeof KIND>).map(k => <span key={k}><i className={`inline-block w-2.5 h-2.5 rounded-sm mr-1 align-[-1px] ${KIND[k].dot}`} />{KIND[k].label}</span>)}
        <span><i className="inline-block w-2.5 h-2.5 rounded-full border border-dashed border-ink-faint mr-1 align-[-1px]" />Mail reçu, sans action</span>
      </div>}

      {/* ── Groupes + événements ── */}
      {timeline.map((it, i) => it.ev ? (
        <div key={`ev${i}`} className="ml-5 pl-3 border-l-2 border-dashed border-border text-xs text-ink-muted flex flex-wrap items-center gap-x-2 py-1">
          <span className="font-semibold text-ink-secondary">{fmt(it.ev.at)}</span>
          <span>{it.ev.label}</span>
          {it.ev.detail && <span className="text-ink-faint">· {it.ev.detail}</span>}
          {it.ev.kind === 'a_verifier' && <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${TONE.warn}`}>à vérifier</span>}
          {it.ev.kind === 'autre_dossier'
            ? <Link href={`/dispatch/dossier/${it.ev.mission_id}`} className="text-brand hover:underline">ouvrir ce dossier</Link>
            : <Link href={`/dispatch/${it.ev.mission_id}`} className="text-brand hover:underline">voir la fiche</Link>}
          {(it.ev.kind === 'orphan' || it.ev.kind === 'a_verifier') && (
            <button onClick={async () => {
              if (!window.confirm('Rattacher ce mail à ce dossier ? Il apparaîtra dans sa chronologie.')) return
              const r = await fetch(`/api/dossier/${d.root_id}/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_id: it.ev!.mission_id }) })
              const j = await r.json().catch(() => ({})); if (!r.ok) { alert(j.error || `HTTP ${r.status}`); return } await refresh()
            }} className="px-2 py-0.5 rounded-lg border text-[11px] font-semibold text-ink-secondary hover:text-ink">Rattacher à ce dossier</button>
          )}
        </div>
      ) : (
        <Group key={it.leg!.letter} d={d} leg={it.leg!} canBill={canBill} isOpen={open.has(it.leg!.letter)} onToggle={() => toggle(it.leg!.letter)}
          embedOpen={embed.has(it.leg!.letter)} onToggleEmbed={() => toggleEmbed(it.leg!.letter)} fiche={fiches[it.leg!.mission_id]} shared={shared} onChanged={refresh} mobile={mobile} onApplied={applyBilledTo} />
      ))}

      {!mobile && <p className="text-[11px] text-ink-faint px-1 pt-2">Les fiches Gardiennage sont créées automatiquement à la mise en parc et n'apparaissent que sur cet écran. « Facturer » crée directement les factures Odoo en brouillon, une par client.</p>}

      {billing && <BillingModal d={d} onClose={() => setBilling(false)} onDone={async () => { await refresh() }} />}
    </div>
  )
}

// ── Un groupe ─────────────────────────────────────────────────────────────
function Group({ d, leg, canBill, isOpen, onToggle, embedOpen, onToggleEmbed, fiche, shared, onChanged, mobile = false, onApplied }: {
  d: Dossier; leg: DossierLeg; canBill: boolean; isOpen: boolean; onToggle: () => void; embedOpen: boolean; onToggleEmbed: () => void; fiche: any; shared: any; onChanged: () => void; mobile?: boolean; onApplied?: (ids: string[], c: { id: number | null; name: string | null }) => void
}) {
  const k = KIND[leg.kind]
  return (
    <div id={`grp-${leg.letter}`} className={`border rounded-2xl overflow-hidden bg-surface ${leg.open ? 'border-brand/50' : ''}`}>
      <button onClick={onToggle} className={`w-full grid grid-cols-[44px_minmax(0,1fr)_auto] gap-2 md:gap-3 items-center px-3 md:px-3.5 py-2.5 text-left ${k.head} hover:brightness-95 transition`}>
        <span className={`h-9 w-9 rounded-lg border flex items-center justify-center text-sm font-bold font-mono shadow-sm ${k.dot}`} title={d.number != null ? `${d.number}${leg.letter}` : leg.letter}>{leg.letter}</span>
        <span className="min-w-0">
          <span className="block text-ink text-sm font-semibold truncate">{leg.title}{leg.subtitle && <span className="text-ink-muted font-normal"> · {leg.subtitle}</span>}</span>
          <span className="block text-ink-secondary text-xs truncate">
            {leg.driver_name ? `${leg.driver_name} · ` : ''}{fmt(leg.started_at)}{leg.ended_at ? ` → ${fmt(leg.ended_at)}` : ''}{leg.days != null ? ` · ${leg.days} j` : ''}
            {canBill ? (leg.nothing_to_bill ? ` · ${leg.nothing_to_bill}` : ` · ${eur(leg.amount_htva)} HTVA`) : ''}
          </span>
        </span>
        <span className="flex items-center gap-2 flex-shrink-0 max-w-[45%] md:max-w-none">
          {leg.billed_refs.length > 0 && leg.billed_htva >= leg.amount_htva - 0.01
            ? <Stamp refs={leg.billed_refs} />
            : <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 truncate ${TONE[leg.status_tone]}`} title={leg.status_label}>{leg.status_label}</span>}
          <span className="text-ink-muted text-sm">{isOpen ? '▾' : '▸'}</span>
        </span>
      </button>

      {isOpen && (
        <div className={`border-t px-3 md:px-3.5 py-3 ${mobile ? '' : 'md:pl-[70px]'} space-y-3 min-w-0 max-w-full overflow-x-hidden`}>
          {/* Gardiennage en cours = c'est ici que vit la relivraison (adresse + action).
              Olivier 08/09/2026 : « donc tu n'affiches le bloc relivraison que dans A ? » */}
          {/* Olivier 08/09 : « le module relivraison présent sur toutes les fiches des groupes ». */}
          {leg.kind !== 'rel' && leg.kind !== 'out' && (
            <div className="grid grid-cols-1 gap-y-1 text-xs bg-surface-2 border rounded-xl px-3 py-2">
              <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2 items-center"><dt className="text-ink-muted">Relivraison</dt><dd>
                <EditableAddress value={leg.redelivery_address} field="redelivery" missionId={d.root_id} gmKey={shared.googleMapsKey} onSaved={onChanged} placeholder="adresse de relivraison à définir" /></dd></div>
              <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2 items-center"><dt className="text-ink-muted">Action</dt><dd><RelivrerFromDossier d={d} leg={leg} /></dd></div>
            </div>
          )}
          {leg.editable && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs bg-surface-2 border rounded-xl px-3 py-2">
              {/* Olivier 07/09/2026 : tout ce qui est modifiable l'est ici, sans ouvrir la fiche. */}
              <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2 items-center"><dt className="text-ink-muted">Type</dt><dd className="flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                <EditableSelect value={leg.editable.mission_type} missionId={leg.mission_id} field="mission_type" onSaved={onChanged}
                  options={[['remorquage', 'REM — remorquage'], ['depannage', 'DSP — dépannage sur place'], ['relivraison', 'REL — relivraison'], ['transport', 'Transport'], ['trajet_vide', 'TVD — trajet à vide']]} />
                <EditableSelect value={leg.editable.source} missionId={leg.mission_id} field="source" onSaved={onChanged}
                  options={(shared.sources || []).map((x: any) => [x.key, x.label])} /></dd></div>
              <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2 items-center"><dt className="text-ink-muted">Réf. assistance</dt><dd className="flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                <EditableText value={leg.editable.dossier_number} placeholder="référence du dossier assistance" missionId={leg.mission_id} field="dossier_number" onSaved={onChanged} mono />
                <EditableDateTime value={leg.editable.intervention_date} missionId={leg.mission_id} field="intervention_date" onSaved={onChanged} /></dd></div>
              <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2 items-center"><dt className="text-ink-muted">Client</dt><dd className="flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                <EditableText value={leg.editable.client_name} placeholder="nom du client" missionId={leg.mission_id} field="client_name" onSaved={onChanged} />
                <EditableText value={leg.editable.client_phone} placeholder="téléphone" missionId={leg.mission_id} field="client_phone" onSaved={onChanged} mono />
                <EditableText value={leg.editable.client_address} placeholder="adresse du client" missionId={leg.mission_id} field="client_address" onSaved={onChanged} /></dd></div>
              <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2 items-center"><dt className="text-ink-muted">Assisté</dt><dd className="flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                <EditableText value={leg.editable.assisted_name} placeholder="nom de l’assisté (si ≠ client)" missionId={leg.mission_id} field="assisted_name" onSaved={onChanged} />
                <EditableText value={leg.editable.assisted_phone} placeholder="téléphone" missionId={leg.mission_id} field="assisted_phone" onSaved={onChanged} mono /></dd></div>
              <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2 items-center"><dt className="text-ink-muted">Véhicule</dt><dd className="flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                <EditableText value={leg.editable.vehicle_plate} placeholder="plaque" missionId={leg.mission_id} field="vehicle_plate" onSaved={onChanged} mono upper />
                <EditableText value={leg.editable.vehicle_brand} placeholder="marque" missionId={leg.mission_id} field="vehicle_brand" onSaved={onChanged} />
                <EditableText value={leg.editable.vehicle_model} placeholder="modèle" missionId={leg.mission_id} field="vehicle_model" onSaved={onChanged} />
                <EditableText value={leg.editable.vehicle_vin} placeholder="VIN" missionId={leg.mission_id} field="vehicle_vin" onSaved={onChanged} mono upper />
                <EditableText value={leg.editable.vehicle_fuel} placeholder="carburant" missionId={leg.mission_id} field="vehicle_fuel" onSaved={onChanged} />
                <EditableText value={leg.editable.vehicle_gearbox} placeholder="boîte" missionId={leg.mission_id} field="vehicle_gearbox" onSaved={onChanged} />
                <EditableText value={leg.editable.vehicle_mileage} placeholder="km" missionId={leg.mission_id} field="vehicle_mileage" onSaved={onChanged} mono /></dd></div>
              <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2 items-center"><dt className="text-ink-muted">Incident</dt><dd className="flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                <EditableText value={leg.editable.incident_type} placeholder="type d’incident" missionId={leg.mission_id} field="incident_type" onSaved={onChanged} />
                <EditableText value={leg.editable.incident_description} placeholder="description" missionId={leg.mission_id} field="incident_description" onSaved={onChanged} /></dd></div>
              <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2 items-center"><dt className="text-ink-muted">{leg.kind === 'rel' ? 'Départ' : 'Intervention'}</dt><dd>
                <EditableAddress value={leg.editable.incident_address} field="incident" missionId={leg.mission_id} gmKey={shared.googleMapsKey} onSaved={onChanged} /></dd></div>
              <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2 items-center"><dt className="text-ink-muted">{leg.kind === 'rel' ? 'Livrer à' : 'Destination'}</dt><dd className="space-y-0.5">
                <EditableText value={leg.editable.destination_name} placeholder="nom du lieu (garage, hôtel…)" missionId={leg.mission_id} field="destination_name" onSaved={onChanged} />
                <EditableAddress value={leg.editable.destination_address} field="destination" missionId={leg.mission_id} gmKey={shared.googleMapsKey} onSaved={onChanged} placeholder={/d[ée]pannage|sur place/i.test(leg.title) ? 'sur place' : 'à définir'} /></dd></div>
              <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2 items-center md:col-span-2"><dt className="text-ink-muted">Remarque</dt><dd>
                <EditableText value={leg.editable.remarks_general} placeholder="remarque dispatch" missionId={leg.mission_id} field="remarks_general" onSaved={onChanged} /></dd></div>
            </div>
          )}
          {!mobile && <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {leg.facts.filter(f => !leg.editable || !['Chauffeur', 'Intervention', 'Départ', 'Destination', 'Livré à'].includes(f.label) || f.label === 'Chauffeur').map((f, i) => (
              <div key={i} className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2"><dt className="text-ink-muted">{f.label}</dt><dd className="text-ink break-words min-w-0">{f.value}</dd></div>
            ))}
            {leg.payments?.length > 0 && <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2"><dt className="text-ink-muted">Encaissé</dt><dd className="text-ink">{leg.payments.map((p, i) => <span key={i} className="mr-2">{eur(p.amount)}{p.mode ? ` (${p.mode})` : ''}{p.driver ? ` · ${p.driver}` : ''}{p.at ? ` · ${fmt(p.at)}` : ''}</span>)}</dd></div>}
            {canBill && leg.amount_note && <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2"><dt className="text-ink-muted">Estimation</dt><dd className="text-ink">{leg.nothing_to_bill ? leg.nothing_to_bill : <>{leg.amount_note} = <b>{eur(leg.amount_htva)} HTVA</b></>}</dd></div>}
            {canBill && leg.billed_refs.length > 0 && <div className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[110px_1fr] gap-2 items-center"><dt className="text-ink-muted">Facturé</dt><dd className="text-ink flex flex-wrap items-center gap-2">{eur(leg.billed_htva)} <Stamp refs={leg.billed_refs} small /> <span className="text-ink-faint text-[11px]">{refKind(leg.billed_refs[0])}</span></dd></div>}
          </dl>}

          {leg.billing_remarks?.length > 0 && (
            <div className="bg-slate-800 text-white rounded-xl px-3 py-2 text-xs space-y-1">
              {leg.billing_remarks.map((r, i) => <p key={i}><span className="text-slate-300">📝 Remarque de facturation{r.author ? ' · ' + r.author : ''} : </span><span className="font-semibold whitespace-pre-line">{r.text}</span></p>)}
            </div>
          )}
          {canBill && leg.kind !== 'out' && leg.channel !== 'parquet' && <BillingRow d={d} leg={leg} onChanged={onChanged} gmKey={shared.googleMapsKey} onApplied={onApplied} />}
          {canBill && leg.channel === 'parquet' && (
            <div className="bg-surface-2 border border-dashed rounded-xl px-3 py-2 text-xs text-ink-secondary flex flex-wrap items-center gap-2">
              <span>Circuit <b>Parquet</b> : réglé par état de frais (module Saisie, JustInvoice), pas par une facture Odoo de ce dossier.</span>
              {d.parquet?.efs?.length ? <span className="text-ink-muted">{d.parquet.efs.map(e => `EF n°${e.numero ?? '?'} ${e.status === 'refuse' ? 'refusé' : e.liquide_at ? 'liquidé' : (e.status || 'envoyé')}`).join(' · ')}</span> : null}
              <Link href="/fourriere/saisies" className="ml-auto px-2 py-0.5 rounded-lg border bg-surface text-ink-secondary hover:text-ink font-semibold">Module Saisie ↗</Link>
            </div>
          )}
          {canBill && leg.kind === 'out' && leg.channel === 'domaine' && <div className="bg-surface-2 border border-dashed rounded-xl px-3 py-2 text-xs text-ink-secondary">Facturé au <b>SPF Finances — Domaine</b> par le relevé trimestriel (Fourrière → Domaine), pas par une facture Odoo de ce dossier.</div>}

          {canBill && !mobile && <EstimationTable d={d} me={leg.letter} />}

          {leg.kind !== 'out' && !mobile && (
            <div className="flex flex-wrap gap-1.5">
              {fiche
                ? <button onClick={onToggleEmbed} className="px-2.5 py-1 rounded-lg text-xs font-semibold border bg-surface text-ink-secondary hover:text-ink">{embedOpen ? 'Replier la fiche complète' : 'Ouvrir la fiche complète'}</button>
                : <Link href={`/dispatch/dossier/${d.root_id}?open=${leg.mission_id}`} target="_blank" className="px-2.5 py-1 rounded-lg text-xs font-semibold border bg-surface text-ink-secondary hover:text-ink">Ouvrir ce groupe dans le dossier ↗</Link>}
              <Link href={`/dispatch/${leg.mission_id}?fiche=1`} className="px-2.5 py-1 rounded-lg text-xs font-semibold border bg-surface text-ink-secondary hover:text-ink">Fiche seule ↗</Link>
            </div>
          )}
          {leg.kind === 'out' && leg.channel === 'domaine' && (
            <div className="flex flex-wrap gap-1.5"><Link href="/fourriere/domaine" className="px-2.5 py-1 rounded-lg text-xs font-semibold border bg-surface text-ink-secondary hover:text-ink">Module Domaine ↗</Link></div>
          )}

          {embedOpen && fiche && leg.kind !== 'out' && (
            <div className={`border rounded-xl bg-page overflow-x-auto max-w-full ${mobile ? '' : 'md:-ml-[56px]'}`}>
              {mobile && <button onClick={onToggleEmbed} className="m-2 px-2.5 py-1 rounded-lg text-xs font-semibold border bg-surface text-ink-secondary">Replier la fiche</button>}
              <MissionDetailClient
                mission={fiche.mission} logs={fiche.logs} drivers={shared.drivers} sources={shared.sources}
                linkedParent={fiche.linkedParent} linkedChild={fiche.linkedChild}
                userName={shared.userName} userEmail={shared.userEmail} userId={shared.userId} userRole={shared.userRole}
                userModules={shared.userModules} userHasOdooAccess={shared.userHasOdooAccess} googleMapsKey={shared.googleMapsKey}
                autoDispatchStatus={fiche.autoDispatchStatus} parcZoneType={fiche.parcZoneType} embed
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Adresse modifiable sur place (Olivier 07/09/2026 : « quand je modifie une
// adresse dans la liste, ça redirige sur la fiche complète, c'est pas
// friendly ») : même recherche Google que la fiche, coordonnées persistées
// (géocodage = navigateur), le moteur de prix se recalcule côté API.
function EditableAddress({ value, field, missionId, gmKey, onSaved, placeholder = 'adresse à définir' }: {
  value: string | null; field: 'incident' | 'destination' | 'redelivery'; missionId: string; gmKey?: string; onSaved: () => void | Promise<void>; placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Suggestions Google rendues DANS la ligne (boutons), pas la liste flottante
  // de Google qui répond mal au toucher sur iPhone (Olivier 07/09/2026 :
  // « les adresses ne sont pas connectées à l'autocomplete »).
  const [preds, setPreds] = useState<{ id: string; main: string; sub: string }[]>([])
  const [gm, setGm] = useState<'loading' | 'ok' | 'ko'>('loading')
  const tokenRef = useRef<any>(null)
  const timerRef = useRef<any>(null)
  useEffect(() => { if (!editing) setV(value || '') }, [value, editing])
  useEffect(() => {
    if (!editing) return
    let dead = false
    loadGoogleMaps(gmKey || '').then(() => { if (!dead) { setGm('ok'); tokenRef.current = new (window as any).google.maps.places.AutocompleteSessionToken() } })
      .catch(() => { if (!dead) setGm('ko') })
    return () => { dead = true }
  }, [editing, gmKey])
  const search = (q: string) => {
    setV(q)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!q.trim() || gm !== 'ok') { setPreds([]); return }
    timerRef.current = setTimeout(() => {
      const g = (window as any).google
      try {
        new g.maps.places.AutocompleteService().getPlacePredictions({
          input: q, sessionToken: tokenRef.current, componentRestrictions: { country: ['be', 'lu', 'fr', 'nl', 'de'] },
          bounds: new g.maps.LatLngBounds({ lat: 49.49, lng: 2.51 }, { lat: 51.51, lng: 6.41 }),
        }, (res: any[], status: string) => {
          if (status !== g.maps.places.PlacesServiceStatus.OK || !res) { setPreds([]); return }
          setPreds(res.slice(0, 5).map(r => ({ id: r.place_id, main: r.structured_formatting?.main_text || r.description, sub: r.structured_formatting?.secondary_text || '' })))
        })
      } catch { setPreds([]) }
    }, 220)
  }
  const pick = (id: string) => {
    const g = (window as any).google
    setBusy(true)
    new g.maps.places.PlacesService(document.createElement('div')).getDetails({ placeId: id, sessionToken: tokenRef.current, fields: ['name', 'formatted_address', 'geometry', 'address_components', 'types'] }, (p: any, status: string) => {
      if (status !== g.maps.places.PlacesServiceStatus.OK || !p?.geometry) { setBusy(false); setErr('Adresse introuvable chez Google'); return }
      const addr = p.formatted_address || ''
      const isEstab = (p.types || []).some((t: string) => t === 'establishment' || t === 'point_of_interest')
      const display = isEstab && p.name && !addr.startsWith(p.name) ? `${p.name}, ${addr}` : addr
      const cityComp = (p.address_components || []).find((c: any) => c.types.includes('locality')) || (p.address_components || []).find((c: any) => c.types.includes('postal_town'))
      setV(display); setPreds([])
      save(display, p.geometry.location.lat(), p.geometry.location.lng(), cityComp?.long_name)
    })
  }
  const save = async (addr: string, lat: number | null, lng: number | null, city?: string) => {
    setBusy(true); setErr(null)
    try {
      const body: Record<string, any> = field === 'incident'
        ? { incident_address: addr || null, incident_lat: lat, incident_lng: lng, ...(city ? { incident_city: city } : {}) }
        : field === 'destination'
          ? { destination_address: addr || null, destination_lat: lat, destination_lng: lng }
          : { redelivery_address: addr || null, redelivery_lat: lat, redelivery_lng: lng }
      const r = await fetch(`/api/missions/${missionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`) }
      setEditing(false); setPreds([]); await onSaved()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }
  if (!editing) return (
    <button type="button" onClick={() => setEditing(true)} title="Toucher pour modifier"
      className={`text-left rounded px-1 -mx-1 hover:bg-brand/10 hover:ring-1 hover:ring-brand/30 break-words ${value ? 'text-ink' : 'text-ink-faint italic'}`}>
      {value || placeholder} <span className="text-ink-faint">✎</span>{err && <span className="ml-1 text-red-600 not-italic">⚠ {err}</span>}
    </button>
  )
  return (
    <div className="space-y-1.5 min-w-0">
      <input autoFocus value={v} disabled={busy} onChange={e => search(e.target.value)} placeholder="Tape l’adresse…" autoComplete="off"
        onKeyDown={e => { if (e.key === 'Escape') { setV(value || ''); setPreds([]); setEditing(false) } }}
        className="border rounded-lg px-2 py-1.5 bg-surface text-ink text-sm w-full min-w-0" />
      {gm === 'ko' && <p className="text-amber-700 text-xs">Google indisponible : l’adresse sera gardée sans coordonnées.</p>}
      {preds.length > 0 && (
        <div className="border rounded-lg overflow-hidden bg-surface divide-y">
          {preds.map(p => (
            <button key={p.id} type="button" disabled={busy} onClick={() => pick(p.id)} className="w-full text-left px-2.5 py-2 hover:bg-brand/10 active:bg-brand/20 disabled:opacity-50">
              <span className="block text-ink text-sm font-medium">{p.main}</span>
              {p.sub && <span className="block text-ink-muted text-xs">{p.sub}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 text-xs">
        <button type="button" disabled={busy} onClick={() => { setV(value || ''); setPreds([]); setEditing(false); setErr(null) }} className="px-2.5 py-1 rounded-lg border bg-surface text-ink-secondary">Annuler</button>
        <button type="button" disabled={busy || !v.trim()} onClick={() => save(v.trim(), null, null)} title="Sans suggestion Google : l’adresse est gardée telle quelle, sans coordonnées"
          className="px-2.5 py-1 rounded-lg border bg-surface text-ink-secondary disabled:opacity-50">{busy ? '…' : 'Garder le texte tel quel'}</button>
        {value && <button type="button" disabled={busy} onClick={() => save('', null, null)} className="px-2.5 py-1 rounded-lg border bg-surface text-red-700 disabled:opacity-50">Effacer</button>}
      </div>
      {err && <p className="text-red-600 text-xs">⚠ {err}</p>}
    </div>
  )
}

// ── Relivrer depuis le groupe Gardiennage ──────────────────────────────────
function RelivrerFromDossier({ d, leg }: { d: Dossier; leg: DossierLeg }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const relOpen = d.legs.find(l => l.kind === 'rel' && l.open)
  if (relOpen) return <span className="text-ink-secondary">Relivraison en cours : groupe <b className="font-mono">{relOpen.letter}</b>{relOpen.driver_name ? ` · ${relOpen.driver_name}` : ''}</span>
  const relDone = [...d.legs].reverse().find(l => l.kind === 'rel')
  const atParc = d.legs.some(l => l.kind === 'gard' && l.open)
  if (!atParc) return <span className="text-ink-muted">{relDone ? `Relivrée · groupe ${relDone.letter}${relDone.driver_name ? ' · ' + relDone.driver_name : ''}` : 'Véhicule pas au parc : rien à relivrer pour l’instant'}</span>
  const hasAddress = !!(leg.redelivery_address || '').trim()
  const go = async () => {
    if (!hasAddress) { setErr('Renseigne d’abord l’adresse de relivraison ci-dessus.'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/missions/${d.root_id}/relivrer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || `Erreur ${r.status}`); return }
      if (j.mission_id) router.push(`/dispatch/${j.mission_id}?assign=1`)
    } catch (e: any) { setErr(e?.message || 'Erreur réseau') } finally { setBusy(false) }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={go} title={hasAddress ? 'Créer la relivraison et choisir le chauffeur' : 'Adresse de relivraison manquante'}
        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition disabled:opacity-50 ${hasAddress ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700' : 'bg-surface border-amber-500/50 text-amber-700'}`}>
        {busy ? '⏳ Création…' : '🚚 Relivrer'}
      </button>
      {err && <span className="text-red-600">{err}</span>}
    </span>
  )
}

// ── Liste déroulante modifiable (type, source) ─────────────────────────────
function EditableSelect({ value, options, missionId, field, onSaved }: {
  value: string | null; options: [string, string][]; missionId: string; field: string; onSaved: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const label = options.find(o => o[0] === value)?.[1] || value || '—'
  const change = async (next: string) => {
    if (!next || next === value) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/missions/${missionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: next }) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`) }
      await onSaved()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }
  return (
    <span className="inline-flex items-center gap-1">
      <select value={value || ''} disabled={busy} onChange={e => change(e.target.value)} title={label}
        className="border rounded px-1.5 py-0.5 bg-surface text-ink text-xs max-w-[220px]">
        {!value && <option value="">—</option>}
        {!options.some(o => o[0] === value) && value && <option value={value}>{value}</option>}
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {err && <span className="text-red-600">⚠ {err}</span>}
    </span>
  )
}

// ── Date et heure modifiables (intervention / RDV) ─────────────────────────
function EditableDateTime({ value, missionId, field, onSaved }: { value: string | null; missionId: string; field: string; onSaved: () => void | Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
  const [v, setV] = useState(toLocal(value))
  useEffect(() => { if (!editing) setV(toLocal(value)) }, [value, editing])
  const save = async () => {
    const next = v ? new Date(v).toISOString() : null
    if ((next || '') === (value ? new Date(value).toISOString() : '')) { setEditing(false); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/missions/${missionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: next }) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`) }
      setEditing(false); await onSaved()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }
  if (!editing) return (
    <button type="button" onClick={() => setEditing(true)} title="Date et heure d’intervention — toucher pour modifier"
      className={`text-left rounded px-1 -mx-1 hover:bg-brand/10 hover:ring-1 hover:ring-brand/30 ${value ? 'text-ink' : 'text-ink-faint italic'}`}>
      🕒 {value ? new Date(value).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'date d’intervention'}{err && <span className="ml-1 text-red-600 not-italic">⚠ {err}</span>}
    </button>
  )
  return (
    <span className="inline-flex items-center gap-1">
      <input type="datetime-local" autoFocus value={v} disabled={busy} onChange={e => setV(e.target.value)} onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setV(toLocal(value)); setEditing(false) } }}
        className="border rounded px-1.5 py-0.5 bg-surface text-ink text-xs" />
    </span>
  )
}

// ── Valeur modifiable d'un clic (client, véhicule…) ────────────────────────
function EditableText({ value, placeholder, missionId, field, onSaved, mono, upper }: {
  value: string | null; placeholder: string; missionId: string; field: string; onSaved: () => void | Promise<void>; mono?: boolean; upper?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (!editing) setV(value || '') }, [value, editing])
  const save = async () => {
    const next = upper ? v.trim().toUpperCase() : v.trim()
    if (next === (value || '')) { setEditing(false); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/missions/${missionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: next || null }) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`) }
      setEditing(false); await onSaved()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }
  if (!editing) return (
    <button type="button" onClick={() => setEditing(true)} title="Cliquer pour modifier"
      className={`text-left rounded px-1 -mx-1 hover:bg-brand/10 hover:ring-1 hover:ring-brand/30 ${mono ? 'font-mono' : ''} ${value ? 'text-ink' : 'text-ink-faint italic'}`}>
      {value || placeholder}{err && <span className="ml-1 text-red-600 not-italic">⚠ {err}</span>}
    </button>
  )
  return (
    <input autoFocus value={v} disabled={busy} onChange={e => setV(e.target.value)} placeholder={placeholder}
      onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setV(value || ''); setEditing(false) } }}
      className={`border rounded px-1.5 py-0.5 bg-surface text-ink text-xs w-full max-w-[260px] min-w-0 ${mono ? 'font-mono' : ''}`} />
  )
}

// ── Client de facturation du groupe (hérité du dossier, modifiable) ───────
// allLegs : depuis l'en-tête du dossier, le client choisi s'applique à TOUS les
// groupes d'un coup ; un groupe se corrige ensuite sur sa propre ligne
// (Olivier 08/09/2026).
function BillingRow({ d, leg, onChanged, gmKey, allLegs = false, onApplied }: { d: Dossier; leg: DossierLeg; onChanged: () => void | Promise<void>; gmKey?: string; allLegs?: boolean; onApplied?: (ids: string[], c: { id: number | null; name: string | null }) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: number; name: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  // Préremplissage du formulaire « Créer un client » : carte d'identité lue au
  // comptoir, photo de la carte, ou saisie par le client sur l'écran comptoir.
  const [prefill, setPrefill] = useState<any>(null)
  const fromEid = (e: EidData) => {
    setPrefill({ name: [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || undefined, phone: e.phone || undefined, email: e.email || undefined,
      street: e.street || undefined, zip: e.zip || undefined, city: e.city || undefined, country: e.country || undefined, countryCode: countryToIso(e.country) })
    setCreating(true)
  }
  const fromManual = (m: ManualClientData) => {
    setPrefill({ name: m.name || undefined, phone: m.phone || undefined, email: m.email || undefined, street: m.street || undefined, zip: m.zip || undefined,
      city: m.city || undefined, country: m.country || undefined, countryCode: m.countryCode || countryToIso(m.country), vat: m.vat || undefined, isCompany: m.isCompany || undefined })
    setCreating(true)
  }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Affichage optimiste : dès que le PATCH a réussi, on montre le nouveau client
  // sans attendre le rechargement du dossier (Olivier 07/09 : « il faut que je
  // l'encode deux fois »).
  const [local, setLocal] = useState<{ id: number | null; name: string | null } | null>(null)
  const timer = useRef<any>(null)
  useEffect(() => { setLocal(null) }, [leg.billed_to_id, leg.billed_to_name])
  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); setSearching(false); return }
    clearTimeout(timer.current); setSearching(true)
    timer.current = setTimeout(async () => {
      try { const j = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(q.trim())}`).then(r => r.json()); setResults(j.clients || []) } catch {}
      finally { setSearching(false) }
    }, 300)
  }, [q])
  const shownId   = local ? local.id : (allLegs ? d.billed_to.id : leg.billed_to_id)
  const shownName = local ? local.name : (allLegs ? d.billed_to.name : leg.billed_to_name)
  const inherited = allLegs || (shownId ?? null) === (d.billed_to.id ?? null)
  const targets   = allLegs ? d.legs.filter(l => l.kind !== 'out' && l.channel !== 'parquet').map(l => l.mission_id) : [leg.mission_id]
  const save = async (c: { id: number | null; name: string | null }) => {
    setBusy(true); setErr(null)
    try {
      const rs = await Promise.all(targets.map(id => fetch(`/api/missions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ billed_to_id: c.id, billed_to_name: c.name }) })))
      const bad = rs.find(r => !r.ok)
      if (bad) { const j = await bad.json().catch(() => ({})); throw new Error(j.error || `HTTP ${bad.status}`) }
      setLocal(c); setEditing(false); setQ(''); setResults([])
      onApplied?.(targets, c)
      await onChanged()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }
  return (
    <div className={`flex flex-wrap items-center gap-2 text-xs ${allLegs ? '' : 'bg-surface-2 border border-dashed rounded-xl px-3 py-2'}`}>
      <span className="text-ink-muted">{allLegs ? 'Client du dossier' : 'Facturer à'}</span>
      {!editing ? (
        <>
          <button disabled={busy} onClick={() => setEditing(true)} className="border rounded-lg px-2.5 py-1 bg-surface text-ink font-medium min-w-[200px] text-left hover:border-brand/50">{busy ? '⏳ ' : ''}{shownName || '— à définir'} <span className="text-ink-faint float-right">▾</span></button>
          {allLegs
            ? <span className="text-ink-faint text-[11px]" title="Choisir ici applique le client à tous les groupes ; un groupe se corrige sur sa ligne">→ tous les groupes</span>
            : inherited
            ? <span className="text-ink-faint text-[11px]">= client du dossier</span>
            : <span className="text-amber-700 dark:text-amber-300 text-[11px] font-semibold">⚠ différent du dossier ({d.billed_to.name || '—'})</span>}
          {!inherited && d.billed_to.id != null && (
            <button disabled={busy} onClick={() => save({ id: d.billed_to.id, name: d.billed_to.name })} className="ml-auto text-[11px] border border-dashed rounded-lg px-2 py-0.5 text-ink-muted hover:text-ink">Revenir au client du dossier</button>
          )}
          {err && <span className="text-red-600 text-[11px]">{err}</span>}
        </>
      ) : (
        <div className="relative flex-1 min-w-[240px]">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un client Odoo (3 lettres min.)" className="w-full border rounded-lg px-2.5 py-1 bg-surface text-ink text-xs" />
          <button onClick={() => { setEditing(false); setQ('') }} className="absolute right-1.5 top-1 text-ink-faint text-xs">✕</button>
          <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[11px]">
            <span className="text-ink-faint">ou compléter depuis</span>
            <EidImportButton onImport={fromEid} />
            <IdPhotoButton onImport={fromEid} />
            <ManualInfoButton onImport={fromManual} />
          </div>
          {q.trim().length >= 3 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-surface border rounded-lg shadow-lg max-h-64 overflow-auto">
              {results.map(c => <button key={c.id} disabled={busy} onClick={() => save(c)} className="block w-full text-left px-2.5 py-1.5 text-xs text-ink hover:bg-surface-2">{c.name} <span className="text-ink-faint">#{c.id}</span></button>)}
              {searching && <div className="px-2.5 py-1.5 text-[11px] text-ink-faint">Recherche…</div>}
              {!searching && results.length === 0 && <div className="px-2.5 py-1.5 text-[11px] text-ink-faint">Aucun client Odoo ne correspond.</div>}
              {!searching && <button onClick={() => setCreating(true)} className="block w-full text-left px-2.5 py-1.5 text-xs font-semibold text-brand border-t hover:bg-brand/10">＋ Créer « {q.trim()} » comme nouveau client Odoo</button>}
            </div>
          )}
        </div>
      )}
      {creating && (
        <CreateClientModal initialName={q.trim()} prefill={prefill || undefined} gmKey={gmKey} onClose={() => { setCreating(false); setPrefill(null) }}
          onCreated={(c: any) => { setCreating(false); setPrefill(null); save({ id: Number(c.id), name: String(c.name || prefill?.name || q.trim()) }) }} />
      )}
    </div>
  )
}

// ── Estimation de tout le dossier, ligne courante en surbrillance ─────────
function EstimationTable({ d, me }: { d: Dossier; me: string }) {
  return (
    <div className="border rounded-xl overflow-x-auto text-xs max-w-full">
      <div className="bg-surface-2 px-3 py-1.5 font-semibold text-ink-secondary flex justify-between"><span>Estimation du dossier {d.ref}</span><span>HTVA</span></div>
      <table className="w-full min-w-[420px]">
        <tbody>
          {d.legs.map(l => {
            const done = l.billed_refs.length > 0 && l.billed_htva >= l.amount_htva - 0.01
            return (
              <tr key={l.letter} className={`border-t ${l.letter === me ? 'bg-brand/10 text-ink font-semibold' : done ? 'text-ink-faint' : 'text-ink-secondary'}`}>
                <td className="px-3 py-1">
                  <span className="font-mono">{l.letter}</span> {l.title}{l.kind === 'gard' && l.days != null ? ` ${l.days} j` : ''}{l.letter === me ? ' · cette fiche' : ''}
                  {done && <span className="ml-2 inline-block align-middle"><Stamp refs={l.billed_refs} small /></span>}
                  {!done && l.billed_htva > 0 && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TONE.warn}`}>partiel {eur(l.billed_htva)}</span>}
                  {l.open && l.kind === 'gard' && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TONE.live}`}>en cours</span>}
                  {!l.billed_inherited && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TONE.warn}`}>→ {l.billed_to_name || '?'}</span>}
                  {l.nothing_to_bill && <span className="ml-1.5 text-ink-faint">({l.nothing_to_bill})</span>}
                </td>
                <td className="px-3 py-1 text-right tabular-nums whitespace-nowrap">{eur(l.amount_htva)}</td>
              </tr>
            )
          })}
          <tr className="border-t bg-surface-2 text-ink font-bold"><td className="px-3 py-1">Total du dossier</td><td className="px-3 py-1 text-right tabular-nums">{eur(d.totals.estimated)}</td></tr>
          <tr className="border-t bg-surface-2 text-ink font-bold"><td className="px-3 py-1">Reste à facturer</td><td className="px-3 py-1 text-right tabular-nums">{eur(d.totals.remaining)}</td></tr>
        </tbody>
      </table>
      {d.invoices.length > 0 && (
        <div className="border-t px-3 py-1.5 text-[11px] text-ink-muted">
          Factures : {d.invoices.map(i => <span key={i.number} className="mr-3 inline-flex items-center gap-1.5">{i.url ? <a href={i.url} target="_blank" rel="noreferrer" title={i.number}><Stamp refs={[i.number]} small /></a> : <Stamp refs={[i.number]} small />}<span className="text-ink-faint">{refKind(i.number)} · couvre {i.covers.join(' ')} · {eur(i.amount)}</span></span>)}
        </div>
      )}
    </div>
  )
}
