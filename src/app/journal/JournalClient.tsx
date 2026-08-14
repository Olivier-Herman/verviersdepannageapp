'use client'

// src/app/journal/JournalClient.tsx
// Historique du journal terrain, fenêtre réglable : 24h / 30 jours / 6 mois.
// Consomme /api/boarding-log?days=N&journalOnly=1 (même phrasé que le slide).

import { useEffect, useState, useMemo } from 'react'
import { RefreshCw, Search } from 'lucide-react'

interface Ev {
  at: string; action: string; text: string; ton: 'info' | 'ok' | 'alerte'
  number: number | null; plate: string | null; source: string | null
  driver: string | null; repeats: number; notes: string
}

const RANGES = [
  { label: '24 h',     days: 1 },
  { label: '30 jours', days: 30 },
  { label: '6 mois',   days: 180 },
]
const TON_DOT: Record<string, string> = { info: 'bg-sky-400', ok: 'bg-emerald-400', alerte: 'bg-red-400' }

export default function JournalClient() {
  const [days, setDays]       = useState(1)
  const [events, setEvents]   = useState<Ev[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [q, setQ]             = useState('')

  async function load(d: number) {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/boarding-log?days=${d}&journalOnly=1`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setEvents(j.events || [])
    } catch (e: any) { setError(e.message || 'Erreur réseau') }
    finally { setLoading(false) }
  }
  useEffect(() => { load(days) }, [days])

  // Filtre texte (plaque, chauffeur, source, texte)
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return events
    return events.filter(e =>
      [e.text, e.plate, e.driver, e.source, String(e.number)].filter(Boolean).join(' ').toLowerCase().includes(s))
  }, [events, q])

  // Groupé par jour
  const byDay = useMemo(() => {
    const map = new Map<string, Ev[]>()
    for (const e of filtered) {
      const d = new Date(e.at).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: '2-digit', month: 'long' })
      ;(map.get(d) || map.set(d, []).get(d)!).push(e)
    }
    return [...map.entries()]
  }, [filtered])

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-ink text-2xl font-bold">📓 Journal</h1>
          <p className="text-ink-muted text-sm">Les gestes du terrain — historique {RANGES.find(r => r.days === days)?.label.toLowerCase()}.</p>
        </div>
        <div className="flex items-center gap-1.5 bg-surface-2 border rounded-xl p-1">
          {RANGES.map(r => (
            <button key={r.days} onClick={() => setDays(r.days)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${days === r.days ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 flex items-center gap-2 bg-surface-2 border rounded-xl px-3 py-2">
          <Search size={15} className="text-ink-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrer : plaque, chauffeur, source…"
            className="flex-1 bg-transparent text-sm text-ink outline-none" />
        </div>
        <button onClick={() => load(days)} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 bg-surface-2 border rounded-xl text-sm text-ink hover:bg-surface disabled:opacity-40">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <div className="bg-critical-soft border border-critical rounded-xl p-3 text-critical text-sm mb-4">⚠ {error}</div>}

      {loading && !events.length ? (
        <div className="flex items-center justify-center py-16 text-ink-muted"><RefreshCw size={22} className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-surface-2 border rounded-2xl p-8 text-center text-ink-muted">Aucun évènement sur cette période.</div>
      ) : (
        <div className="space-y-5">
          <p className="text-ink-faint text-xs">{filtered.length} évènement{filtered.length > 1 ? 's' : ''}</p>
          {byDay.map(([day, evs]) => (
            <div key={day}>
              <p className="text-ink-muted text-xs font-semibold uppercase tracking-wider mb-2 sticky top-0 bg-surface/80 backdrop-blur py-1">{day}</p>
              <div className="space-y-1.5">
                {evs.map((e, i) => (
                  <div key={i} className="flex items-start gap-3 bg-surface border rounded-xl px-3 py-2">
                    <span className="text-ink-faint text-xs tabular-nums pt-0.5 w-10 flex-shrink-0">{hhmm(e.at)}</span>
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${TON_DOT[e.ton] || 'bg-slate-400'}`} />
                    <span className="text-ink text-sm min-w-0">
                      {e.number
                        ? <a href={`/dispatch/${e.number}`} className="hover:underline">{e.text}</a>
                        : e.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
