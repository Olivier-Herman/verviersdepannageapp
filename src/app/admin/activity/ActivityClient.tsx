'use client'
// src/app/admin/activity/ActivityClient.tsx
// Journal d'activité global (« mouchard ») : flux chronologique de toutes les
// actions (mission_logs) — qui / quoi / quand / sur quelle mission. Filtres +
// rafraîchissement auto. Superadmin. Olivier 2026-07-14.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { RefreshCw, Loader2 } from 'lucide-react'

interface Item {
  id:             string
  created_at:     string
  action:         string
  notes:          string | null
  actor_name:     string
  actor_email:    string | null
  mission_id:     string | null
  mission_number: number | null
  vehicle_plate:  string | null
  source:         string | null
}
interface UserOpt { id: string; name: string }

interface Props { userRole: string; userName: string; userEmail?: string | null; userModules: string[] }

const HOURS_OPTS = [
  { v: 6,   label: '6 h' },
  { v: 24,  label: '24 h' },
  { v: 72,  label: '3 j' },
  { v: 168, label: '7 j' },
  { v: 720, label: '30 j' },
]

function fmt(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function ActivityClient({ userRole, userName, userEmail, userModules }: Props) {
  const [items, setItems]   = useState<Item[]>([])
  const [users, setUsers]   = useState<UserOpt[]>([])
  const [loading, setLoading] = useState(false)
  const [user, setUser]     = useState('')
  const [action, setAction] = useState('')
  const [q, setQ]           = useState('')
  const [hours, setHours]   = useState(24)
  const [auto, setAuto]     = useState(true)
  const [nextBefore, setNextBefore] = useState<string | null>(null)

  const filtersRef = useRef({ user, action, q, hours })
  useEffect(() => { filtersRef.current = { user, action, q, hours } }, [user, action, q, hours])

  const load = useCallback(async (opts: { append?: boolean; silent?: boolean } = {}) => {
    const { user, action, q, hours } = filtersRef.current
    if (!opts.silent) setLoading(true)
    try {
      const sp = new URLSearchParams()
      if (user) sp.set('user', user)
      if (action) sp.set('action', action)
      if (q) sp.set('q', q)
      sp.set('hours', String(hours))
      sp.set('limit', '100')
      if (users.length === 0) sp.set('with_users', '1')
      if (opts.append && nextBefore) sp.set('before', nextBefore)
      const r = await fetch(`/api/admin/activity?${sp.toString()}`)
      const j = await r.json()
      if (j.users) setUsers(j.users)
      setItems(prev => opts.append ? [...prev, ...(j.items || [])] : (j.items || []))
      setNextBefore(j.next_before || null)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [nextBefore, users.length])

  // Rechargement sur changement de filtre.
  useEffect(() => { load() /* eslint-disable-next-line */ }, [user, action, q, hours])

  // Rafraîchissement auto (10 s) — recharge la tête de liste.
  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => load({ silent: true }), 10_000)
    return () => clearInterval(t)
  }, [auto, load])

  return (
    <AppShell title="Journal d'activité" backHref="/admin" userRole={userRole} userName={userName} userEmail={userEmail ?? undefined} userModules={userModules}>
      <div className="px-4 lg:px-8 py-5 max-w-5xl mx-auto">
        {/* Filtres */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select value={user} onChange={e => setUser(e.target.value)}
            className="bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink">
            <option value="">👤 Tous les utilisateurs</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input value={action} onChange={e => setAction(e.target.value)} placeholder="Action (ex: encaiss, park…)"
            className="bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink w-44" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 Recherche (texte)"
            className="bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink w-52" />
          <div className="inline-flex rounded-lg border overflow-hidden">
            {HOURS_OPTS.map(o => (
              <button key={o.v} onClick={() => setHours(o.v)}
                className={`px-3 py-2 text-sm ${hours === o.v ? 'bg-brand text-white' : 'bg-surface text-ink-muted hover:bg-surface-hover'}`}>
                {o.label}
              </button>
            ))}
          </div>
          <button onClick={() => load()} className="p-2 rounded-lg bg-surface-2 border hover:bg-surface-hover" title="Rafraîchir">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
          <label className="flex items-center gap-1.5 text-sm text-ink-muted cursor-pointer ml-1">
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
            Auto (10 s)
          </label>
        </div>

        {/* Flux */}
        <div className="bg-surface border rounded-2xl divide-y">
          {items.length === 0 && !loading && (
            <p className="text-ink-muted text-sm text-center py-12">Aucune action sur la période / les filtres.</p>
          )}
          {items.map(it => (
            <div key={it.id} className="px-4 py-2.5 flex items-start gap-3 hover:bg-surface-hover/40 transition text-sm">
              <span className="text-ink-faint text-xs font-mono whitespace-nowrap pt-0.5 w-28 flex-shrink-0">{fmt(it.created_at)}</span>
              <span className="font-semibold text-ink whitespace-nowrap w-32 flex-shrink-0 truncate" title={it.actor_email || ''}>{it.actor_name}</span>
              <span className="px-1.5 py-0.5 rounded bg-surface-2 text-ink-secondary text-[11px] font-mono whitespace-nowrap flex-shrink-0">{it.action}</span>
              <span className="text-ink-secondary flex-1 min-w-0">{it.notes || '—'}</span>
              {it.mission_id && (
                <Link href={`/dispatch/${it.mission_id}`} className="text-brand hover:underline whitespace-nowrap flex-shrink-0 font-medium">
                  {it.mission_number != null ? `#${it.mission_number}` : 'fiche'}{it.vehicle_plate ? ` · ${it.vehicle_plate}` : ''} →
                </Link>
              )}
            </div>
          ))}
        </div>

        {nextBefore && (
          <div className="text-center mt-4">
            <button onClick={() => load({ append: true })} disabled={loading}
              className="px-4 py-2 bg-surface-2 border rounded-lg text-sm text-ink-secondary hover:bg-surface-hover disabled:opacity-50">
              {loading ? 'Chargement…' : 'Charger plus'}
            </button>
          </div>
        )}
      </div>
    </AppShell>
  )
}
