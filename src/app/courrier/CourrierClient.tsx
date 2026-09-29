'use client'
// src/app/courrier/CourrierClient.tsx — Courrier du jour (maquette v2 validée le 29/09/2026).
// Scanner / photographier → Claude lit → proposition (pour qui, type, fiche, gestes) →
// « C'est ça » en un clic, « Corriger » (+ expliquer à l'agent), ou « dis-lui quoi faire ».
// L'agent reformule toujours avant d'agir ; l'app retient la procédure par expéditeur.

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import BurstCamera from '@/components/camera/BurstCamera'
import ScanToFicheButton from '@/components/missions/ScanToFicheButton'
import { compressImage } from '@/lib/image-compress'
import { DOC_TYPES, ENTITIES, type EntityKey } from '@/lib/courrier/types'

const ENT_TONE: Record<string, string> = { vd: 'bg-brand-soft text-brand', riga: 'bg-info-soft text-info', dgj: 'bg-purple-soft text-purple' }
const hhmm = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : ''
const dmy = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE') : ''
const isPhone = () => typeof navigator !== 'undefined' && (/VDNav\//.test(navigator.userAgent) || /iPhone|iPad|Android/i.test(navigator.userAgent))

const Btn = ({ children, onClick, disabled, kind = 'ghost', className = '' }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; kind?: 'brand' | 'ghost' | 'ok' | 'quiet'; className?: string }) =>
  <button type="button" onClick={onClick} disabled={disabled} className={`min-h-[44px] rounded-btn px-3.5 text-sm font-semibold disabled:opacity-45 disabled:cursor-not-allowed ${kind === 'brand' ? 'bg-brand hover:bg-brand-hover text-white shadow-brand' : kind === 'ok' ? 'bg-success-fill text-white' : kind === 'quiet' ? 'text-ink-muted' : 'border border-strong bg-surface text-ink'} ${className}`}>{children}</button>
const Chip = ({ children, tone = 'bg-surface-2 text-ink' }: { children: React.ReactNode; tone?: string }) =>
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{children}</span>
const EntChip = ({ e }: { e?: string | null }) => e && e in ENTITIES ? <Chip tone={ENT_TONE[e]}>{ENTITIES[e as EntityKey].label}</Chip> : <Chip tone="bg-alert-soft text-alert">Société ?</Chip>
const H3 = ({ children }: { children: React.ReactNode }) => <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{children}</div>
const input = 'w-full rounded-btn border border-strong bg-surface px-3 py-2.5 text-ink'

type Page = { id: string; blob: Blob; mime: string; preview: string | null }

export default function CourrierClient({ initialId }: { initialId: string | null }) {
  const [data, setData] = useState<any>(null)
  const [tab, setTab] = useState<'jour' | 'taches' | 'registre' | 'appris'>('jour')
  const [ent, setEnt] = useState<string>('all')
  const [cur, setCur] = useState<string | null>(initialId)
  const [err, setErr] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(null), 2600) }

  const load = useCallback(async () => {
    try { const r = await fetch('/api/courrier', { cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setData(j); setErr(null) }
    catch (e: any) { setErr(e?.message || 'Chargement impossible') }
  }, [])
  useEffect(() => { load() }, [load])
  // Lecture en cours : on suit jusqu'à la proposition.
  useEffect(() => {
    if (!data?.todo?.some((c: any) => c.status === 'reading')) return
    const t = setInterval(load, 3000); return () => clearInterval(t)
  }, [data, load])

  if (cur) return <Detail id={cur} onBack={() => { setCur(null); load() }} say={say} flash={flash} />
  if (!data) return <div className="max-w-2xl mx-auto px-4 py-6 text-sm text-ink-muted">{err || 'Chargement…'}</div>

  const myOpen = (data.tasks || []).filter((t: any) => !t.done_at)
  const todoAll = data.todo.length + myOpen.filter((t: any) => t.assignee_id === data.me).length
  const byEnt = (c: any) => ent === 'all' || (c.decision?.entity || c.proposal?.entity) === ent
  const todo = data.todo.filter(byEnt), done = data.today.filter(byEnt)

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 flex flex-col gap-3">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-ink">Courrier du jour</h1>
        <p className="text-sm text-ink-muted">Tout le courrier papier, scanné ou photographié. L’app lit, propose pour qui c’est et quoi en faire ; on valide en un clic, et elle apprend.</p>
      </div>
      <div className={`rounded-xl px-3 py-2.5 flex items-center gap-2 text-sm font-semibold ${todoAll ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'}`}>
        <span className="w-2.5 h-2.5 rounded-full bg-current" />{todoAll ? 'Objectif du jour : courrier et tâches à zéro avant 18 h' : 'Courrier du jour à zéro.'}<b className="ml-auto font-mono text-base">{todoAll}</b>
      </div>
      <Capture onSent={(id) => { load(); say('Courrier envoyé : lecture en cours…'); void id }} />
      {err && <p className="rounded-xl bg-critical-soft text-critical px-3 py-2 text-sm font-semibold">{err}</p>}
      <div className="grid grid-cols-4 gap-1.5">
        {([['jour', 'À valider'], ['taches', `Tâches${myOpen.length ? ` (${myOpen.length})` : ''}`], ['registre', 'Registre'], ['appris', 'Ce qu’elle a appris']] as const).map(([k, l]) =>
          <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k} className={`min-h-[44px] rounded-btn border text-xs sm:text-sm font-semibold ${tab === k ? 'border-info bg-info-soft text-info' : 'border-border bg-surface text-ink'}`}>{l}</button>)}
      </div>

      {tab === 'jour' && <>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[['all', 'Tous'], ...Object.entries(ENTITIES).map(([k, v]) => [k, v.label])].map(([k, l]) =>
            <button key={k} type="button" onClick={() => setEnt(k)} aria-pressed={ent === k} className={`shrink-0 min-h-[36px] rounded-full border px-3 text-sm font-semibold ${ent === k ? 'bg-ink text-surface border-ink' : 'bg-surface border-border text-ink'}`}>{l}</button>)}
        </div>
        <Section title="À valider" count={todo.length}>
          {todo.length === 0 ? <Empty>Rien à valider. Le prochain courrier scanné ou photographié apparaîtra ici avec sa proposition.</Empty> : todo.map((c: any) => <Item key={c.id} c={c} onOpen={() => setCur(c.id)} />)}
        </Section>
        {done.length > 0 && <Section title="Traités aujourd’hui" count={done.length}>{done.map((c: any) => <Item key={c.id} c={c} onOpen={() => setCur(c.id)} />)}</Section>}
      </>}

      {tab === 'taches' && <Tasks data={data} load={load} onOpen={setCur} />}

      {tab === 'registre' && <Section title="Registre du courrier" count={data.registre.length}>
        {data.registre.length === 0 ? <Empty>Rien encore.</Empty> : <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-sm"><thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-ink-muted"><tr><th className="text-left p-2">Date</th><th className="text-left p-2">Courrier</th><th className="text-left p-2">Pour</th><th className="text-left p-2">Type</th><th className="text-left p-2">Décision</th></tr></thead>
            <tbody>{data.registre.map((c: any) => <tr key={c.id} className="border-t border-border cursor-pointer hover:bg-surface-2" onClick={() => setCur(c.id)}>
              <td className="p-2 font-mono whitespace-nowrap">{dmy(c.created_at)}</td>
              <td className="p-2"><b>{c.reading?.sender || '—'}</b><div className="text-ink-muted">{c.reading?.summary?.slice(0, 90)}</div></td>
              <td className="p-2"><EntChip e={c.decision?.entity} /></td>
              <td className="p-2">{DOC_TYPES[c.decision?.doc_type as keyof typeof DOC_TYPES] || '—'}</td>
              <td className="p-2 whitespace-nowrap">{c.decision?.how} · {c.decided_by_name || '—'}</td></tr>)}</tbody></table></div>}
      </Section>}

      {tab === 'appris' && <Learned data={data} load={load} say={say} />}
      {flash && <div className="fixed left-1/2 -translate-x-1/2 bottom-5 rounded-full bg-ink text-surface px-4 py-2 text-sm font-semibold shadow-md z-50">{flash}</div>}
    </div>
  )
}

const Section = ({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) =>
  <section className="flex flex-col gap-2 mt-1"><div className="flex items-baseline justify-between"><h2 className="font-display text-lg font-bold text-ink">{title}</h2>{count != null && <span className="text-sm text-ink-muted">{count}</span>}</div>{children}</section>
const Empty = ({ children }: { children: React.ReactNode }) => <div className="rounded-card border border-dashed border-strong p-4 text-center text-sm text-ink-muted">{children}</div>

function Thumb({ url, pdf }: { url?: string | null; pdf?: boolean }) {
  return url ? <img src={url} alt="" className="w-12 h-16 object-cover rounded-md border border-strong shrink-0" />
    : <div className="w-12 h-16 rounded-md border border-strong bg-surface-2 grid place-items-center text-[10px] font-bold text-ink-muted shrink-0">{pdf ? 'PDF' : '…'}</div>
}

function Item({ c, onOpen }: { c: any; onOpen: () => void }) {
  const d = c.decision
  const e = d?.entity || c.proposal?.entity
  const t = d?.doc_type || c.proposal?.doc_type
  return <button type="button" onClick={onOpen} className={`w-full text-left rounded-card border border-border bg-surface p-3 flex gap-3 hover:bg-surface-2 ${d ? 'opacity-75' : ''}`}>
    <Thumb url={c.thumb} pdf={c.pages?.[0]?.mime === 'application/pdf'} />
    <div className="flex-1 min-w-0 flex flex-col gap-1">
      <div className="font-bold text-ink truncate">{c.status === 'reading' ? 'Lecture en cours…' : c.status === 'error' ? 'Lecture impossible' : c.reading?.sender || 'Expéditeur non lu'}</div>
      <div className="text-sm text-ink-secondary line-clamp-2">{c.status === 'error' ? c.error : c.reading?.summary || `${c.pages?.length || 0} page(s) · ${c.source === 'photo' ? 'photo' : c.source === 'fichier' ? 'fichier' : 'scan'}`}</div>
      <div className="flex flex-wrap gap-1.5 items-center text-xs text-ink-muted">
        {c.status !== 'reading' && c.status !== 'error' && <><EntChip e={e} />{t && <Chip tone={c.proposal?.weak && !d ? 'bg-alert-soft text-alert' : undefined}>{DOC_TYPES[t as keyof typeof DOC_TYPES]}</Chip>}</>}
        <span>{hhmm(c.created_at)}</span>
        {d ? <Chip tone="bg-success-soft text-success">{d.how} {hhmm(d.at)} · {c.decided_by_name || d.by_name || ''}</Chip>
          : c.status === 'to_validate' ? <Chip tone={c.proposal?.weak ? 'bg-alert-soft text-alert' : 'bg-warning-soft text-warning'}>{c.proposal?.weak ? 'À qualifier' : 'Proposition prête'}</Chip> : null}
      </div>
    </div>
    <span className="text-ink-muted self-center">›</span>
  </button>
}

// ── Arrivée d'un courrier : scanner, photographier ou choisir des fichiers ─────
function Capture({ onSent }: { onSent: (id: string) => void }) {
  const [pages, setPages] = useState<Page[]>([])
  const [source, setSource] = useState<'scan' | 'photo' | 'fichier'>('scan')
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const phone = isPhone()
  const add = async (blobs: Blob[], src: 'scan' | 'photo' | 'fichier') => {
    setSource(s => pages.length ? s : src)
    for (const b of blobs) {
      const pdf = b.type === 'application/pdf'
      const small = pdf ? b : await compressImage(b)
      const mime = pdf ? 'application/pdf' : (small.type || 'image/jpeg')
      setPages(ps => [...ps, { id: Math.random().toString(36).slice(2), blob: small, mime, preview: pdf ? null : URL.createObjectURL(small) }])
    }
  }
  const send = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/courrier', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, pages: pages.map(p => ({ mime: p.mime })) }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      for (let i = 0; i < j.uploads.length; i++) {
        const put = await fetch(j.uploads[i].signedUrl, { method: 'PUT', headers: { 'Content-Type': j.uploads[i].mime, 'x-upsert': 'false' }, body: pages[i].blob })
        if (!put.ok) throw new Error(`Page ${i + 1} non envoyée (${put.status})`)
      }
      // Lecture lancée sans attendre : la liste suit l'avancement.
      fetch(`/api/courrier/${j.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read' }) }).catch(() => {})
      setPages([]); onSent(j.id)
    } catch (e: any) { setErr(e?.message || 'Envoi impossible') } finally { setBusy(false) }
  }
  return <div className="flex flex-col gap-2">
    {camera && <BurstCamera title="Pages du courrier" count={pages.length} onShot={b => add([b], 'photo')} onClose={() => setCamera(false)} />}
    <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={e => { add(Array.from(e.target.files || []), 'fichier'); e.target.value = '' }} />
    <div className="flex flex-wrap gap-2">
      {!phone && <ScanToFicheButton onScanned={files => add(files, 'scan')} label="🖨️ Scanner" className="flex-1 min-h-[44px] rounded-btn bg-brand text-white font-semibold px-3.5" />}
      <Btn kind={phone ? 'brand' : 'ghost'} className="flex-1" onClick={() => setCamera(true)}>📷 Photographier</Btn>
      <Btn className="flex-1" onClick={() => fileRef.current?.click()}>{phone ? 'Galerie' : 'Fichiers'}</Btn>
    </div>
    {pages.length > 0 && <div className="rounded-card border border-info bg-info-soft p-3 flex flex-col gap-2">
      <div className="text-sm font-semibold text-info">{pages.length} page{pages.length > 1 ? 's' : ''} prête{pages.length > 1 ? 's' : ''} : un seul courrier</div>
      <div className="flex gap-1.5 overflow-x-auto">{pages.map((p, i) => <div key={p.id} className="relative shrink-0">
        {p.preview ? <img src={p.preview} alt={`Page ${i + 1}`} className="w-14 h-20 object-cover rounded-md border border-strong" /> : <div className="w-14 h-20 rounded-md border border-strong bg-surface grid place-items-center text-xs font-bold text-ink-muted">PDF</div>}
        <button type="button" aria-label={`Retirer la page ${i + 1}`} onClick={() => setPages(ps => ps.filter(x => x.id !== p.id))} className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-ink text-surface text-xs">✕</button>
      </div>)}</div>
      <div className="flex gap-2"><Btn kind="brand" className="flex-1" disabled={busy} onClick={send}>{busy ? 'Envoi…' : 'Envoyer pour lecture'}</Btn><Btn onClick={() => setPages([])} disabled={busy}>Vider</Btn></div>
      <p className="text-xs text-ink-secondary">Un autre courrier ? Envoyez d’abord celui-ci : chaque envoi = un courrier.</p>
    </div>}
    {err && <p className="text-sm text-critical font-semibold">{err}</p>}
  </div>
}

// ── Un courrier : lecture, proposition, corriger / expliquer, faire ─────────────
function Detail({ id, onBack, say, flash }: { id: string; onBack: () => void; say: (m: string) => void; flash: string | null }) {
  const [c, setC] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [entity, setEntity] = useState<string | null>(null)
  const [docType, setDocType] = useState<string | null>(null)
  const [mission, setMission] = useState<{ id: string; label: string } | null | undefined>(undefined)
  const [q, setQ] = useState(''); const [hits, setHits] = useState<any[]>([])
  const [fixSay, setFixSay] = useState(''); const [keep, setKeep] = useState(true)
  const [freeSay, setFreeSay] = useState('')
  const [plan, setPlan] = useState<any>(null)   // « Ce que j'ai compris »
  const [planFrom, setPlanFrom] = useState<'fix' | 'say' | null>(null)

  const load = useCallback(async () => {
    try { const r = await fetch(`/api/courrier/${id}`, { cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setC(j); setErr(null) }
    catch (e: any) { setErr(e?.message || 'Chargement impossible') }
  }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (c?.status !== 'reading') return; const t = setInterval(load, 3000); return () => clearInterval(t) }, [c?.status, load])
  useEffect(() => { if (!c?.proposal) return; setEntity(c.proposal.entity); setDocType(c.proposal.doc_type); setMission(c.proposal.mission || null) }, [c?.proposal])

  const post = async (payload: any) => {
    setBusy(true); setErr(null)
    try { const r = await fetch(`/api/courrier/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j }
    catch (e: any) { setErr(e?.message || 'Action impossible'); return null } finally { setBusy(false) }
  }
  const understand = async (from: 'fix' | 'say') => {
    const j = await post({ action: 'understand', entity, doc_type: docType, mission_id: mission === undefined ? undefined : mission?.id || null, instruction: from === 'fix' ? fixSay : freeSay })
    if (j) { setPlan(j); setPlanFrom(from) }
  }
  const execute = async (how: 'validé' | 'corrigé' | 'consigne', p: any) => {
    const j = await post({ action: 'execute', how, entity: p.entity ?? entity, doc_type: p.doc_type ?? docType, mission_id: p.mission === undefined ? c.proposal?.mission?.id || null : p.mission?.id || null,
      instruction: how === 'validé' ? null : (planFrom === 'fix' ? fixSay : freeSay), steps: p.steps, understood: p.understood || null, keep: how === 'consigne' ? true : keep })
    if (j) { setC(j); setPlan(null); say(how === 'validé' ? 'Enregistré, gestes faits, l’app a appris' : 'Fait, et retenu pour la suite') }
  }
  const search = async () => { if (q.trim().length < 3) return; const j = await (await fetch(`/api/courrier/missions?q=${encodeURIComponent(q.trim())}`)).json(); setHits(j.missions || []) }

  const back = <div className="flex items-center gap-2.5"><button type="button" onClick={onBack} className="min-h-[40px] rounded-btn border border-border bg-surface px-3 text-sm font-semibold">‹ Courrier</button>
    {c && <div className="min-w-0"><div className="font-display font-bold text-ink truncate">{c.reading?.sender || (c.status === 'reading' ? 'Lecture en cours…' : 'Courrier')}</div><div className="text-xs text-ink-muted">{c.source === 'photo' ? 'photo' : c.source === 'fichier' ? 'fichier' : 'scan'} du {dmy(c.created_at)} à {hhmm(c.created_at)} · {c.pages?.length || 0} page(s)</div></div>}</div>
  if (!c) return <div className="max-w-2xl mx-auto px-4 py-4 flex flex-col gap-3">{back}<p className="text-sm text-ink-muted">{err || 'Chargement…'}</p></div>

  const P = c.proposal || {}, d = c.decision
  const pagesBox = <div className="rounded-card border border-border bg-surface p-3 flex flex-col gap-3">
    <div className="flex gap-2 overflow-x-auto">{(c.page_urls || []).map((p: any, i: number) => p.url ? <a key={i} href={p.url} target="_blank" rel="noreferrer" className="shrink-0">
      {p.mime === 'application/pdf' ? <div className="w-16 h-22 min-h-[88px] rounded-md border border-strong bg-surface-2 grid place-items-center text-xs font-bold text-ink-muted px-2">PDF {i + 1}</div> : <img src={p.url} alt={`Page ${i + 1}`} className="w-16 h-22 min-h-[88px] object-cover rounded-md border border-strong" />}</a> : null)}</div>
    {c.reading && <><p className="text-sm text-ink">{c.reading.summary}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">{(c.reading.facts || []).map(([k, v]: [string, string], i: number) => <Fragment key={i}><dt className="text-ink-muted">{k}</dt><dd className="text-ink">{v}</dd></Fragment>)}</dl></>}
  </div>

  const planBox = plan && <div className="rounded-xl border border-info bg-info-soft p-3 flex flex-col gap-2">
    <H3>Ce que j’ai compris</H3>
    {plan.understood && <p className="text-sm text-ink">{plan.understood}</p>}
    <ol className="list-decimal pl-5 flex flex-col gap-1 text-sm text-ink">{plan.steps.map((s: any, i: number) => <li key={i}>{s.label}</li>)}
      <li className="text-ink-secondary">{keep || planFrom === 'say' ? `Retenir pour ${c.reading?.sender || 'cet expéditeur'} : ${plan.corrections?.length ? 'ce classement' : ''}${plan.corrections?.length && (planFrom === 'fix' ? fixSay : freeSay).trim() ? ' et ' : ''}${(planFrom === 'fix' ? fixSay : freeSay).trim() ? 'cette procédure' : ''}${!plan.corrections?.length && !(planFrom === 'fix' ? fixSay : freeSay).trim() ? 'ce choix' : ''} ; je le proposerai d’office la prochaine fois, toujours à valider.` : 'Ne rien retenir : cette consigne vaut pour ce courrier seulement.'}</li></ol>
    <div className="flex gap-2"><Btn kind="brand" className="flex-1" disabled={busy} onClick={() => execute(planFrom === 'fix' ? 'corrigé' : 'consigne', plan)}>{busy ? 'En cours…' : 'Faire ça'}</Btn><Btn kind="quiet" onClick={() => setPlan(null)}>Reformuler</Btn></div>
  </div>

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 flex flex-col gap-3">
      {back}
      {err && <p className="rounded-xl bg-critical-soft text-critical px-3 py-2 text-sm font-semibold">{err}</p>}
      {pagesBox}

      {c.status === 'reading' && <div className="rounded-card border border-border bg-surface p-4 text-sm text-ink-secondary flex items-center gap-2"><span className="inline-block w-3 h-3 border-2 border-info border-t-transparent rounded-full animate-spin" />Lecture du courrier en cours…</div>}
      {c.status === 'error' && <div className="rounded-card border border-critical bg-critical-soft p-4 flex flex-col gap-2"><div className="font-semibold text-critical">Lecture impossible</div><p className="text-sm text-ink">{c.error}</p>
        <div className="flex gap-2"><Btn kind="brand" disabled={busy} onClick={async () => { const j = await post({ action: 'read' }); if (j) setC(j) }}>{busy ? 'Lecture…' : 'Relire'}</Btn><Btn kind="quiet" onClick={async () => { const j = await post({ action: 'ignore' }); if (j) setC(j) }}>Ignorer</Btn></div></div>}

      {d && <div className="rounded-card border border-border bg-surface p-4 flex flex-col gap-2">
        <div className="font-display text-lg font-bold text-ink">{d.how === 'ignoré' ? '🗑️ Classé sans suite' : '✓ Enregistré'}</div>
        <p className="text-sm text-ink-secondary">{d.how} à {hhmm(d.at)} par {d.by_name || '—'}{d.entity ? ` · ${ENTITIES[d.entity as EntityKey]?.label}` : ''}{d.doc_type ? ` · ${DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES]}` : ''}.</p>
        {d.instruction && <p className="text-sm"><b>Consigne :</b> « {d.instruction} »</p>}
        {(d.results || []).length > 0 && <ul className="flex flex-col gap-1">{d.results.map((r: any, i: number) => <li key={i} className={`text-sm ${r.ok ? 'text-success' : 'text-critical'}`}>{r.ok ? '✓' : '✕'} {d.steps?.[i]?.label ? `${d.steps[i].label} — ` : ''}{r.note}</li>)}</ul>}
        {d.mission_id && <Link href={`/dispatch/${d.mission_id}`} className="self-start underline text-sm font-semibold">Ouvrir la fiche</Link>}
      </div>}

      {c.status === 'to_validate' && <div className="rounded-card border border-border bg-surface p-4 shadow-md flex flex-col gap-3">
        <div className="font-display text-xl font-bold text-ink">{P.weak ? 'Proposition incertaine : à toi de dire.' : 'Voici ce que l’app propose.'}</div>
        <div className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 text-sm items-baseline">
          <H3>Pour</H3><div><b>{P.entity ? ENTITIES[P.entity as EntityKey].label : 'Société non reconnue'}</b>{P.entity && <span className="text-xs text-ink-muted ml-1.5">{P.entity_conf} % sûr</span>}</div>
          <H3>Type</H3><div><b>{DOC_TYPES[P.doc_type as keyof typeof DOC_TYPES]}</b><span className="text-xs text-ink-muted ml-1.5">{P.type_conf} % sûr</span></div>
          <H3>Rattaché à</H3><div><b>{P.mission?.label || 'Aucune fiche trouvée'}</b></div>
          <H3>Gestes</H3><ol className="list-decimal pl-4 flex flex-col gap-0.5">{(P.plan?.steps || []).map((s: any, i: number) => <li key={i}>{s.label}</li>)}</ol>
        </div>
        {c.rule?.instruction && <div className="rounded-xl border border-info bg-surface-2 px-3 py-2 text-sm"><b>Procédure retenue pour {c.rule.sender_label}</b> : « {c.rule.instruction} »</div>}
        {c.rule && <p className="text-xs text-ink-muted">Déjà validé {c.rule.validated_count} fois pour cet expéditeur{c.rule.corrected_count ? `, corrigé ${c.rule.corrected_count} fois` : ''}.</p>}
        <div className="flex flex-wrap gap-2">
          {!P.weak && <Btn kind="brand" className="flex-1" disabled={busy} onClick={() => execute('validé', { steps: P.plan?.steps || [], entity: P.entity, doc_type: P.doc_type, mission: undefined })}>{busy ? 'En cours…' : 'C’est ça'}</Btn>}
          <Btn className="flex-1" onClick={() => { setFixing(f => !f); setPlan(null) }}>{fixing || P.weak ? 'Corriger ▴' : 'Corriger'}</Btn>
          <Btn kind="quiet" disabled={busy} onClick={async () => { const j = await post({ action: 'ignore' }); if (j) { setC(j); say('Classé sans suite') } }}>Ignorer</Btn>
        </div>

        {(fixing || P.weak) && <div className="border-t border-border pt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5"><H3>Pour</H3><div className="flex flex-wrap gap-1.5">{Object.entries(ENTITIES).map(([k, v]) =>
            <button key={k} type="button" aria-pressed={entity === k} onClick={() => { setEntity(k); setPlan(null) }} className={`min-h-[40px] rounded-btn border px-3 text-sm ${entity === k ? 'border-info bg-info-soft text-info font-semibold' : 'border-strong bg-surface text-ink'}`}>{v.label}</button>)}</div></div>
          <div className="flex flex-col gap-1.5"><H3>Type</H3><div className="flex flex-wrap gap-1.5">{Object.entries(DOC_TYPES).map(([k, v]) =>
            <button key={k} type="button" aria-pressed={docType === k} onClick={() => { setDocType(k); setPlan(null) }} className={`min-h-[40px] rounded-btn border px-3 text-sm ${docType === k ? 'border-info bg-info-soft text-info font-semibold' : 'border-strong bg-surface text-ink'}`}>{v}</button>)}</div></div>
          <div className="flex flex-col gap-1.5"><H3>Rattacher à</H3>
            <div className="text-sm">{mission ? <span><b>{mission.label}</b> <button type="button" className="underline text-ink-muted ml-1" onClick={() => { setMission(null); setPlan(null) }}>détacher</button></span> : <span className="text-ink-muted">Aucune fiche</span>}</div>
            {(P.candidates || []).filter((x: any) => x.id !== mission?.id).length > 0 && <div className="flex flex-col gap-1">{P.candidates.filter((x: any) => x.id !== mission?.id).map((x: any) => <button key={x.id} type="button" onClick={() => { setMission(x); setPlan(null) }} className="text-left rounded-btn border border-strong bg-surface px-3 py-2 text-sm min-h-[40px]">{x.label}</button>)}</div>}
            <div className="flex gap-2"><input className={input} placeholder="Plaque, n° de fiche ou de dossier" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search() }} aria-label="Rechercher une fiche" /><Btn onClick={search} disabled={q.trim().length < 3}>Rechercher</Btn></div>
            {hits.map((x: any) => <button key={x.id} type="button" onClick={() => { setMission(x); setHits([]); setPlan(null) }} className="text-left rounded-btn border border-strong bg-surface px-3 py-2 text-sm min-h-[40px]">{x.label}</button>)}
          </div>
          <div className="flex flex-col gap-1.5"><H3>Explique à l’agent ce que tu veux</H3>
            <textarea rows={3} className={input} value={fixSay} onChange={e => { setFixSay(e.target.value); setPlan(null) }} placeholder="Ex. : ce n’est pas une demande de facture, c’est une contestation. Ne facture rien, ouvre une tâche pour Olivier et prépare une réponse avec les photos d’arrivée au parc." />
            <label className="flex items-center gap-2 text-sm text-ink-secondary min-h-[44px] cursor-pointer"><input type="checkbox" className="w-5 h-5" checked={keep} onChange={e => setKeep(e.target.checked)} /> Retenir cette procédure pour les prochains courriers de {c.reading?.sender || 'cet expéditeur'}</label>
          </div>
          {!(plan && planFrom === 'fix') && <Btn kind="brand" disabled={busy} onClick={() => understand('fix')}>{busy ? 'L’agent réfléchit…' : 'Enregistrer avec ces corrections'}</Btn>}
          {planFrom === 'fix' && planBox}
        </div>}

        {!fixing && !P.weak && <div className="border-t border-border pt-3 flex flex-col gap-2">
          <H3>Ou dis-lui quoi faire</H3>
          <textarea rows={2} className={input} value={freeSay} onChange={e => { setFreeSay(e.target.value); setPlan(null) }} placeholder="Ex. : envoie la facture de gardiennage à Ethias, préviens Jona, et note un rappel dans 7 jours" />
          {!(plan && planFrom === 'say') && <Btn disabled={busy || !freeSay.trim()} onClick={() => understand('say')}>{busy ? 'L’agent réfléchit…' : 'L’agent comprend'}</Btn>}
          {planFrom === 'say' && planBox}
        </div>}
      </div>}
      {c.tasks?.length > 0 && <div className="rounded-card border border-border bg-surface p-3 flex flex-col gap-1.5"><H3>Tâches nées de ce courrier</H3>{c.tasks.map((t: any) => <div key={t.id} className={`text-sm ${t.done_at ? 'line-through text-ink-muted' : 'text-ink'}`}>{t.title} · pour le {dmy(t.due_at)}</div>)}</div>}
      {flash && <div className="fixed left-1/2 -translate-x-1/2 bottom-5 rounded-full bg-ink text-surface px-4 py-2 text-sm font-semibold shadow-md z-50">{flash}</div>}
    </div>
  )
}

function Tasks({ data, load, onOpen }: { data: any; load: () => void; onOpen: (id: string) => void }) {
  const [mine, setMine] = useState(true)
  const list = (data.tasks || []).filter((t: any) => !mine || t.assignee_id === data.me)
  const open = list.filter((t: any) => !t.done_at), done = list.filter((t: any) => t.done_at)
  const toggle = async (t: any) => { await fetch(`/api/courrier/tasks/${t.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: !t.done_at }) }); load() }
  const late = (t: any) => !t.done_at && t.due_at && new Date(t.due_at) < new Date()
  const row = (t: any) => <div key={t.id} className="rounded-card border border-border bg-surface p-3 flex items-start gap-3">
    <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={!!t.done_at} onChange={() => toggle(t)} aria-label="Fait" />
    <div className="flex-1 min-w-0"><div className={`text-sm ${t.done_at ? 'line-through text-ink-muted' : 'text-ink font-semibold'}`}>{t.title}</div>
      <div className="text-xs text-ink-muted">{t.assignee_name || '—'} · {late(t) ? <b className="text-critical">en retard ({dmy(t.due_at)})</b> : `pour le ${dmy(t.due_at)}`}{t.done_at ? ` · fait par ${t.done_by_name || '—'} à ${hhmm(t.done_at)}` : ''}</div></div>
    <button type="button" className="text-sm underline text-ink-muted shrink-0 min-h-[32px]" onClick={() => onOpen(t.courrier_id)}>Courrier</button>
  </div>
  return <Section title="Tâches du courrier" count={open.length}>
    <div className="flex gap-1.5"><button type="button" onClick={() => setMine(true)} aria-pressed={mine} className={`min-h-[36px] rounded-full border px-3 text-sm font-semibold ${mine ? 'bg-ink text-surface border-ink' : 'bg-surface border-border'}`}>Les miennes</button><button type="button" onClick={() => setMine(false)} aria-pressed={!mine} className={`min-h-[36px] rounded-full border px-3 text-sm font-semibold ${!mine ? 'bg-ink text-surface border-ink' : 'bg-surface border-border'}`}>Toute l’équipe</button></div>
    {open.length === 0 ? <Empty>Aucune tâche ouverte{mine ? ' pour vous' : ''}.</Empty> : open.map(row)}
    {done.length > 0 && <><div className="text-sm text-ink-muted mt-1">Faites aujourd’hui</div>{done.map(row)}</>}
  </Section>
}

function Learned({ data, load, say }: { data: any; load: () => void; say: (m: string) => void }) {
  const rules = data.rules || []
  const forget = async (r: any) => { if (!confirm(`Oublier ce que l’app a retenu pour ${r.sender_label} ?`)) return; await fetch(`/api/courrier/rules?key=${encodeURIComponent(r.sender_key)}`, { method: 'DELETE' }); say('Oublié'); load() }
  return <Section title="Ce que l’app a appris" count={rules.length}>
    {rules.length === 0 ? <Empty>Rien encore. Chaque validation et chaque procédure expliquée en corrigeant apparaîtra ici, par expéditeur.</Empty> :
      rules.map((r: any) => <div key={r.sender_key} className="rounded-card border border-border bg-surface p-3 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap"><b className="text-ink">{r.sender_label}</b><EntChip e={r.entity} />{r.doc_type && <Chip>{DOC_TYPES[r.doc_type as keyof typeof DOC_TYPES]}</Chip>}</div>
        {r.instruction ? <p className="text-sm text-ink">Procédure : « {r.instruction} »</p> : <p className="text-sm text-ink-muted">Classement seulement, pas de consigne particulière.</p>}
        <div className="flex items-center gap-2 text-xs text-ink-muted"><span>validé {r.validated_count} fois · corrigé {r.corrected_count} fois · {r.updated_by_name || '—'} le {dmy(r.updated_at)}</span><button type="button" onClick={() => forget(r)} className="ml-auto underline min-h-[32px]">Oublier</button></div>
      </div>)}
    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-ink-secondary"><b>Plus tard</b> : quand un expéditeur a été validé sans correction assez souvent, on pourra décider de laisser l’app agir seule pour lui.</div>
  </Section>
}
