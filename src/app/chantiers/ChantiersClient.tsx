'use client'
// src/app/chantiers/ChantiersClient.tsx
//
// Le tableau des chantiers : quatre colonnes, une carte par chantier, un journal.
// « Totalement dynamique » (Olivier 09/09/2026) : chaque geste est enregistré
// tout de suite, et la page se resynchronise toute seule — toutes les 8 s tant
// qu'elle est visible, et dès qu'on revient dessus — pour refléter ce que
// quelqu'un d'autre a fait. Les tables sont server-only : pas de realtime
// Supabase depuis le navigateur, on repasse par l'API.

import { useCallback, useEffect, useRef, useState } from 'react'
import { CHANTIER_COLUMNS, type Chantier, type ChantierLog, type ChantierStatus } from '@/lib/chantiers'

const POLL_MS = 8_000

const TONE: Record<ChantierStatus, string> = {
  cours:   'bg-blue-600 text-white',
  attente: 'bg-amber-500 text-white',
  fini:    'bg-emerald-600 text-white',
  dormant: 'bg-surface-2 text-ink-muted border',
}
const fmtDay = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit' }) : ''
const fmtWhen = (v: string) =>
  new Date(v).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

type Draft = { id: string | null; title: string; tag: string; status: ChantierStatus; note: string }

export default function ChantiersClient({ initial, initialLogs }: { initial: Chantier[]; initialLogs: ChantierLog[] }) {
  const [rows, setRows] = useState<Chantier[]>(initial)
  const [logs, setLogs] = useState<ChantierLog[]>(initialLogs)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)   // id du chantier en cours d'écriture
  const [status, setStatus] = useState<string>('')
  const [syncedAt, setSyncedAt] = useState<number>(Date.now())
  const inflight = useRef(false)

  // ── Synchronisation ──────────────────────────────────────────────────────
  const sync = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const r = await fetch(`/api/chantiers?t=${Date.now()}`, { cache: 'no-store' })
      const j = await r.json()
      if (r.ok && Array.isArray(j.chantiers)) { setRows(j.chantiers); setLogs(j.logs || []); setSyncedAt(Date.now()) }
    } catch { /* on garde l'état courant, la prochaine passe réessaiera */ }
    finally { inflight.current = false }
  }, [])

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') sync() }
    const iv = setInterval(tick, POLL_MS)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(iv); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick) }
  }, [sync])

  // ── Écritures ────────────────────────────────────────────────────────────
  const say = (m: string) => { setStatus(m); setTimeout(() => setStatus(s => (s === m ? '' : s)), 2500) }

  const patch = async (c: Chantier, body: Partial<Pick<Chantier, 'title' | 'tag' | 'status' | 'note'>>, optimistic?: Partial<Chantier>) => {
    setBusy(c.id)
    if (optimistic) setRows(p => p.map(x => x.id === c.id ? { ...x, ...optimistic } : x))
    try {
      const r = await fetch(`/api/chantiers/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      say('Enregistré')
    } catch (e: any) { say(`⚠ ${e.message || 'Enregistrement impossible'}`) }
    finally { setBusy(null); sync() }
  }

  const move = (c: Chantier, delta: number) => {
    const i = CHANTIER_COLUMNS.findIndex(k => k.key === c.status)
    const next = CHANTIER_COLUMNS[i + delta]
    if (!next) return
    patch(c, { status: next.key }, { status: next.key })
  }

  const remove = async (c: Chantier) => {
    if (!window.confirm(`Supprimer « ${c.title} » ?`)) return
    setBusy(c.id)
    setRows(p => p.filter(x => x.id !== c.id))
    try {
      const r = await fetch(`/api/chantiers/${c.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      say('Supprimé')
    } catch (e: any) { say(`⚠ ${e.message}`) }
    finally { setBusy(null); sync() }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft) return
    const title = draft.title.trim()
    if (!title) return
    if (draft.id) {
      const c = rows.find(x => x.id === draft.id)
      if (c) await patch(c, { title, tag: draft.tag, status: draft.status, note: draft.note })
    } else {
      try {
        const r = await fetch('/api/chantiers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, tag: draft.tag, status: draft.status, note: draft.note }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
        say('Ajouté')
      } catch (e: any) { say(`⚠ ${e.message}`) }
      finally { sync() }
    }
    setDraft(null)
  }

  const openForm = (c?: Chantier) => setDraft(c
    ? { id: c.id, title: c.title, tag: c.tag || '', status: c.status, note: c.note || '' }
    : { id: null, title: '', tag: '', status: 'attente', note: '' })

  const ago = Math.max(0, Math.round((Date.now() - syncedAt) / 1000))

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Chantiers</h1>
          <p className="text-ink-muted text-xs mt-0.5">
            {rows.length} chantiers · {CHANTIER_COLUMNS.map(c => `${c.label} ${rows.filter(r => r.status === c.key).length}`).join(' · ')}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-ink-faint" title="La page se resynchronise toute seule">{status || `synchronisé il y a ${ago < 5 ? 'un instant' : ago + ' s'}`}</span>
          <button onClick={() => sync()} className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold text-ink-secondary hover:text-ink">↻</button>
          <button onClick={() => openForm()} className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold">＋ Ajouter</button>
        </div>
      </div>

      {draft && (
        <form onSubmit={submit} className="bg-surface border rounded-2xl p-4 grid grid-cols-1 md:grid-cols-[1fr_180px_180px] gap-3">
          <input autoFocus value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Intitulé du chantier" required
            className="border rounded-lg px-3 py-2 bg-surface text-ink text-sm" />
          <input value={draft.tag} onChange={e => setDraft({ ...draft, tag: e.target.value })} placeholder="Étiquette (Facturation, Saisie…)"
            className="border rounded-lg px-3 py-2 bg-surface text-ink text-sm" />
          <select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as ChantierStatus })}
            className="border rounded-lg px-3 py-2 bg-surface text-ink text-sm">
            {CHANTIER_COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <textarea value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} rows={2} placeholder="Où ça en est, ce qui bloque, la prochaine étape"
            className="md:col-span-3 border rounded-lg px-3 py-2 bg-surface text-ink text-sm resize-y" />
          <div className="md:col-span-3 flex gap-2 justify-end">
            <button type="button" onClick={() => setDraft(null)} className="px-3 py-1.5 rounded-lg border text-xs font-semibold text-ink-secondary">Annuler</button>
            <button type="submit" className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold">{draft.id ? 'Enregistrer' : 'Ajouter'}</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
        {CHANTIER_COLUMNS.map((col, ci) => {
          const items = rows.filter(r => r.status === col.key)
          return (
            <section key={col.key} className="bg-surface-2 border rounded-2xl p-2.5">
              <div className="flex items-center gap-2 px-1 mb-0.5">
                <h2 className="text-xs font-bold uppercase tracking-wide text-ink">{col.label}</h2>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TONE[col.key]}`}>{items.length}</span>
              </div>
              <p className="text-[11px] text-ink-muted px-1 mb-2">{col.hint}</p>
              {items.length === 0 && <p className="text-xs text-ink-faint italic px-1 py-2">Rien ici.</p>}
              {items.map(c => (
                <article key={c.id} className={`bg-surface border rounded-xl p-3 mb-2 ${busy === c.id ? 'opacity-60' : ''}`}>
                  <div className="text-[10px] uppercase tracking-wider text-ink-faint font-mono mb-0.5">
                    {c.tag || '—'} · {fmtDay(c.updated_at)}{c.updated_by ? ` · ${c.updated_by}` : ''}
                  </div>
                  <h3 className="text-sm font-semibold text-ink leading-snug">{c.title}</h3>
                  {c.note && <p className="text-xs text-ink-secondary mt-1 leading-relaxed">{c.note}</p>}
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {ci > 0 && <button disabled={busy === c.id} onClick={() => move(c, -1)} title={`Vers ${CHANTIER_COLUMNS[ci - 1].label}`} className="px-2 py-1 rounded-md border text-[11px] font-semibold text-ink-secondary hover:text-ink disabled:opacity-40">←</button>}
                    {ci < CHANTIER_COLUMNS.length - 1 && <button disabled={busy === c.id} onClick={() => move(c, 1)} title={`Vers ${CHANTIER_COLUMNS[ci + 1].label}`} className="px-2 py-1 rounded-md border text-[11px] font-semibold text-ink-secondary hover:text-ink disabled:opacity-40">→</button>}
                    <button disabled={busy === c.id} onClick={() => openForm(c)} className="px-2 py-1 rounded-md border text-[11px] font-semibold text-ink-secondary hover:text-ink disabled:opacity-40">Modifier</button>
                    <button disabled={busy === c.id} onClick={() => remove(c)} className="px-2 py-1 rounded-md border text-[11px] font-semibold text-ink-faint hover:text-critical disabled:opacity-40">Supprimer</button>
                  </div>
                </article>
              ))}
            </section>
          )
        })}
      </div>

      <section className="bg-surface border rounded-2xl p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-secondary mb-2">Journal</h2>
        {logs.length === 0 && <p className="text-xs text-ink-faint italic">Rien encore.</p>}
        <ol className="divide-y">
          {logs.map(l => (
            <li key={l.id} className="py-1.5 flex gap-3 items-baseline text-xs">
              <span className="font-mono text-ink-faint shrink-0 w-[92px]">{fmtWhen(l.at)}</span>
              <span className="text-ink-secondary">{l.text}{l.actor ? <span className="text-ink-faint"> — {l.actor}</span> : null}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
