'use client'
// Vue dossier — écran. Un groupe par action (REM, gardiennage, REL…), lettré,
// chronologique, le dernier ouvert. Chaque groupe : résumé, client de
// facturation (hérité du dossier, modifiable), estimation de TOUT le dossier
// avec total, et « Ouvrir la fiche complète » = ta fiche dispatch actuelle en
// embed. Les mails sans action sont des lignes fines. Olivier 07/09/2026.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import MissionDetailClient from '@/app/dispatch/[id]/MissionDetailClient'
import type { Dossier, DossierLeg } from '@/lib/dossier/build'

const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmt = (v: string | null) => v ? new Date(v).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
const fmtDay = (v: string | null) => v ? new Date(v).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit' }) : ''

const KIND = {
  rem:  { label: 'Remorquage / dépannage', head: 'bg-blue-500/10',    dot: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40' },
  gard: { label: 'Gardiennage',            head: 'bg-amber-500/10',   dot: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40' },
  rel:  { label: 'Relivraison',            head: 'bg-emerald-500/10', dot: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40' },
  out:  { label: 'Sortie',                 head: 'bg-violet-500/10',  dot: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/40' },
} as const
const TONE = {
  ok:    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  warn:  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  live:  'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  bad:   'bg-red-500/15 text-red-700 dark:text-red-300',
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
  const toggle = (l: string) => setOpen(p => { const n = new Set(p); n.has(l) ? n.delete(l) : n.add(l); return n })
  const toggleEmbed = (l: string) => setEmbed(p => { const n = new Set(p); n.has(l) ? n.delete(l) : n.add(l); return n })

  const refresh = async () => {
    try { const j = await fetch(`/api/dossier/${d.root_id}`, { cache: 'no-store' }).then(r => r.json()); if (j?.dossier) setD(j.dossier) } catch {}
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
              <span className={`text-xs font-semibold rounded-lg px-2 py-0.5 ${d.state.open ? TONE.live : TONE.ok}`}>{d.state.open ? `En cours · ${d.state.reason}` : 'Terminé'}</span>
            </h1>
            <p className="text-ink-secondary text-sm mt-0.5">{vehicle}{d.vehicle.plate ? <> · <span className="font-mono">{d.vehicle.plate}</span></> : null}{d.vehicle.vin ? <span className="text-ink-faint"> · VIN <span className="font-mono">{d.vehicle.vin}</span></span> : null}</p>
            <p className="text-ink-muted text-xs mt-0.5">{d.client.name ? `Client sur place : ${d.client.name}${d.client.phone ? ' · ' + d.client.phone : ''}` : 'Client sur place : —'} · reçu le {fmt(d.received_at)}</p>
          </div>
          <div className="md:text-right">
            <div className="flex md:justify-end items-center gap-2 flex-wrap">
              <span className="text-ink-muted text-xs">Client du dossier</span>
              <span className="text-ink text-sm font-medium border rounded-lg px-2.5 py-1 bg-surface-2">{d.billed_to.name || '—'}</span>
              <button disabled title="Étape 2 : facturation par dossier (une facture par client)" className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-white opacity-40 cursor-not-allowed">Facturer</button>
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
                className={`w-8 h-8 rounded-lg border flex items-center justify-center text-[11px] font-bold font-mono ${KIND[it.leg.kind].dot} ${it.leg.open ? 'ring-2 ring-brand/30' : ''}`} title={it.leg.title}>{it.leg.letter}</button>
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
        {(Object.keys(KIND) as Array<keyof typeof KIND>).map(k => <span key={k}><i className={`inline-block w-2.5 h-2.5 rounded-sm border mr-1 align-[-1px] ${KIND[k].dot}`} />{KIND[k].label}</span>)}
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

      <p className="text-[11px] text-ink-faint px-1 pt-2">Étape 1 (lecture) : les fiches Gardiennage sont créées automatiquement à la mise en parc et n'apparaissent que sur cet écran. Le bouton Facturer par dossier arrive en étape 2.</p>
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
        <span className={`h-9 w-9 rounded-lg border flex items-center justify-center text-sm font-bold font-mono bg-surface ${k.dot}`} title={d.number != null ? `${d.number}${leg.letter}` : leg.letter}>{leg.letter}</span>
        <span className="min-w-0">
          <span className="block text-ink text-sm font-semibold truncate">{leg.title}{leg.subtitle && <span className="text-ink-muted font-normal"> · {leg.subtitle}</span>}</span>
          <span className="block text-ink-secondary text-xs truncate">
            {leg.driver_name ? `${leg.driver_name} · ` : ''}{fmt(leg.started_at)}{leg.ended_at ? ` → ${fmt(leg.ended_at)}` : ''}{leg.days != null ? ` · ${leg.days} j` : ''}
            {leg.nothing_to_bill ? ` · ${leg.nothing_to_bill}` : ` · ${eur(leg.amount_htva)} HTVA`}
          </span>
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${TONE[leg.status_tone]}`}>{leg.status_label}</span>
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
            {leg.billed_refs.length > 0 && <div className="grid grid-cols-[110px_1fr] gap-2"><dt className="text-ink-muted">Facturé</dt><dd className="text-ink">{eur(leg.billed_htva)} · {leg.billed_refs.join(', ')}</dd></div>}
          </dl>

          <BillingRow d={d} leg={leg} onChanged={onChanged} />

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
function BillingRow({ d, leg, onChanged }: { d: Dossier; leg: DossierLeg; onChanged: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: number; name: string }[]>([])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const timer = useRef<any>(null)
  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try { const j = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(q.trim())}`).then(r => r.json()); setResults(j.clients || []) } catch {}
    }, 300)
  }, [q])
  const save = async (c: { id: number | null; name: string | null }) => {
    setBusy(true)
    try {
      await fetch(`/api/missions/${leg.mission_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ billed_to_id: c.id, billed_to_name: c.name }) })
      setEditing(false); setQ(''); setResults([]); onChanged()
    } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 bg-surface-2 border border-dashed rounded-xl px-3 py-2 text-xs">
      <span className="text-ink-muted">Facturer à</span>
      {!editing ? (
        <>
          <button onClick={() => setEditing(true)} className="border rounded-lg px-2.5 py-1 bg-surface text-ink font-medium min-w-[200px] text-left hover:border-brand/50">{leg.billed_to_name || '— à définir'} <span className="text-ink-faint float-right">▾</span></button>
          {leg.billed_inherited
            ? <span className="text-ink-faint text-[11px]">= client du dossier</span>
            : <span className="text-amber-700 dark:text-amber-300 text-[11px] font-semibold">⚠ différent du dossier ({d.billed_to.name || '—'})</span>}
          {!leg.billed_inherited && d.billed_to.id != null && (
            <button disabled={busy} onClick={() => save({ id: d.billed_to.id, name: d.billed_to.name })} className="ml-auto text-[11px] border border-dashed rounded-lg px-2 py-0.5 text-ink-muted hover:text-ink">Revenir au client du dossier</button>
          )}
        </>
      ) : (
        <div className="relative flex-1 min-w-[240px]">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un client Odoo (3 lettres min.)" className="w-full border rounded-lg px-2.5 py-1 bg-surface text-ink text-xs" />
          <button onClick={() => { setEditing(false); setQ('') }} className="absolute right-1.5 top-1 text-ink-faint text-xs">✕</button>
          {results.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-surface border rounded-lg shadow-lg max-h-56 overflow-auto">
              {results.map(c => <button key={c.id} disabled={busy} onClick={() => save(c)} className="block w-full text-left px-2.5 py-1.5 text-xs text-ink hover:bg-surface-2">{c.name} <span className="text-ink-faint">#{c.id}</span></button>)}
            </div>
          )}
        </div>
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
                  {done && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TONE.ok}`}>facturé{l.billed_refs[0] ? ' · ' + l.billed_refs[0] : ''}</span>}
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
          Factures : {d.invoices.map(i => <span key={i.number} className="mr-2">{i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="text-brand hover:underline font-mono">{i.number}</a> : <span className="font-mono">{i.number}</span>} <span className="text-ink-faint">couvre {i.covers.join(' ')} · {eur(i.amount)}</span></span>)}
        </div>
      )}
    </div>
  )
}
