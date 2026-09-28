'use client'

// Module Tâches — écran 1 « Véhicules arrivés au parc » + écran 2 « une
// question à la fois ». Premier jet fidèle à la maquette validée le 28/09/2026
// (https://claude.ai/artifact/U7VHhvZAcgo5KKdxjrCCCW) : un clic par réponse,
// « Valider » seulement quand il faut taper, ce que l'app sait déjà est affiché
// plutôt que demandé. Les gestes qui ont déjà leur API (réimprimer, transférer
// de zone, ajouter des photos) sont appelés d'ici.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AddressField, { verifyAddressViaPlaces } from '@/components/AddressField'
import ScanToFicheButton from '@/components/missions/ScanToFicheButton'
import { STEP_LABELS, DOCUMENT_LABELS, type Answers, type Reading, type StepId } from '@/lib/taches/accident-steps'

type Vehicle = { id: string; mission_number: number | null; plate: string | null; model: string; zone: string | null; row: number | null; parked_at: string | null; driver: string | null; police: string; status: string; started: boolean; next: StepId | null; next_label: string | null; done: number; total: number; completed_at: string | null }
type Ctx = {
  mission: any
  run: { status: string; answers: Answers; reading: Reading | null; completed_at: string | null }
  steps: StepId[]; next: StepId | null
  zones: { key: string; label: string }[]
  documents: { id: string; file_name: string; created_at: string }[]
  assisteurs: { key: string; label: string; default_billed_to_name: string | null }[]
  forfaitTvac: number
}

const fmtTime = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : ''
const fmtWhen = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso); const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay ? fmtTime(iso) : d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' }) + ' ' + fmtTime(iso)
}

type KeyTask = { missionId: string; status: string; since: string; doneAt: string | null; plate: string | null; model: string; digibox: string; slot: string | null; zone: string | null; driver: string | null; rangement: string | null }

export default function TachesClient({ gmKey }: { gmKey: string }) {
  const [list, setList] = useState<{ todo: Vehicle[]; stock?: Vehicle[]; waiting: Vehicle[]; done: Vehicle[] } | null>(null)
  const [showStock, setShowStock] = useState(false)
  const [keys, setKeys] = useState<{ todo: KeyTask[]; done: KeyTask[] }>({ todo: [], done: [] })
  const [cur, setCur] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [r, rk] = await Promise.all([fetch('/api/taches/vehicules', { cache: 'no-store' }), fetch('/api/taches/cles', { cache: 'no-store' })])
      if (!r.ok) throw new Error((await r.json()).error || r.statusText)
      setList(await r.json()); if (rk.ok) setKeys(await rk.json()); setErr(null)
    }
    catch (e: any) { setErr(e?.message || 'Chargement impossible') }
  }, [])
  useEffect(() => { load(); const i = setInterval(load, 60_000); return () => clearInterval(i) }, [load])

  if (cur) return <Wizard missionId={cur} gmKey={gmKey} onBack={() => { setCur(null); load() }} />

  const todo = list?.todo || [], stock = list?.stock || [], waiting = list?.waiting || [], done = list?.done || []
  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Tâches · fourrière</div>
      <h1 className="font-display text-2xl font-extrabold text-ink mt-0.5">Véhicules arrivés au parc</h1>
      <p className="text-sm text-ink-muted mt-1">Accident sur appel police. Le chauffeur a fait ses pointages ; ici on prend le véhicule en charge, une question à la fois.</p>
      <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${todo.length + keys.todo.length ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'}`}>
        <span className="w-2.5 h-2.5 rounded-full bg-current" />
        <span>{todo.length + keys.todo.length ? 'Objectif du jour : liste à zéro avant 18 h' : 'Liste du jour à zéro.'}</span>
        <b className="ml-auto font-mono">{todo.length + keys.todo.length}</b>
      </div>
      {err && <p className="mt-3 text-sm text-critical">{err}</p>}

      {(keys.todo.length > 0 || keys.done.length > 0) && (
        <Section title="Clés à récupérer en digibox" count={keys.todo.length} hint="Un chauffeur a déposé la clé en digibox : la récupérer et la ranger.">
          {keys.todo.map(k => <DigiboxCard key={k.missionId} k={k} onDone={load} />)}
          {keys.done.map(k => (
            <div key={k.missionId} className="bg-surface border border-border rounded-card px-3 py-2 flex items-center gap-2 text-sm opacity-75">
              <span className="font-mono font-semibold">{k.plate || '—'}</span><span className="text-ink-muted">rangée : {k.rangement}</span>
              <span className="ml-auto rounded-full bg-success-soft text-success px-2 py-0.5 text-xs font-semibold">✓ {fmtWhen(k.doneAt)}</span>
            </div>
          ))}
        </Section>
      )}

      <Section title="À traiter" count={todo.length} empty="Rien à prendre en charge. Le prochain véhicule apparaîtra à sa dépose au parc.">
        {todo.map(v => <VehicleCard key={v.id} v={v} onOpen={() => setCur(v.id)} />)}
      </Section>
      {stock.length > 0 && (
        <section className="mt-5">
          <button type="button" onClick={() => setShowStock(s => !s)} className="w-full flex items-center justify-between rounded-card border border-border bg-surface-2 px-3 py-2.5 text-left">
            <span><span className="font-display text-base font-bold text-ink">Stock au parc avant la mise en route</span><span className="block text-xs text-ink-muted">À reprendre en charge au rythme de la fourrière — hors objectif du jour.</span></span>
            <span className="flex items-center gap-2"><span className="font-mono text-xs text-ink-muted">{stock.length}</span><span className="text-ink-muted">{showStock ? '▾' : '▸'}</span></span>
          </button>
          {showStock && <div className="flex flex-col gap-2 mt-2">{stock.map(v => <VehicleCard key={v.id} v={v} onOpen={() => setCur(v.id)} />)}</div>}
        </section>
      )}
      {waiting.length > 0 && (
        <Section title="En attente du propriétaire" count={waiting.length} hint="Pris en charge, mais personne à contacter : le propriétaire et l’assurance viendront des documents ou du client quand il se fera connaître.">
          {waiting.map(v => <VehicleCard key={v.id} v={v} onOpen={() => setCur(v.id)} waiting onKnown={async () => { await fetch(`/api/taches/${v.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'client' }) }); setCur(v.id) }} />)}
        </Section>
      )}
      {done.length > 0 && (
        <Section title="Pris en charge" count={done.length}>
          {done.map(v => <VehicleCard key={v.id} v={v} onOpen={() => setCur(v.id)} />)}
        </Section>
      )}
    </div>
  )
}

function Section({ title, count, hint, empty, children }: { title: string; count: number; hint?: string; empty?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <div className="flex items-baseline justify-between mb-2"><h2 className="font-display text-lg font-bold text-ink">{title}</h2><span className="text-xs text-ink-muted font-mono">{count}</span></div>
      {hint && <p className="text-xs text-ink-muted -mt-1 mb-2">{hint}</p>}
      <div className="flex flex-col gap-2">
        {count === 0 && empty && <div className="rounded-card border border-dashed border-strong p-4 text-center text-sm text-ink-muted">{empty}</div>}
        {children}
      </div>
    </section>
  )
}

// Une clé en digibox : une question, un clic (sauf le n° de crochet à taper).
function DigiboxCard({ k, onDone }: { k: KeyTask; onDone: () => void }) {
  const [hookMode, setHookMode] = useState(false)
  const [hook, setHook] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const send = async (answer: 'hook' | 'office' | 'in_vehicle') => {
    setBusy(true); setErr(null)
    const r = await fetch('/api/taches/cles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ missionId: k.missionId, answer, hook }) })
    setBusy(false)
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error || 'Enregistrement impossible'); return }
    onDone()
  }
  return (
    <div className="bg-surface border border-border rounded-card shadow-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div><div className="font-mono font-semibold text-lg text-ink tracking-wide">{k.plate || '—'}</div><div className="text-sm text-ink-secondary">{k.model || 'Véhicule'}</div></div>
        <div className="text-right"><span className="inline-block rounded-full bg-warning-soft text-warning px-2 py-0.5 text-xs font-semibold">📦 {k.digibox}{k.slot ? ` · n° ${k.slot}` : ''}</span><div className="font-mono text-xs text-ink-muted mt-1">{fmtWhen(k.since)}</div></div>
      </div>
      <div className="text-xs text-ink-muted mt-1">{k.driver ? `Déposée par ${k.driver}` : 'Déposée en digibox'}{k.zone ? ` · véhicule en zone ${k.zone}` : ''}</div>
      <div className="font-display font-bold text-ink mt-2">Où ranges-tu la clé ?</div>
      <div className="grid grid-cols-3 gap-2 mt-2">
        <button type="button" disabled={busy} onClick={() => setHookMode(true)} aria-pressed={hookMode} className={`rounded-xl border px-2 py-2.5 text-sm font-semibold ${hookMode ? 'border-info bg-info-soft text-info' : 'border-strong bg-surface text-ink'}`}>Au crochet</button>
        <button type="button" disabled={busy} onClick={() => send('office')} className="rounded-xl border border-strong bg-surface px-2 py-2.5 text-sm font-semibold text-ink disabled:opacity-60">Au bureau</button>
        <button type="button" disabled={busy} onClick={() => send('in_vehicle')} className="rounded-xl border border-strong bg-surface px-2 py-2.5 text-sm font-semibold text-ink disabled:opacity-60">Dans le véhicule</button>
      </div>
      {hookMode && (
        <div className="flex gap-2 mt-2">
          <input autoFocus inputMode="numeric" placeholder="N° de crochet" value={hook} onChange={e => setHook(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && hook.trim()) send('hook') }} className="flex-1 min-w-0 rounded-btn border border-strong bg-surface px-3 py-2.5 font-mono text-ink" />
          <button type="button" disabled={busy || !hook.trim()} onClick={() => send('hook')} className="rounded-btn bg-brand hover:bg-brand-hover text-white px-4 py-2.5 text-sm font-semibold shadow-brand disabled:opacity-45">Valider</button>
        </div>
      )}
      {err && <p className="text-critical text-xs mt-1">{err}</p>}
    </div>
  )
}

function VehicleCard({ v, onOpen, waiting, onKnown }: { v: Vehicle; onOpen: () => void; waiting?: boolean; onKnown?: () => void }) {
  const pct = v.total ? Math.round(v.done / v.total * 100) : 0
  return (
    <div className={`w-full text-left bg-surface border border-border rounded-card shadow-card p-3 ${v.status === 'done' ? 'opacity-75' : ''}`}>
      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div><div className="font-mono font-semibold text-lg text-ink tracking-wide">{v.plate || '—'}</div><div className="text-sm text-ink-secondary">{v.model || 'Véhicule'}</div></div>
          <div className="text-right"><span className="inline-block rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink">Zone {v.zone || '?'}{v.row ? ` · ${v.row}` : ''}</span><div className="font-mono text-xs text-ink-muted mt-1">{fmtWhen(v.parked_at)}</div></div>
        </div>
        <div className="flex flex-wrap gap-x-2 text-xs text-ink-muted mt-1"><span>Déposé{v.driver ? ` par ${v.driver}` : ''}</span>{v.police && <><span>·</span><span>{v.police}</span></>}</div>
        <div className="h-1.5 rounded bg-border overflow-hidden mt-2"><i className="block h-full bg-success-fill" style={{ width: `${pct}%` }} /></div>
        <div className="flex items-center gap-2 mt-2 text-sm">
          {v.status === 'done'
            ? <><span className="rounded-full bg-success-soft text-success px-2 py-0.5 text-xs font-semibold">Pris en charge {fmtWhen(v.completed_at)}</span></>
            : waiting
              ? <span className="rounded-full bg-warning-soft text-warning px-2 py-0.5 text-xs font-semibold">En attente du propriétaire</span>
              : <><span className="rounded-full bg-alert-soft text-alert px-2 py-0.5 text-xs font-semibold">Fourrière</span><span className={!v.started ? 'text-brand font-bold' : 'text-ink'}>{!v.started ? 'Prendre en charge' : v.next_label || 'Continuer'}</span></>}
          <span className="ml-auto text-ink-muted">›</span>
        </div>
      </button>
      {waiting && onKnown && <button type="button" onClick={onKnown} className="mt-2 w-full rounded-btn border border-strong bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-hover">Le client s’est fait connaître</button>}
    </div>
  )
}

// ── Écran 2 : une question à la fois ─────────────────────────────────────────
function Wizard({ missionId, gmKey, onBack }: { missionId: string; gmKey: string; onBack: () => void }) {
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastT = useRef<any>(null)
  const say = (m: string) => { setToast(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(null), 2600) }

  const load = useCallback(async () => {
    const r = await fetch(`/api/taches/${missionId}`, { cache: 'no-store' }); if (!r.ok) { setErr((await r.json()).error || r.statusText); return }
    setCtx(await r.json())
  }, [missionId])
  useEffect(() => { load() }, [load])

  const answer = async (step: StepId, value: any, extra?: Record<string, any>) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/taches/${missionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step, answer: value, extra }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText)
      setCtx(j); window.scrollTo(0, 0)
    } catch (e: any) { setErr(e?.message || 'Erreur') } finally { setBusy(false) }
  }

  if (!ctx) return <div className="max-w-2xl mx-auto px-4 py-6 text-sm text-ink-muted">{err || 'Chargement…'}</div>
  const m = ctx.mission, a = ctx.run.answers, reading = ctx.run.reading
  const stepsShown = ctx.steps
  const idx = ctx.next ? stepsShown.indexOf(ctx.next) : stepsShown.length
  const step = ctx.next

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <div className="flex items-center gap-3 mb-3">
        <button type="button" onClick={onBack} className="rounded-btn border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-ink whitespace-nowrap">‹ Véhicules</button>
        <div className="min-w-0"><div className="font-mono font-semibold text-lg text-ink">{m.vehicle_plate || '—'}</div><div className="text-xs text-ink-muted truncate">{[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')} · zone {m.parc_zone_key || '?'} · déposé {fmtWhen(m.parked_at)}{m.driver_name ? ` par ${m.driver_name}` : ''} · <Link href={`/dispatch/${m.id}`} className="underline">fiche</Link></div></div>
      </div>
      <div className="flex gap-1 mb-4">{stepsShown.map((s, i) => <i key={s} className={`flex-1 h-1.5 rounded ${i < idx ? 'bg-success-fill' : i === idx ? 'bg-info-fill' : 'bg-border'}`} />)}</div>
      {err && <p className="mb-3 text-sm text-critical">{err}</p>}

      <div className="bg-surface border border-border rounded-card shadow-md p-4">
        {!step ? <End ctx={ctx} onBack={onBack} /> : (
          <>
            <div className="flex items-center gap-2 text-xs text-ink-muted mb-2"><span className="rounded-full bg-alert-soft text-alert px-2 py-0.5 font-semibold">Fourrière</span><span className="font-mono">{idx + 1} / {stepsShown.length}</span></div>
            {step === 'label' && <Q title="L’étiquette est-elle collée sur le véhicule ?" known={m.label_printed_at ? `Imprimée à ${fmtTime(m.label_printed_at)} sur la Zebra du parc.` : 'Aucune impression enregistrée pour ce véhicule.'}>
              <Ans onClick={() => answer('label', 'oui')} busy={busy}>Oui, elle est collée</Ans>
              <Ans onClick={async () => { setBusy(true); const r = await fetch(`/api/missions/${missionId}/reprint-label`, { method: 'POST' }); setBusy(false); say(r.ok ? 'Étiquette renvoyée à la Zebra' : 'Réimpression impossible'); if (r.ok) answer('label', 'reprint') }} busy={busy} sm="la Zebra la ressort">Non, réimprimer</Ans>
            </Q>}
            {step === 'zone' && <ZoneStep ctx={ctx} busy={busy} setBusy={setBusy} say={say} answer={answer} />}
            {step === 'key' && <KeyStep busy={busy} answer={answer} current={m.key_label} />}
            {step === 'docs' && <Q title="Des documents sont-ils dans le véhicule ?">
              <Ans onClick={() => answer('docs', 'oui')} busy={busy}>Oui</Ans>
              <Ans onClick={() => answer('docs', 'non')} busy={busy}>Non, rien à bord</Ans>
            </Q>}
            {step === 'scan' && <ScanStep missionId={missionId} busy={busy} setBusy={setBusy} say={say} onDone={load} answer={answer} setErr={setErr} />}
            {step === 'check' && <CheckStep reading={reading} busy={busy} answer={answer} missionId={missionId} />}
            {step === 'photos' && <PhotosStep missionId={missionId} photos={m.driver_photos || []} busy={busy} setBusy={setBusy} say={say} answer={answer} />}
            {step === 'cover' && <CoverStep reading={reading} busy={busy} answer={answer} initialForfait={Number(m.storage_flat_htva) > 0} forfaitTvac={ctx.forfaitTvac} />}
            {step === 'contact' && <ContactStep m={m} reading={reading} busy={busy} answer={answer} />}
            {step === 'assistance' && <AssistanceStep ctx={ctx} gmKey={gmKey} busy={busy} answer={answer} />}
          </>
        )}
      </div>

      {Object.keys(a).length > 0 && (
        <details className="mt-3 text-sm"><summary className="cursor-pointer text-xs font-semibold text-ink-muted">Réponses déjà données</summary>
          <ul className="mt-2 flex flex-col gap-1">{stepsShown.filter(s => (a as any)[s] != null).map(s => <li key={s} className="flex justify-between gap-3"><span className="text-ink-muted">{STEP_LABELS[s]}</span><b className="text-right">{answerLabel(s, a)}</b></li>)}</ul>
        </details>
      )}
      {toast && <div className="fixed left-1/2 -translate-x-1/2 bottom-5 rounded-full bg-ink text-surface px-4 py-2 text-sm font-semibold shadow-md">{toast}</div>}
    </div>
  )
}

function answerLabel(s: StepId, a: Answers): string {
  switch (s) {
    case 'label': return a.label === 'reprint' ? 'Réimprimée' : 'Collée'
    case 'zone': return a.zone === 'transfer' ? `Transférée en ${a.zone_key}` : 'Laissée en place'
    case 'key': return a.key === 'hook' ? `Crochet n° ${a.key_hook || '?'}` : a.key === 'in_vehicle' ? 'Dans le véhicule' : a.key === 'office' ? 'Au bureau' : 'Pas de clé'
    case 'docs': return a.docs === 'oui' ? 'Oui' : 'Aucun'
    case 'scan': return a.scan === 'fait' ? 'Scannés et lus' : 'Plus tard'
    case 'check': return a.check === 'oui' ? 'Confirmée' : 'À corriger'
    case 'photos': return a.photos === 'ajoutees' ? 'Ajoutées' : 'Rien de plus'
    case 'cover': return (a.cover === 'ethias_kaze' ? 'Ethias / Kaze' : a.cover === 'autre' ? (a.cover_name || 'Autre') : 'Aucune') + (a.forfait220 ? ' · forfait gardiennage' : '')
    case 'contact': return a.contact === 'joint' ? 'Joint' : a.contact === 'message' ? 'Message laissé' : 'Injoignable'
    case 'assistance': return a.assistance === 'oui' ? `${a.assistance_name || 'Assistance'}${a.assistance_ref ? ' · ' + a.assistance_ref : ''}` : a.assistance === 'pas_agree' ? `Pas agréé${a.assistance_name ? ' · ' + a.assistance_name : ''}` : 'Non'
  }
}

function Q({ title, hint, known, children }: { title: string; hint?: string; known?: string; children: React.ReactNode }) {
  return (<>
    <div className="font-display text-xl font-bold text-ink leading-tight">{title}</div>
    {hint && <p className="text-sm text-ink-secondary mt-1">{hint}</p>}
    {known && <div className="mt-2 rounded-xl bg-success-soft text-success px-3 py-2 text-sm font-semibold flex gap-2"><span>✓</span><span>{known}</span></div>}
    <div className="flex flex-col gap-2 mt-3">{children}</div>
  </>)
}
function Ans({ children, onClick, busy, sm, pressed }: { children: React.ReactNode; onClick: () => void; busy?: boolean; sm?: string; pressed?: boolean }) {
  return <button type="button" onClick={onClick} disabled={busy} aria-pressed={pressed} className={`w-full text-left rounded-xl border px-3.5 py-3 text-base font-semibold text-ink flex items-center gap-2.5 disabled:opacity-60 ${pressed ? 'border-info bg-info-soft' : 'border-strong bg-surface hover:bg-surface-hover'}`}><span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center text-sm ${pressed ? 'bg-info-fill border-info-fill text-white' : 'border-strong text-transparent'}`}>✓</span><span>{children}</span>{sm && <span className="ml-auto text-xs font-normal text-ink-muted">{sm}</span>}</button>
}
const Primary = ({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) =>
  <button type="button" onClick={onClick} disabled={disabled} className="flex-1 rounded-btn bg-brand hover:bg-brand-hover text-white px-4 py-2.5 text-sm font-semibold shadow-brand disabled:opacity-45 disabled:cursor-not-allowed">{children}</button>
const Ghost = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) =>
  <button type="button" onClick={onClick} className="rounded-btn px-3 py-2.5 text-sm font-semibold text-ink-muted hover:text-ink">{children}</button>
const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`w-full rounded-btn border border-strong bg-surface px-3 py-2.5 text-ink ${p.className || ''}`} />

function ZoneStep({ ctx, busy, setBusy, say, answer }: { ctx: Ctx; busy: boolean; setBusy: (b: boolean) => void; say: (m: string) => void; answer: (s: StepId, v: any, x?: any) => Promise<void> }) {
  const [pick, setPick] = useState<string | null>(null)
  const m = ctx.mission
  const transfer = async () => {
    if (!pick) return
    setBusy(true)
    const r = await fetch(`/api/missions/${m.id}/transfer-parc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zone_key: pick, reason: 'Prise en charge accident police' }) })
    setBusy(false)
    if (!r.ok) { say((await r.json()).error || 'Transfert impossible'); return }
    say(`Transféré en zone ${pick}`); await answer('zone', 'transfer', { zone_key: pick })
  }
  const autoK = !!ctx.run.answers.redelivery_address && /^K/.test(String(m.parc_zone_key || ''))
  return <Q title="Où ranger le véhicule ?" known={autoK
      ? `Passé en zone ${m.parc_zone_key} automatiquement : une adresse de relivraison est posée, l’étiquette relivraison est ressortie.`
      : `En zone ${m.parc_zone_key || '?'}${m.parc_row_number ? `, rangée ${m.parc_row_number}` : ''}${m.driver_name ? `, déposé par ${m.driver_name}` : ''}.`}
    hint="Dernière question : le véhicule ne bouge qu’une fois.">
    <Ans onClick={() => answer('zone', 'keep')} busy={busy}>Laisser là</Ans>
    <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mt-1">Ou transférer vers</div>
    <div className="flex flex-wrap gap-1.5">{ctx.zones.filter(z => z.key !== m.parc_zone_key).map(z => <button key={z.key} type="button" onClick={() => setPick(z.key)} aria-pressed={pick === z.key} className={`rounded-btn border px-3 py-1.5 text-sm ${pick === z.key ? 'border-info bg-info-soft text-info font-semibold' : 'border-strong bg-surface text-ink'}`}>{z.key}{z.label && z.label !== z.key ? ` · ${z.label}` : ''}</button>)}</div>
    {pick && <div className="flex gap-2 mt-2"><Primary onClick={transfer} disabled={busy}>Transférer en {pick}</Primary></div>}
  </Q>
}

function KeyStep({ busy, answer, current }: { busy: boolean; answer: (s: StepId, v: any, x?: any) => Promise<void>; current: string | null }) {
  const [hook, setHook] = useState(''); const [hookMode, setHookMode] = useState(false)
  return <Q title="Où est la clé ?" known={current ? `Fiche : ${current}` : undefined}>
    <Ans onClick={() => answer('key', 'in_vehicle')} busy={busy}>Dans le véhicule</Ans>
    <Ans onClick={() => setHookMode(true)} busy={busy} pressed={hookMode}>Au crochet n°</Ans>
    {hookMode && <div className="flex gap-2"><Input autoFocus inputMode="numeric" placeholder="12" value={hook} onChange={e => setHook(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && hook.trim()) answer('key', 'hook', { hook }) }} className="font-mono" /><Primary onClick={() => answer('key', 'hook', { hook })} disabled={busy || !hook.trim()}>Valider</Primary></div>}
    <Ans onClick={() => answer('key', 'office')} busy={busy}>Au bureau</Ans>
    <Ans onClick={() => answer('key', 'no_key')} busy={busy}>Pas de clé</Ans>
  </Q>
}

function ScanStep({ missionId, busy, setBusy, say, onDone, answer, setErr }: { missionId: string; busy: boolean; setBusy: (b: boolean) => void; say: (m: string) => void; onDone: () => Promise<void>; answer: (s: StepId, v: any, x?: any) => Promise<void>; setErr: (e: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const send = async (files: File[]) => {
    if (!files.length) return
    setBusy(true); setErr(null); say(`${files.length} page${files.length > 1 ? 's' : ''} reçue${files.length > 1 ? 's' : ''}, lecture en cours…`)
    try {
      const fd = new FormData(); files.forEach(f => fd.append('files', f))
      const r = await fetch(`/api/taches/${missionId}/documents`, { method: 'POST', body: fd })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText)
      say(j.ok ? 'Documents lus' : `Enregistrés, mais lecture impossible : ${j.error}`)
      await onDone(); window.scrollTo(0, 0)
    } catch (e: any) { setErr(e?.message || 'Envoi impossible') } finally { setBusy(false) }
  }
  return <Q title="Scanner tout ce qui est à bord" hint="Pas de tri à faire : on passe toutes les pages, la reconnaissance range chaque document. Ce qui n’est pas dans le scan est un document absent.">
    <ScanToFicheButton label="🖨️ Scanner tout (chargeur)" onScanned={send} />
    <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="w-full text-left rounded-xl border border-strong bg-surface px-3.5 py-3 text-base font-semibold text-ink disabled:opacity-60">📷 Photographier ou choisir des fichiers<span className="block text-xs font-normal text-ink-muted">photos ou PDF, plusieurs pages possibles</span></button>
    <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={e => send(Array.from(e.target.files || []))} />
    <div className="flex gap-2 mt-1"><Ghost onClick={() => answer('scan', 'plus_tard')}>Plus tard, le véhicule reste dans la liste</Ghost></div>
  </Q>
}

function CheckStep({ reading, busy, answer, missionId }: { reading: Reading | null; busy: boolean; answer: (s: StepId, v: any, x?: any) => Promise<void>; missionId: string }) {
  const docs = reading?.documents || []
  const present = docs.filter(d => d.present), absent = docs.filter(d => !d.present)
  const rows: [string, string | null | undefined][] = [
    ['Propriétaire', reading?.owner?.name], ['Adresse', reading?.owner?.address], ['Téléphone', reading?.owner?.phone], ['E-mail', reading?.owner?.email],
    ['Assureur', [reading?.insurer?.name, reading?.insurer?.policy ? `police ${reading.insurer.policy}` : null].filter(Boolean).join(' · ') || null],
    ['Assistance', reading?.assistance], ['Contrôle technique', reading?.ct_valid_until ? `valable jusqu’au ${reading.ct_valid_until}` : null], ['Châssis', reading?.vin], ['Note', reading?.notes],
  ]
  return <Q title="Voici ce que le scan a reconnu. Correct ?">
    <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Reconnus</div>
    <div className="flex flex-wrap gap-1.5">{present.length ? present.map((d, i) => <span key={i} className="rounded-full bg-success-soft text-success px-2 py-0.5 text-xs font-semibold">{DOCUMENT_LABELS[d.type] || d.type}{d.note ? ` (${d.note})` : ''}</span>) : <span className="text-sm text-ink-muted">Rien de reconnu</span>}</div>
    {absent.length > 0 && <><div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mt-1">Absents du scan</div><div className="flex flex-wrap gap-1.5">{absent.map((d, i) => <span key={i} className="rounded-full bg-warning-soft text-warning px-2 py-0.5 text-xs font-semibold">{DOCUMENT_LABELS[d.type] || d.type}</span>)}</div></>}
    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm mt-1">{rows.filter(r => r[1]).map(([k, v]) => <div key={k}><span className="block text-[11px] uppercase tracking-wider text-ink-muted">{k}</span>{v}</div>)}{!rows.some(r => r[1]) && <div className="text-ink-muted">Aucune information lisible.</div>}</div>
    <Ans onClick={() => answer('check', 'oui')} busy={busy}>Oui, c’est correct</Ans>
    <Ans onClick={async () => { await answer('check', 'corriger'); window.open(`/dispatch/${missionId}`, '_blank') }} busy={busy} sm="ouvre la fiche">Corriger sur la fiche</Ans>
  </Q>
}

function PhotosStep({ missionId, photos, busy, setBusy, say, answer }: { missionId: string; photos: string[]; busy: boolean; setBusy: (b: boolean) => void; say: (m: string) => void; answer: (s: StepId, v: any, x?: any) => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [local, setLocal] = useState<string[]>(photos)
  const add = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    const fd = new FormData(); files.forEach(f => fd.append('files', f))
    const r = await fetch(`/api/missions/${missionId}/photos-add`, { method: 'POST', body: fd })
    setBusy(false)
    if (!r.ok) { say('Envoi des photos impossible'); return }
    const j = await r.json().catch(() => ({})); if (Array.isArray(j.driver_photos)) setLocal(j.driver_photos)
    say(`${files.length} photo${files.length > 1 ? 's' : ''} ajoutée${files.length > 1 ? 's' : ''}`); await answer('photos', 'ajoutees')
  }
  return <Q title="Faut-il ajouter des photos ?" hint={local.length ? `${local.length} photo${local.length > 1 ? 's' : ''} déjà dans le dossier, prises par le chauffeur.` : 'Aucune photo dans le dossier pour l’instant.'}>
    {local.length > 0 && <div className="grid grid-cols-4 gap-1.5">{local.slice(0, 12).map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-border bg-surface-2"><img src={u} alt="" className="w-full h-full object-cover" loading="lazy" /></a>)}</div>}
    <Ans onClick={() => answer('photos', 'non')} busy={busy}>Non, rien de plus</Ans>
    <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="w-full text-left rounded-xl border border-strong bg-surface px-3.5 py-3 text-base font-semibold text-ink disabled:opacity-60">📷 Oui, prendre des photos<span className="block text-xs font-normal text-ink-muted">dégâts, objets de valeur, état à l’arrivée</span></button>
    <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={e => add(Array.from(e.target.files || []))} />
  </Q>
}

function CoverStep({ reading, busy, answer, initialForfait, forfaitTvac }: { reading: Reading | null; busy: boolean; answer: (s: StepId, v: any, x?: any) => Promise<void>; initialForfait: boolean; forfaitTvac: number }) {
  const [forfait, setForfait] = useState(initialForfait)
  const [other, setOther] = useState(false); const [name, setName] = useState('')
  const ins = reading?.insurer?.name; const ass = reading?.assistance
  const isEthias = /ethias|kaze/i.test(`${ins || ''} ${ass || ''}`)
  return <Q title="Couverture d’assistance" known={ins || ass ? `Lu sur les documents : assureur ${ins || '?'}${ass ? `, assistance ${ass}` : ''}.` : 'Rien de lu sur les documents : d’après le propriétaire.'}>
    <label className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm"><input type="checkbox" checked={forfait} onChange={e => setForfait(e.target.checked)} className="w-5 h-5" /><span><b>Forfait gardiennage {forfaitTvac} € TVAC</b> <span className="text-ink-muted">— seulement si ce dossier y a droit</span></span></label>
    <Ans onClick={() => answer('cover', 'ethias_kaze', { forfait220: forfait })} busy={busy} pressed={isEthias && !other} sm={isEthias ? 'proposé' : undefined}>Ethias / Kaze</Ans>
    <Ans onClick={() => setOther(true)} busy={busy} pressed={other}>Autre assisteur</Ans>
    {other && <div className="flex gap-2"><Input autoFocus placeholder="Touring, VAB, AXA, Europ Assistance…" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) answer('cover', 'autre', { name, forfait220: forfait }) }} /><Primary onClick={() => answer('cover', 'autre', { name, forfait220: forfait })} disabled={busy || !name.trim()}>Valider</Primary></div>}
    <Ans onClick={() => answer('cover', 'aucune', { forfait220: forfait })} busy={busy}>Aucune couverture connue</Ans>
  </Q>
}

function ContactStep({ m, reading, busy, answer }: { m: any; reading: Reading | null; busy: boolean; answer: (s: StepId, v: any, x?: any) => Promise<void> }) {
  const phone = m.client_phone || reading?.owner?.phone; const email = m.client_email || reading?.owner?.email
  const name = m.client_name || reading?.owner?.name
  return <Q title="Contacter le propriétaire" known={`${name || 'Propriétaire'}${phone ? ` · ${phone}` : ''}${email ? ` · ${email}` : ''}`} hint="Par téléphone ou par mail. Plus de courrier postal chez nous.">
    {phone && <a href={`tel:${String(phone).replace(/\s+/g, '')}`} className="rounded-btn border border-strong bg-surface px-3 py-2 text-sm font-semibold text-ink text-center">📞 Appeler {phone}</a>}
    {email && <a href={`mailto:${email}`} className="rounded-btn border border-strong bg-surface px-3 py-2 text-sm font-semibold text-ink text-center">✉️ Écrire à {email}</a>}
    <Ans onClick={() => answer('contact', 'joint')} busy={busy}>Joint</Ans>
    <Ans onClick={() => answer('contact', 'message')} busy={busy} sm="à rappeler">Message laissé</Ans>
    <Ans onClick={() => answer('contact', 'injoignable')} busy={busy}>Injoignable</Ans>
  </Q>
}

function AssistanceStep({ ctx, gmKey, busy, answer }: { ctx: Ctx; gmKey: string; busy: boolean; answer: (s: StepId, v: any, x?: any) => Promise<void> }) {
  const [mode, setMode] = useState<'oui' | 'pas_agree' | null>(null)
  const [key, setKey] = useState<string | null>(null); const [ref, setRef] = useState(''); const [free, setFree] = useState('')
  const [addr, setAddr] = useState(ctx.mission.redelivery_address || ''); const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(ctx.mission.redelivery_lat ? { lat: ctx.mission.redelivery_lat, lng: ctx.mission.redelivery_lng } : null)
  const suggested = ctx.run.reading?.assistance || ctx.run.answers.cover_name || (ctx.run.answers.cover === 'ethias_kaze' ? 'Ethias' : '')
  const submitOui = async () => {
    let lat = coords?.lat, lng = coords?.lng
    if (addr.trim() && !coords && gmKey) { const v = await verifyAddressViaPlaces(addr, gmKey).catch(() => null); if (v) { lat = v.lat; lng = v.lng } }
    await answer('assistance', 'oui', { assistance_key: key, assistance_ref: ref, redelivery_address: addr.trim() || undefined, redelivery_lat: lat, redelivery_lng: lng })
  }
  return <Q title="Ouverture d’un dossier d’assistance" known={suggested ? `D’après les documents : ${suggested}.` : undefined}>
    <Ans onClick={() => setMode('oui')} busy={busy} pressed={mode === 'oui'}>Oui, un dossier est ouvert</Ans>
    {mode === 'oui' && <div className="rounded-xl border border-border bg-surface-2 p-3 flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Assistance</div>
      <div className="flex flex-wrap gap-1.5">{ctx.assisteurs.map(s => <button key={s.key} type="button" onClick={() => setKey(s.key)} aria-pressed={key === s.key} className={`rounded-btn border px-3 py-1.5 text-sm ${key === s.key ? 'border-info bg-info-soft text-info font-semibold' : 'border-strong bg-surface text-ink'}`}>{s.label}</button>)}</div>
      {key && <p className="text-xs text-ink-muted">Client facturable : <b>{ctx.assisteurs.find(s => s.key === key)?.default_billed_to_name || '—'}</b></p>}
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mt-1">N° de dossier</div>
      <Input placeholder="ex. 8452-114-77" value={ref} onChange={e => setRef(e.target.value)} className="font-mono" />
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mt-1">Adresse de relivraison <span className="normal-case tracking-normal font-normal">(si nécessaire)</span></div>
      {gmKey ? <AddressField value={addr} onChange={v => { setAddr(v); setCoords(null) }} onSelect={(a, lat, lng) => { setAddr(a); setCoords({ lat, lng }) }} gmKey={gmKey} placeholder="Rue, n°, code postal, localité" /> : <Input placeholder="Rue, n°, code postal, localité" value={addr} onChange={e => setAddr(e.target.value)} />}
      <div className="flex gap-2 mt-1"><Primary onClick={submitOui} disabled={busy || !key}>Enregistrer</Primary></div>
    </div>}
    <Ans onClick={() => answer('assistance', 'non')} busy={busy}>Non, pas de dossier</Ans>
    <Ans onClick={() => setMode('pas_agree')} busy={busy} pressed={mode === 'pas_agree'}>Pas agréé</Ans>
    {mode === 'pas_agree' && <div className="flex gap-2"><Input autoFocus placeholder="Assistance connue, si vous l’avez" value={free} onChange={e => setFree(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') answer('assistance', 'pas_agree', { assistance_name: free }) }} /><Primary onClick={() => answer('assistance', 'pas_agree', { assistance_name: free })} disabled={busy}>Valider</Primary></div>}
  </Q>
}

function End({ ctx, onBack }: { ctx: Ctx; onBack: () => void }) {
  const a = ctx.run.answers, r = ctx.run.reading, m = ctx.mission
  const waiting = ctx.run.status === 'waiting_owner'
  const present: string[] = [], absent: string[] = []
  a.label ? present.push('Étiquette collée') : absent.push('Étiquette')
  if (a.key === 'no_key') absent.push('Clé'); else if (a.key) present.push(`Clé : ${a.key === 'hook' ? `crochet n° ${a.key_hook || '?'}` : a.key === 'in_vehicle' ? 'dans le véhicule' : 'au bureau'}`)
  for (const d of r?.documents || []) (d.present ? present : absent).push(DOCUMENT_LABELS[d.type] || d.type)
  if (a.docs === 'non') absent.push('Aucun document à bord')
  if (a.photos === 'ajoutees') present.push('Photos ajoutées')
  if (a.cover && a.cover !== 'aucune') present.push(`Couverture : ${a.cover === 'ethias_kaze' ? 'Ethias / Kaze' : a.cover_name || 'autre'}${a.forfait220 ? ', forfait gardiennage' : ''}`); else if (a.cover === 'aucune') absent.push('Couverture d’assistance')
  if (a.contact === 'joint') present.push('Propriétaire joint'); else if (a.contact) absent.push('Propriétaire pas encore joint')
  if (a.assistance === 'oui') present.push(`Dossier ${a.assistance_name || 'assistance'}${a.assistance_ref ? ' n° ' + a.assistance_ref : ''}`); else if (a.assistance === 'pas_agree') absent.push('Pas agréé')
  return (
    <div className="text-center py-3">
      <div className="text-4xl">{waiting ? '🅿️' : '✓'}</div>
      <h2 className="font-display text-xl font-bold text-ink mt-2">{m.vehicle_plate} pris en charge</h2>
      <p className="text-sm text-ink-secondary mt-1">{waiting ? 'Étiquette, clé, documents et photos sont réglés. Propriétaire et assurance inconnus pour l’instant.' : `Terminé ${fmtWhen(ctx.run.completed_at)}. La suite se joue dans la fiche d’intervention.`}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left mt-4">
        <div><div className="text-[11px] uppercase tracking-wider text-ink-muted font-bold mb-1">Ce qui est là</div><ul className="text-sm text-success flex flex-col gap-1">{present.length ? present.map((x, i) => <li key={i}>✓ {x}</li>) : <li>—</li>}</ul></div>
        <div><div className="text-[11px] uppercase tracking-wider text-ink-muted font-bold mb-1">Ce qui manque</div><ul className="text-sm text-alert flex flex-col gap-1">{absent.length ? absent.map((x, i) => <li key={i}>✗ {x}</li>) : <li>Rien</li>}</ul></div>
      </div>
      {waiting && <div className="mt-4 text-left rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm"><b className="block text-[11px] uppercase tracking-wider text-ink-muted mb-1">Et maintenant</b>Le véhicule passe « en attente du propriétaire ». Dès qu’il se fait connaître, au comptoir, par téléphone ou via la police, les questions du dossier reprennent. Le gardiennage court en attendant.</div>}
      <div className="flex gap-2 mt-4"><Link href={`/dispatch/${m.id}`} className="flex-1 rounded-btn border border-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink text-center">Ouvrir la fiche</Link><Primary onClick={onBack}>Retour aux véhicules</Primary></div>
    </div>
  )
}
