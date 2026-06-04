'use client'
// src/app/admin/logs/LogsClient.tsx
// Page diagnostique logs erreurs serveur.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { ArrowLeft, RefreshCw, AlertTriangle, AlertCircle, Info, Loader2 } from 'lucide-react'

interface LogRow {
  id: string
  level: 'error' | 'warn' | 'info'
  route: string | null
  message: string
  metadata: any
  user_email: string | null
  created_at: string
}

interface Props {
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
}

export default function LogsClient({ userRole, userName, userEmail, userModules }: Props) {
  const [logs, setLogs] = useState<LogRow[]>([])
  const [stats, setStats] = useState<{ byLevel: Record<string, number>; topRoutes: [string, number][] }>({ byLevel: {}, topRoutes: [] })
  const [loading, setLoading] = useState(false)
  const [level, setLevel] = useState('')
  const [route, setRoute] = useState('')
  const [hours, setHours] = useState(24)

  async function load() {
    setLoading(true)
    try {
      const sp = new URLSearchParams()
      if (level) sp.set('level', level)
      if (route) sp.set('route', route)
      sp.set('hours', String(hours))
      const r = await fetch(`/api/admin/logs?${sp.toString()}`)
      const j = await r.json()
      setLogs(j.logs || [])
      setStats({
        byLevel: j.by_level || {},
        topRoutes: j.top_routes || [],
      })
    } catch (e: any) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [level, route, hours])

  return (
    <AppShell title="Logs serveur" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/admin"
            className="inline-flex items-center justify-center w-9 h-9 rounded-md text-ink-secondary hover:bg-surface-hover hover:text-ink transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <h1 className="font-display text-xl font-bold text-ink">Logs serveur (superadmin)</h1>
        </div>

        {/* Filtres */}
        <div className="bg-surface border rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-ink-muted text-xs font-semibold uppercase mb-1 block">Niveau</label>
              <select value={level} onChange={e => setLevel(e.target.value)}
                className="w-full bg-surface-2 border rounded-md px-3 py-2 text-sm">
                <option value="">Tous</option>
                <option value="error">❌ Error</option>
                <option value="warn">⚠ Warn</option>
                <option value="info">ℹ Info</option>
              </select>
            </div>
            <div>
              <label className="text-ink-muted text-xs font-semibold uppercase mb-1 block">Route (ilike)</label>
              <input value={route} onChange={e => setRoute(e.target.value)}
                placeholder="ex : /api/towsoft"
                className="w-full bg-surface-2 border rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-ink-muted text-xs font-semibold uppercase mb-1 block">Période</label>
              <select value={hours} onChange={e => setHours(Number(e.target.value))}
                className="w-full bg-surface-2 border rounded-md px-3 py-2 text-sm">
                <option value={1}>Dernière heure</option>
                <option value={6}>6 heures</option>
                <option value={24}>24 heures</option>
                <option value={168}>7 jours</option>
                <option value={720}>30 jours</option>
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={load} disabled={loading}
                className="w-full px-3 py-2 bg-brand hover:bg-brand-hover text-white rounded-md text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Rafraîchir
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-critical/10 border border-critical/30 rounded-xl p-3">
            <div className="flex items-center gap-2 text-critical font-bold text-2xl">
              <AlertCircle size={18} /> {stats.byLevel.error || 0}
            </div>
            <p className="text-ink-muted text-xs">Errors</p>
          </div>
          <div className="bg-warning/10 border border-warning/30 rounded-xl p-3">
            <div className="flex items-center gap-2 text-warning font-bold text-2xl">
              <AlertTriangle size={18} /> {stats.byLevel.warn || 0}
            </div>
            <p className="text-ink-muted text-xs">Warns</p>
          </div>
          <div className="bg-info/10 border border-info/30 rounded-xl p-3">
            <div className="flex items-center gap-2 text-info font-bold text-2xl">
              <Info size={18} /> {stats.byLevel.info || 0}
            </div>
            <p className="text-ink-muted text-xs">Infos</p>
          </div>
        </div>

        {/* Top routes */}
        {stats.topRoutes.length > 0 && (
          <div className="bg-surface border rounded-2xl p-4">
            <h2 className="text-ink-muted text-xs font-semibold uppercase mb-2">Top routes (par nb logs)</h2>
            <div className="flex flex-wrap gap-2">
              {stats.topRoutes.map(([r, n]) => (
                <button key={r} onClick={() => setRoute(r)}
                  className="px-2 py-1 bg-surface-2 border rounded-md text-xs hover:bg-surface-hover">
                  <span className="font-mono text-ink">{r}</span>
                  <span className="ml-1 text-ink-muted">({n})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Liste logs */}
        {loading ? (
          <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">
            <Loader2 size={20} className="mx-auto animate-spin mb-2 text-brand" />
            Chargement…
          </div>
        ) : logs.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">
            Aucun log dans cette période / ce filtre. 🎉
          </div>
        ) : (
          <div className="bg-surface border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-b">
                <tr className="text-ink-muted text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2">Quand</th>
                  <th className="text-left px-2 py-2">Niveau</th>
                  <th className="text-left px-3 py-2">Route</th>
                  <th className="text-left px-3 py-2">Message</th>
                  <th className="text-left px-3 py-2">User</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-surface-hover">
                    <td className="px-3 py-2 text-xs text-ink-muted whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString('fr-BE', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' })}
                    </td>
                    <td className="px-2 py-2">
                      <LevelBadge level={log.level} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-secondary">{log.route || '—'}</td>
                    <td className="px-3 py-2">
                      <details>
                        <summary className="cursor-pointer text-ink">{log.message.slice(0, 120)}{log.message.length > 120 ? '…' : ''}</summary>
                        {log.metadata && (
                          <pre className="mt-2 p-2 bg-surface-2 border rounded text-xs overflow-x-auto">
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        )}
                      </details>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-muted">{log.user_email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function LevelBadge({ level }: { level: string }) {
  const map: Record<string, { cls: string; icon: string }> = {
    error: { cls: 'bg-critical/15 text-critical border-critical/30', icon: '❌' },
    warn:  { cls: 'bg-warning/15 text-warning border-warning/30',   icon: '⚠' },
    info:  { cls: 'bg-info/15 text-info border-info/30',             icon: 'ℹ' },
  }
  const v = map[level] || { cls: 'bg-ink/5 text-ink-muted border', icon: '•' }
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${v.cls}`}>{v.icon} {level}</span>
}
