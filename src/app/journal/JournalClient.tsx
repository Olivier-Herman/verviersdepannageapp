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

// Une icône par geste — de quoi scanner le journal d'un coup d'œil.
const ACTION_ICON: Record<string, string> = {
  accept: '🤝', on_way: '🚗', on_site: '📍', load_vehicle: '🚛', park: '🅿️',
  completed: '🏁', flux2_closed: '✅',
  touring_closed: '🔒', vab_closed: '🔒', axa_closed: '🔒',
  touring_synced: '🔄', vab_synced: '🔄', kaze_synced: '🔄',
  invoiced: '💶', invoice_autoposted: '💶',
  force_status_to_invoice: '⚠️', force_status_parked: '⚠️', force_status_completed: '⚠️',
  request_relivraison: '🔁', kaze_rel_merged: '🔗',
}
const iconFor = (a: string) => ACTION_ICON[a] || (/error|failed/i.test(a) ? '❗' : '•')

// Teinte de la bulle selon le ton (info / ok / alerte).
const TON_BUBBLE: Record<string, string> = {
  info:   'bg-sky-500/15 ring-sky-500/25',
  ok:     'bg-emerald-500/15 ring-emerald-500/25',
  alerte: 'bg-red-500/15 ring-red-500/30',
}

// Badge source coloré par clé (le libellé vient du texte).
const SRC_COLOR: Record<string, string> = {
  touring: 'bg-indigo-500/15 text-indigo-500', vab: 'bg-amber-500/15 text-amber-600',
  axa: 'bg-sky-500/15 text-sky-600', kaze: 'bg-violet-500/15 text-violet-500',
  mondial: 'bg-blue-500/15 text-blue-500', eurocross: 'bg-teal-500/15 text-teal-500',
  anwb: 'bg-yellow-500/15 text-yellow-600', ethias: 'bg-rose-500/15 text-rose-500',
  police_snc: 'bg-orange-500/15 text-orange-600', sia_couvert: 'bg-emerald-500/15 text-emerald-600',
  prive: 'bg-slate-500/15 text-slate-500',
}
const srcColor = (k: string | null) => (k && SRC_COLOR[k]) || 'bg-slate-500/15 text-slate-500'

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

  // Auto-refresh SILENCIEUX toutes les 30 s — uniquement sur la vue 24h (live).
  useEffect(() => {
    if (days !== 1) return
    const iv = setInterval(async () => {
      try {
        const res = await fetch('/api/boarding-log?days=1&journalOnly=1', { cache: 'no-store' })
        const j = await res.json()
        if (res.ok) setEvents(j.events || [])
      } catch { /* silencieux */ }
    }, 30_000)
    return () => clearInterval(iv)
  }, [days])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return events
    return events.filter(e =>
      [e.text, e.plate, e.driver, e.source, String(e.number)].filter(Boolean).join(' ').toLowerCase().includes(s))
  }, [events, q])

  const byDay = useMemo(() => {
    const map = new Map<string, Ev[]>()
    for (const e of filtered) {
      const d = new Date(e.at).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: '2-digit', month: 'long' })
      ;(map.get(d) || map.set(d, []).get(d)!).push(e)
    }
    return [...map.entries()]
  }, [filtered])

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

  // Sépare le badge source (suffixe « · X ») du texte, pour le colorer.
  const split = (text: string): { body: string; badge: string | null } => {
    const m = text.match(/^(.*?)\s+·\s+([^·]+)$/)
    return m ? { body: m[1], badge: m[2].trim() } : { body: text, badge: null }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-ink text-2xl font-black tracking-tight flex items-center gap-2">
            <span className="text-3xl">📓</span> Journal
          </h1>
          <p className="text-ink-muted text-sm">Le terrain en direct — {RANGES.find(r => r.days === days)?.label.toLowerCase()}
            {days === 1 && <span className="ml-1.5 inline-flex items-center gap-1 text-emerald-500"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />live</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-surface-2 border rounded-full p-1">
          {RANGES.map(r => (
            <button key={r.days} onClick={() => setDays(r.days)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition ${days === r.days ? 'bg-brand text-white shadow-sm' : 'text-ink-secondary hover:text-ink'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-5">
        <div className="flex-1 flex items-center gap-2 bg-surface-2 border rounded-full px-4 py-2.5">
          <Search size={16} className="text-ink-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrer : plaque, chauffeur, source…"
            className="flex-1 bg-transparent text-sm text-ink outline-none" />
          {q && <button onClick={() => setQ('')} className="text-ink-faint hover:text-ink text-xs">✕</button>}
        </div>
        <button onClick={() => load(days)} disabled={loading}
          className="flex items-center justify-center w-11 h-11 bg-surface-2 border rounded-full text-ink hover:bg-surface disabled:opacity-40">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <div className="bg-critical-soft border border-critical rounded-2xl p-3 text-critical text-sm mb-4">⚠ {error}</div>}

      {loading && !events.length ? (
        <div className="flex items-center justify-center py-20 text-ink-muted"><RefreshCw size={24} className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-surface-2 border rounded-3xl p-10 text-center text-ink-muted">
          <p className="text-4xl mb-2">🌙</p>Rien à signaler sur cette période.
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-ink-faint text-xs font-medium">{filtered.length} évènement{filtered.length > 1 ? 's' : ''}</p>
          {byDay.map(([day, evs]) => (
            <div key={day}>
              <div className="flex items-center gap-2 mb-3 sticky top-0 z-10 py-1 bg-gradient-to-b from-surface via-surface to-transparent">
                <span className="text-ink text-sm font-bold capitalize">{day}</span>
                <span className="text-ink-faint text-xs bg-surface-2 border rounded-full px-2 py-0.5">{evs.length}</span>
              </div>
              {/* timeline */}
              <div className="relative pl-1">
                <div className="space-y-2">
                  {evs.map((e, i) => {
                    const { body, badge } = split(e.text)
                    return (
                      <div key={i} className="group flex items-start gap-3 bg-surface border rounded-2xl pl-2.5 pr-3 py-2.5 hover:shadow-sm hover:border-brand/30 transition">
                        <span className="text-ink-faint text-[11px] tabular-nums pt-2.5 w-9 flex-shrink-0 text-right">{hhmm(e.at)}</span>
                        <span className={`mt-0.5 w-9 h-9 flex-shrink-0 rounded-full ring-1 flex items-center justify-center text-base ${TON_BUBBLE[e.ton] || TON_BUBBLE.info}`}>
                          {iconFor(e.action)}
                        </span>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-ink text-sm leading-snug">
                              {e.number
                                ? <a href={`/dispatch/${e.number}`} className="hover:underline decoration-brand/40">{body}</a>
                                : body}
                            </span>
                            {badge && (
                              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${srcColor(e.source)}`}>{badge}</span>
                            )}
                            {e.repeats > 1 && (
                              <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-500 flex-shrink-0">×{e.repeats}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
