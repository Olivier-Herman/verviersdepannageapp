'use client'

// Vue LECTURE SEULE de supervision TGR (responsable Touring). Standalone (pas
// d'AppShell, pas d'auth) — accès par jeton dans l'URL. Olivier 2026-07-11.

import { useEffect, useState } from 'react'

interface Mission {
  id: string; reference: string | null; plate: string | null; vehicle: string
  pickup: string | null; delivery: string | null; partner: string | null
  priority: number | null; status: string
  created_at: string; decided_at: string | null; completed_at: string | null
  deadline_date: string | null; on_time: boolean | null; accept_hours: number | null
}
interface Data {
  stats: {
    total: number; pending: number; accepted: number; refused: number
    taken: number; completed: number; avg_accept_hours: number | null
    on_time: number; late: number; on_time_rate: number | null
  }
  missions: Mission[]
}

const PERIODS = [
  { key: 'month', label: 'Ce mois' },
  { key: 'last',  label: 'Mois dernier' },
  { key: 'year',  label: 'Cette année' },
  { key: 'all',   label: 'Tout' },
]

function rangeFor(key: string): { from?: string; to?: string } {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  if (key === 'month') return { from: new Date(y, m, 1).toISOString() }
  if (key === 'last')  return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() }
  if (key === 'year')  return { from: new Date(y, 0, 1).toISOString() }
  return {}
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'En attente', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  accepted:  { label: 'Acceptée',   cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  refused:   { label: 'Refusée',    cls: 'bg-red-100 text-red-800 border-red-300' },
  taken:     { label: 'Reprise',    cls: 'bg-purple-100 text-purple-800 border-purple-300' },
  completed: { label: 'Réalisée',   cls: 'bg-green-100 text-green-800 border-green-300' },
}
const fmtD = (s: string | null) => { if (!s) return '—'; try { return new Date(s).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit' }) } catch { return '—' } }
const fmtDT = (s: string | null) => { if (!s) return '—'; try { return new Date(s).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '—' } }

export default function SupervClient({ token }: { token: string }) {
  const [period, setPeriod] = useState('month')
  const [data, setData]     = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setError('Lien invalide.'); setLoading(false); return }
    setLoading(true); setError(null)
    const { from, to } = rangeFor(period)
    const p = new URLSearchParams({ token })
    if (from) p.set('from', from)
    if (to)   p.set('to', to)
    fetch('/api/superv/tgr?' + p.toString())
      .then(r => r.json())
      .then(j => { if (j.error) setError(j.error); else setData(j) })
      .catch(() => setError('Erreur de chargement.'))
      .finally(() => setLoading(false))
  }, [token, period])

  const s = data?.stats

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-[#CC2222] text-white px-4 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">Supervision TGR</h1>
            <p className="text-white/80 text-xs">Verviers Dépannage · suivi des commandes Touring (lecture seule)</p>
          </div>
          <select value={period} onChange={e => setPeriod(e.target.value)}
            className="bg-white/15 border border-white/30 rounded-lg px-3 py-1.5 text-sm text-white">
            {PERIODS.map(p => <option key={p.key} value={p.key} className="text-slate-900">{p.label}</option>)}
          </select>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 space-y-4">
        {error && <div className="bg-red-100 text-red-800 border border-red-300 rounded-xl p-4 text-sm">{error}</div>}
        {loading && <div className="text-center text-slate-500 py-10">Chargement…</div>}

        {s && !loading && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Commandes reçues" value={s.total} />
              <Stat label="Acceptées" value={s.accepted} tone="blue" />
              <Stat label="Refusées" value={s.refused} tone="red" />
              <Stat label="Réalisées" value={s.completed} tone="green" />
              <Stat label="Délai moyen d'acceptation" value={s.avg_accept_hours != null ? `${s.avg_accept_hours} h` : '—'} />
              <Stat label="Dans les délais" value={s.on_time} tone="green" />
              <Stat label="En retard" value={s.late} tone="red" />
              <Stat label="Respect échéance" value={s.on_time_rate != null ? `${s.on_time_rate} %` : '—'} tone={s.on_time_rate != null && s.on_time_rate >= 90 ? 'green' : 'amber'} />
            </div>

            {/* Tableau */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-100">
                  <tr>
                    <th className="text-left px-3 py-2">Réf / Plaque</th>
                    <th className="text-left px-3 py-2">Véhicule</th>
                    <th className="text-left px-3 py-2">Demandeur</th>
                    <th className="text-center px-3 py-2">Statut</th>
                    <th className="text-left px-3 py-2">Reçue</th>
                    <th className="text-left px-3 py-2">Décision</th>
                    <th className="text-left px-3 py-2">Clôturée</th>
                    <th className="text-center px-3 py-2">Échéance</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.missions.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-slate-400 py-8 italic">Aucune commande sur la période.</td></tr>
                  ) : data!.missions.map(m => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <div className="font-medium">{m.reference || '—'}</div>
                        <div className="text-slate-500 text-xs font-mono">{m.plate}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{m.vehicle || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{m.partner || '—'}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS[m.status]?.cls || 'bg-slate-100 text-slate-700 border-slate-300'}`}>
                          {STATUS[m.status]?.label || m.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{fmtDT(m.created_at)}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {fmtDT(m.decided_at)}
                        {m.accept_hours != null && <span className="text-slate-400 text-xs"> · {m.accept_hours} h</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{fmtDT(m.completed_at)}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="text-xs text-slate-500">{fmtD(m.deadline_date)}</div>
                        {m.on_time === true && <span className="text-green-600 text-xs font-semibold">✓ à temps</span>}
                        {m.on_time === false && <span className="text-red-600 text-xs font-semibold">⚠ en retard</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-slate-400 text-xs text-center pb-6">Vue lecture seule · généré par VD Soft</p>
          </>
        )}
      </main>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'blue' | 'red' | 'green' | 'amber' }) {
  const color = tone === 'blue' ? 'text-blue-600' : tone === 'red' ? 'text-red-600'
    : tone === 'green' ? 'text-green-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900'
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-slate-500 text-xs mt-0.5">{label}</div>
    </div>
  )
}
