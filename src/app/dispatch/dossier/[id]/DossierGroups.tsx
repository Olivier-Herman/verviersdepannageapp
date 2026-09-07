'use client'
// Vue dossier — écran. Un groupe par action (REM, gardiennage, REL…), lettré,
// chronologique, le dernier ouvert. Chaque groupe : résumé, client de
// facturation (hérité du dossier, modifiable), estimation de TOUT le dossier
// avec total, et « Ouvrir la fiche complète » = ta fiche dispatch actuelle en
// embed. Les mails sans action sont des lignes fines. Olivier 07/09/2026.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import MissionDetailClient from '@/app/dispatch/[id]/MissionDetailClient'
import CreateClientModal from '@/components/CreateClientModal'
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

export default function DossierGroups({ initial, fiches, shared, isSuperadmin, openMissionId }: {
  initial: Dossier; fiches: Record<string, any>; shared: any; isSuperadmin: boolean; openMissionId: string
}) {
  const [d, setD] = useState<Dossier>(initial)
  const [flagMode, setFlagMode] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => {
    const target = initial.legs.find(l => l.mission_id === openMissionId) || initial.legs[initial.legs.length - 1]
    return new Set(target ? [target.letter] : [])
  })
  const [embed, setEmbed] = useState<Set<string>>(new Set())
  const [billing, setBilling] = useState(false)
  const billable = d.legs.filter(l => !l.nothing_to_bill && !(l.billed_refs.length && l.billed_htva >= l.amount_htva - 0.01) && l.amount_htva > 0)
  const toggle = (l: string) => setOpen(p => { const n = new Set(p); n.has(l) ? n.delete(l) : n.add(l); return n })
  const toggleEmbed = (l: string) => setEmbed(p => { const n = new Set(p); n.has(l) ? n.delete(l) : n.add(l); return n })

  const refresh = async () => {
    try { const j = await fetch(`/api/dossier/${d.root_id}?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()); if (j?.dossier) setD(j.dossier) } catch {}
  }

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
    <div className="px-3 lg:px-6 py-5 space-y-3">

      {isSuperadmin && (
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
        <div className="px-5 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-x-6 gap-y-2 items-start">
          <div>
            <h1 className="text-ink font-bold text-lg flex flex-wrap items-center gap-2">
              Dossier {d.ref}
              <span className="text-xs font-semibold text-ink-secondary bg-surface-2 border rounded-lg px-2 py-0.5">{d.source_label}</span>
              {d.dossier_number && <span className="text-xs font-mono text-ink-secondary bg-surface-2 border rounded-lg px-2 py-0.5">{d.dossier_number}</span>}
              <span className={`text-xs font-bold rounded-lg px-2.5 py-0.5 shadow-sm ${d.state.open ? TONE.live : TONE.ok}`}>{d.state.open ? `En cours · ${d.state.reason}` : 'Terminé'}</span>
            </h1>
            <p className="text-ink-secondary text-sm mt-0.5">{vehicle}{d.vehicle.plate ? <> · <span className="font-mono">{d.vehicle.plate}</span></> : null}{d.vehicle.vin ? <span className="text-ink-faint"> · VIN <span className="font-mono">{d.vehicle.vin}</span></span> : null}</p>
            <p className="text-ink-muted text-xs mt-0.5">{d.client.name ? `Client sur place : ${d.client.name}${d.client.phone ? ' · ' + d.client.phone : ''}` : 'Client sur place : —'} · reçu le {fmt(d.received_at)}</p>
          </div>
          <div className="md:text-right">
            <div className="flex md:justify-end items-center gap-2 flex-wrap">
              <span className="text-ink-muted text-xs">Client du dossier</span>
              <span className="text-ink text-sm font-medium border rounded-lg px-2.5 py-1 bg-surface-2">{d.billed_to.name || '—'}</span>
              <button disabled={!billable.length} onClick={() => setBilling(true)} title={billable.length ? 'Une facture Odoo par client, créée directement' : 'Rien à facturer'} className={`px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-white ${billable.length ? 'hover:bg-brand-hover' : 'opacity-40 cursor-not-allowed'}`}>Facturer{billable.length ? ` (${billable.length})` : ''}</button>
            </div>
            <div className="grid grid-cols-4 gap-x-4 mt-2 text-[11px] text-ink-muted md:justify-items-end">
              <div>Estimé HTVA<b className="block text-ink text-sm tabular-nums">{eur(d.totals.estimated)}</b></div>
              <div>Facturé<b className="block text-ink text-sm tabular-nums">{eur(d.totals.billed)}</b></div>
              <div>Encaissé<b className="block text-ink text-sm tabular-nums">{eur(d.totals.collected)}</b></div>
              <div>Reste<b className="block text-ink text-sm tabular-nums">{eur(d.totals.remaining)}</b></div>
            </div>
            {d.state.open && <p className="text-[11px] text-ink-faint mt-1">Dossier en cours : pas de facturation automatique avant la sortie du véhicule.</p>}
          </div>
        </div>
        {/* Frise */}
        <div className="border-t px-5 py-2.5 flex items-center overflow-x-auto gap-0">
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

      <div className="flex flex-wrap gap-3 text-[11px] text-ink-muted px-1">
        {(Object.keys(KIND) as Array<keyof typeof KIND>).map(k => <span key={k}><i className={`inline-block w-2.5 h-2.5 rounded-sm mr-1 align-[-1px] ${KIND[k].dot}`} />{KIND[k].label}</span>)}
        <span><i className="inline-block w-2.5 h-2.5 rounded-full border border-dashed border-ink-faint mr-1 align-[-1px]" />Mail reçu, sans action</span>
      </div>

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
        </div>
      ) : (
        <Group key={it.leg!.letter} d={d} leg={it.leg!} isOpen={open.has(it.leg!.letter)} onToggle={() => toggle(it.leg!.letter)}
          embedOpen={embed.has(it.leg!.letter)} onToggleEmbed={() => toggleEmbed(it.leg!.letter)} fiche={fiches[it.leg!.mission_id]} shared={shared} onChanged={refresh} />
      ))}

      <p className="text-[11px] text-ink-faint px-1 pt-2">Les fiches Gardiennage sont créées automatiquement à la mise en parc et n'apparaissent que sur cet écran. « Facturer » crée directement les factures Odoo en brouillon, une par client.</p>

      {billing && <BillingModal d={d} onClose={() => setBilling(false)} onDone={async () => { await refresh() }} />}
    </div>
  )
}

// ── Modale « Facturer le dossier » : groupes cochés, une facture par client ──
function BillingModal({ d, onClose, onDone }: { d: Dossier; onClose: () => void; onDone: () => Promise<void> }) {
  const isBilled = (l: DossierLeg) => l.billed_refs.length > 0 && l.billed_htva >= l.amount_htva - 0.01
  const canPick  = (l: DossierLeg) => !l.nothing_to_bill && !isBilled(l) && l.amount_htva > 0
  // Par défaut : tout ce qui est prêt. Un gardiennage EN COURS n'est pas coché :
  // le cocher arrête sa période à aujourd'hui et en ouvre une nouvelle.
  const [sel, setSel] = useState<Set<string>>(() => new Set(d.legs.filter(l => canPick(l) && !(l.kind === 'gard' && l.open)).map(l => l.mission_id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ invoices: any[]; warnings: string[] } | null>(null)
  const toggle = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const byClient = new Map<string, DossierLeg[]>()
  for (const l of d.legs) { const k = l.billed_to_name || '— client à définir'; (byClient.get(k) || byClient.set(k, []).get(k)!).push(l) }
  const chosen = d.legs.filter(l => sel.has(l.mission_id))
  const allPickable = d.legs.filter(canPick)
  const total = chosen.reduce((s, l) => s + l.amount_htva, 0)
  const nInv = new Set(chosen.map(l => l.billed_to_id ?? 'none')).size
  const missingClient = chosen.some(l => !l.billed_to_id)
  const runningChosen = chosen.some(l => l.kind === 'gard' && l.open)

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/dossier/${d.root_id}/invoice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_ids: chosen.map(l => l.mission_id) }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setResult(j); await onDone()
    } catch (e: any) { setError(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center p-4 pt-12 overflow-auto">
      <div className="w-full max-w-2xl bg-surface border rounded-2xl shadow-2xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-ink font-bold text-base">Facturer le dossier {d.ref} · {d.vehicle.plate}</h3>
            <p className="text-ink-muted text-xs mt-0.5">Tout coché = facture totale. Décoche ce qui attend = facture partielle. Une facture Odoo par client, créée directement en brouillon, sans devis.</p>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-lg leading-none">✕</button>
        </div>

        {!result && Array.from(byClient.entries()).map(([client, legs]) => {
          const ch = legs.filter(l => sel.has(l.mission_id)); const sum = ch.reduce((s, l) => s + l.amount_htva, 0)
          return (
            <div key={client} className="border rounded-xl px-3 py-2">
              <div className="flex justify-between text-sm font-semibold text-ink"><span>{ch.length ? 'Facture → ' : <span className="text-ink-muted">Rien pour </span>}{client}{/parquet|justice/i.test(client) && <span className={`ml-2 text-[10.5px] rounded-full px-2 py-0.5 ${TONE.warn}`}>Parquet : passe par l'état de frais, pas par Odoo</span>}</span><span className="tabular-nums">{ch.length ? eur(sum) + ' HTVA' : ''}</span></div>
              {legs.map(l => {
                const pick = canPick(l)
                return (
                  <button key={l.mission_id} disabled={!pick} onClick={() => toggle(l.mission_id)} className={`w-full grid grid-cols-[22px_1fr_auto] gap-2 items-center py-1 text-left text-xs ${pick ? 'text-ink-secondary' : 'opacity-50 cursor-default'}`}>
                    <span className={`w-4 h-4 rounded border-[1.5px] flex items-center justify-center text-[10px] ${sel.has(l.mission_id) ? 'bg-brand border-brand text-white' : 'border-ink-muted'}`}>{sel.has(l.mission_id) ? '✓' : (isBilled(l) ? '✓' : l.nothing_to_bill ? '–' : '')}</span>
                    <span><span className="font-mono">{l.letter}</span> {l.title}{l.kind === 'gard' && l.days != null ? ` ${l.days} j` : ''}{l.kind === 'gard' && l.open && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TONE.live}`}>en cours · arrêté à aujourd'hui si coché</span>}</span>
                    <span className="tabular-nums">{isBilled(l) ? `déjà facturé · ${cleanRef(l.billed_refs[0])}` : l.nothing_to_bill ? l.nothing_to_bill : eur(l.amount_htva)}</span>
                  </button>
                )
              })}
            </div>
          )
        })}

        {!result && (
          <>
            {missingClient && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.bad}`}>Un groupe coché n'a pas de client de facturation. Renseigne-le sur le groupe (ligne « Facturer à ») avant de facturer.</div>}
            {runningChosen && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.warn}`}>Un gardiennage en cours est coché : sa période s'arrête à aujourd'hui et un nouveau groupe s'ouvre sur la suite.</div>}
            {d.state.open && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.live}`}>Dossier en cours ({d.state.reason}) : facturation manuelle autorisée. L'automatique attendra la sortie du véhicule.</div>}
            {error && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.bad}`}>{error}</div>}
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-ink-muted">{chosen.length ? <><b className="text-ink">{chosen.length === allPickable.length ? 'Facture totale' : 'Facture partielle'}</b> · {nInv} facture{nInv > 1 ? 's' : ''} · {eur(total)} HTVA · référence « {d.number} {chosen.map(l => l.letter).join(' ')} »</> : 'Rien de coché'}</span>
              <button disabled={busy || !chosen.length || missingClient} onClick={submit} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-white disabled:opacity-40">{busy ? '⏳ Création…' : `Créer ${nInv > 1 ? 'les factures' : 'la facture'}`}</button>
            </div>
          </>
        )}

        {result && (
          <div className="space-y-2">
            <div className={`rounded-lg px-3 py-2 text-xs ${TONE.ok}`}>✓ {result.invoices.length} facture{result.invoices.length > 1 ? 's' : ''} Odoo créée{result.invoices.length > 1 ? 's' : ''} en brouillon. Les groupes couverts sont reliés ; le numéro définitif arrivera quand la facture sera postée dans Odoo.</div>
            {result.invoices.map((i: any) => (
              <div key={i.odoo_id} className="border rounded-xl px-3 py-2 text-xs flex items-center justify-between gap-3">
                <span><b className="text-ink">{i.client_name}</b> · couvre {i.covers.join(' ')} · {eur(i.total_htva)} HTVA</span>
                <a href={i.url} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-lg border text-brand font-semibold hover:bg-brand/10">Ouvrir dans Odoo ↗</a>
              </div>
            ))}
            {result.warnings.length > 0 && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.warn}`}>{result.warnings.map((w: string, i: number) => <div key={i}>• {w}</div>)}</div>}
            <div className="flex justify-end"><button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold border">Fermer</button></div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Un groupe ─────────────────────────────────────────────────────────────
function Group({ d, leg, isOpen, onToggle, embedOpen, onToggleEmbed, fiche, shared, onChanged }: {
  d: Dossier; leg: DossierLeg; isOpen: boolean; onToggle: () => void; embedOpen: boolean; onToggleEmbed: () => void; fiche: any; shared: any; onChanged: () => void
}) {
  const k = KIND[leg.kind]
  return (
    <div id={`grp-${leg.letter}`} className={`border rounded-2xl overflow-hidden bg-surface ${leg.open ? 'border-brand/50' : ''}`}>
      <button onClick={onToggle} className={`w-full grid grid-cols-[52px_1fr_auto] gap-3 items-center px-3.5 py-2.5 text-left ${k.head} hover:brightness-95 transition`}>
        <span className={`h-9 w-9 rounded-lg border flex items-center justify-center text-sm font-bold font-mono shadow-sm ${k.dot}`} title={d.number != null ? `${d.number}${leg.letter}` : leg.letter}>{leg.letter}</span>
        <span className="min-w-0">
          <span className="block text-ink text-sm font-semibold truncate">{leg.title}{leg.subtitle && <span className="text-ink-muted font-normal"> · {leg.subtitle}</span>}</span>
          <span className="block text-ink-secondary text-xs truncate">
            {leg.driver_name ? `${leg.driver_name} · ` : ''}{fmt(leg.started_at)}{leg.ended_at ? ` → ${fmt(leg.ended_at)}` : ''}{leg.days != null ? ` · ${leg.days} j` : ''}
            {leg.nothing_to_bill ? ` · ${leg.nothing_to_bill}` : ` · ${eur(leg.amount_htva)} HTVA`}
          </span>
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          {leg.billed_refs.length > 0 && leg.billed_htva >= leg.amount_htva - 0.01
            ? <Stamp refs={leg.billed_refs} />
            : <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${TONE[leg.status_tone]}`}>{leg.status_label}</span>}
          <span className="text-ink-muted text-sm">{isOpen ? '▾' : '▸'}</span>
        </span>
      </button>

      {isOpen && (
        <div className="border-t px-3.5 py-3 pl-3.5 md:pl-[70px] space-y-3">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {leg.facts.map((f, i) => (
              <div key={i} className="grid grid-cols-[110px_1fr] gap-2"><dt className="text-ink-muted">{f.label}</dt><dd className="text-ink break-words">{f.value}</dd></div>
            ))}
            {leg.amount_note && <div className="grid grid-cols-[110px_1fr] gap-2"><dt className="text-ink-muted">Estimation</dt><dd className="text-ink">{leg.nothing_to_bill ? leg.nothing_to_bill : <>{leg.amount_note} = <b>{eur(leg.amount_htva)} HTVA</b></>}</dd></div>}
            {leg.billed_refs.length > 0 && <div className="grid grid-cols-[110px_1fr] gap-2 items-center"><dt className="text-ink-muted">Facturé</dt><dd className="text-ink flex flex-wrap items-center gap-2">{eur(leg.billed_htva)} <Stamp refs={leg.billed_refs} small /> <span className="text-ink-faint text-[11px]">{refKind(leg.billed_refs[0])}</span></dd></div>}
          </dl>

          <BillingRow d={d} leg={leg} onChanged={onChanged} gmKey={shared.googleMapsKey} />

          <EstimationTable d={d} me={leg.letter} />

          <div className="flex flex-wrap gap-1.5">
            <button onClick={onToggleEmbed} className="px-2.5 py-1 rounded-lg text-xs font-semibold border bg-surface text-ink-secondary hover:text-ink">{embedOpen ? 'Replier la fiche complète' : 'Ouvrir la fiche complète'}</button>
            <Link href={`/dispatch/${leg.mission_id}`} className="px-2.5 py-1 rounded-lg text-xs font-semibold border bg-surface text-ink-secondary hover:text-ink">Fiche seule ↗</Link>
          </div>

          {embedOpen && fiche && (
            <div className="border rounded-xl bg-page overflow-hidden -ml-0 md:-ml-[56px]">
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

// ── Client de facturation du groupe (hérité du dossier, modifiable) ───────
function BillingRow({ d, leg, onChanged, gmKey }: { d: Dossier; leg: DossierLeg; onChanged: () => void | Promise<void>; gmKey?: string }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: number; name: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
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
  const shownId   = local ? local.id : leg.billed_to_id
  const shownName = local ? local.name : leg.billed_to_name
  const inherited = (shownId ?? null) === (d.billed_to.id ?? null)
  const save = async (c: { id: number | null; name: string | null }) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/missions/${leg.mission_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ billed_to_id: c.id, billed_to_name: c.name }) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`) }
      setLocal(c); setEditing(false); setQ(''); setResults([])
      await onChanged()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 bg-surface-2 border border-dashed rounded-xl px-3 py-2 text-xs">
      <span className="text-ink-muted">Facturer à</span>
      {!editing ? (
        <>
          <button disabled={busy} onClick={() => setEditing(true)} className="border rounded-lg px-2.5 py-1 bg-surface text-ink font-medium min-w-[200px] text-left hover:border-brand/50">{busy ? '⏳ ' : ''}{shownName || '— à définir'} <span className="text-ink-faint float-right">▾</span></button>
          {inherited
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
        <CreateClientModal initialName={q.trim()} gmKey={gmKey} onClose={() => setCreating(false)}
          onCreated={(c: any) => { setCreating(false); save({ id: Number(c.id), name: String(c.name || q.trim()) }) }} />
      )}
    </div>
  )
}

// ── Estimation de tout le dossier, ligne courante en surbrillance ─────────
function EstimationTable({ d, me }: { d: Dossier; me: string }) {
  return (
    <div className="border rounded-xl overflow-hidden text-xs">
      <div className="bg-surface-2 px-3 py-1.5 font-semibold text-ink-secondary flex justify-between"><span>Estimation du dossier {d.ref}</span><span>HTVA</span></div>
      <table className="w-full">
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
