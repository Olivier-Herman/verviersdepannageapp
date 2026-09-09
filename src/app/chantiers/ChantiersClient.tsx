'use client'
// src/app/chantiers/ChantiersClient.tsx
//
// Le tableau des chantiers : quatre colonnes, une carte par chantier, un journal.
// LECTURE SEULE (Olivier 09/09/2026 : « je ne modifie rien, c'est toi qui
// modifies le statut ») — les statuts bougent par migration, à chaque étape
// livrée, et la page les reflète. « Totalement dynamique » : elle se
// resynchronise toute seule, toutes les 8 s tant qu'elle est visible et dès
// qu'on revient dessus. Les tables sont server-only : pas de realtime Supabase
// depuis le navigateur, on repasse par l'API.

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

export default function ChantiersClient({ initial, initialLogs, dbError = null }: { initial: Chantier[]; initialLogs: ChantierLog[]; dbError?: string | null }) {
  const [rows, setRows] = useState<Chantier[]>(initial)
  const [logs, setLogs] = useState<ChantierLog[]>(initialLogs)
  const [syncedAt, setSyncedAt] = useState<number>(Date.now())
  const [now, setNow] = useState<number>(Date.now())
  const inflight = useRef(false)

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
    const clock = setInterval(() => setNow(Date.now()), 1000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(iv); clearInterval(clock); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick) }
  }, [sync])

  const ago = Math.max(0, Math.round((now - syncedAt) / 1000))

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
          <span className="text-[11px] text-ink-faint" title="La page se resynchronise toute seule">
            synchronisé il y a {ago < 5 ? 'un instant' : `${ago} s`}
          </span>
          <button onClick={() => sync()} className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold text-ink-secondary hover:text-ink" title="Resynchroniser maintenant">↻</button>
        </div>
      </div>

      {dbError && (
        <div className="bg-critical-soft border border-critical text-critical rounded-2xl px-4 py-3 text-sm font-medium">
          ⚠ {dbError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
        {CHANTIER_COLUMNS.map(col => {
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
                <article key={c.id} className="bg-surface border rounded-xl p-3 mb-2">
                  <div className="text-[10px] uppercase tracking-wider text-ink-faint font-mono mb-0.5">
                    {c.tag || '—'} · {fmtDay(c.updated_at)}{c.updated_by ? ` · ${c.updated_by}` : ''}
                  </div>
                  <h3 className="text-sm font-semibold text-ink leading-snug">{c.title}</h3>
                  {c.note && <p className="text-xs text-ink-secondary mt-1 leading-relaxed">{c.note}</p>}
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
