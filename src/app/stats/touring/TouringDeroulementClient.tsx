'use client'
// src/app/stats/touring/TouringDeroulementClient.tsx
// Module Statistiques → « Déroulement Touring » : moyennes mensuelles des délais
// SLA (avant / après automatisation) + détail des missions filtrable par période.
// Heures = celles que COMEX détient (reçues par Touring). Olivier 2026-08-06.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'

type Monthly = { month: string; auto_phase: string; n: number; avg_assign_accept: number; avg_accept_onroad: number; avg_assign_onspot: number; avg_accept_end: number }
type Row = any

const fmtDT = (iso?: string | null) => {
  if (!iso) return '—'; const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const fmtMin = (m?: number | null) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}′`)
// Seuils SLA (min) : accept ≤7 · en route ≤10 (post-accept) · sur place ≤40 (post en route) · fin (indicatif)
const cls = (m: number | null | undefined, seuil: number) => m == null ? 'text-ink-faint' : m <= seuil ? 'text-green-600' : m <= seuil * 2 ? 'text-amber-600' : 'text-red-600 font-bold'
// Coloration BINAIRE (En route→Sur place) : ≤ seuil = vert, sinon rouge (pas d'orange). Olivier 2026-08-07.
const clsBin = (m: number | null | undefined, seuil: number) => m == null ? 'text-ink-faint' : m <= seuil ? 'text-green-600' : 'text-red-600 font-bold'

const PERIODS = [
  { key: 'week',     label: 'Semaine' },
  { key: 'month',    label: 'Mois' },
  { key: 'quarter',  label: 'Trimestre' },
  { key: 'semester', label: 'Semestre' },
  { key: 'year',     label: 'Année' },
  { key: 'all',      label: 'Tout' },
]

function rangeFor(period: string): { from?: string; to?: string } {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const start = (d: Date) => d.toISOString()
  if (period === 'week')     { const d = new Date(now); d.setDate(d.getDate() - 7); return { from: start(d) } }
  if (period === 'month')    return { from: start(new Date(y, m, 1)) }
  if (period === 'quarter')  return { from: start(new Date(y, Math.floor(m / 3) * 3, 1)) }
  if (period === 'semester') return { from: start(new Date(y, m < 6 ? 0 : 6, 1)) }
  if (period === 'year')     return { from: start(new Date(y, 0, 1)) }
  return {}
}

export default function TouringDeroulementClient(props: {
  userRole?: string; userName?: string; userEmail?: string; userId?: string; userModules?: string[]
}) {
  const [monthly, setMonthly] = useState<Monthly[]>([])
  const [rows, setRows]       = useState<Row[]>([])
  const [total, setTotal]     = useState(0)
  const [period, setPeriod]   = useState('month')
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setErr(null)
    const { from, to } = rangeFor(period)
    const p = new URLSearchParams()
    if (from) p.set('from', from); if (to) p.set('to', to)
    fetch('/api/stats/touring-deroulement?' + p.toString())
      .then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else { setMonthly(d.monthly || []); setRows(d.rows || []); setTotal(d.total || 0) } })
      .catch(() => setErr('Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [period])

  // Regroupe le mensuel par mois (avant/après côte à côte)
  const months = useMemo(() => {
    const map = new Map<string, { month: string; avant?: Monthly; apres?: Monthly }>()
    for (const r of monthly) {
      const e = map.get(r.month) || { month: r.month }
      if (r.auto_phase === 'apres') e.apres = r; else e.avant = r
      map.set(r.month, e)
    }
    return [...map.values()].sort((a, b) => b.month.localeCompare(a.month))
  }, [monthly])

  const th = 'py-2 px-2 text-left font-semibold text-ink-secondary text-[11px] uppercase tracking-wide whitespace-nowrap'
  const td = 'py-1.5 px-2 whitespace-nowrap'

  return (
    <AppShell title="Déroulement Touring"
      userRole={props.userRole} userName={props.userName} userEmail={props.userEmail}
      userId={props.userId} userModules={props.userModules}>
      <div className="max-w-6xl mx-auto p-4 space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/stats" className="text-ink-secondary hover:text-ink text-sm">‹ Stats</Link>
          <h1 className="text-2xl font-black text-ink">🚗 Déroulement Touring</h1>
          <span className="text-xs text-ink-secondary">heures COMEX (= reçues par Touring) · {total} missions</span>
        </div>

        {err && <div className="bg-critical/10 text-critical rounded-lg p-3 text-sm">{err}</div>}

        {/* Comparaison moyennes mensuelles (avant / après automatisation) */}
        <section className="bg-surface border rounded-2xl p-4">
          <h2 className="font-bold text-ink mb-1">Moyennes mensuelles des délais</h2>
          <p className="text-xs text-ink-secondary mb-3">
            <span className="inline-block w-3 h-3 rounded-sm bg-slate-400 align-middle mr-1"></span> avant automatisation ·
            <span className="inline-block w-3 h-3 rounded-sm bg-green-500 align-middle mx-1"></span> après (mise en place 06/08/2026).
            Vert = dans les temps, rouge = dépassé.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b">
                  <th className={th}>Mois</th><th className={th}>Phase</th><th className={th}>Missions</th>
                  <th className={th}>Assign→Accept</th><th className={th}>Accept→En route</th>
                  <th className={th}>En route→Sur place</th><th className={th}>Accept→Fin</th>
                </tr>
              </thead>
              <tbody>
                {months.map(mo => (['avant', 'apres'] as const).map(ph => {
                  const r = mo[ph]; if (!r) return null
                  return (
                    <tr key={mo.month + ph} className="border-b border-line/40">
                      <td className={td + ' font-mono'}>{mo.month}</td>
                      <td className={td}>
                        <span className={`inline-block w-2.5 h-2.5 rounded-sm mr-1 ${ph === 'apres' ? 'bg-green-500' : 'bg-slate-400'}`}></span>
                        {ph === 'apres' ? 'après' : 'avant'}
                      </td>
                      <td className={td}>{r.n}</td>
                      <td className={td + ' ' + cls(r.avg_assign_accept, 7)}>{fmtMin(r.avg_assign_accept)}</td>
                      <td className={td + ' ' + cls(r.avg_accept_onroad, 10)}>{fmtMin(r.avg_accept_onroad)}</td>
                      <td className={td + ' ' + clsBin(r.avg_assign_onspot, 40)}>{fmtMin(r.avg_assign_onspot)}</td>
                      <td className={td}>{fmtMin(r.avg_accept_end)}</td>
                    </tr>
                  )
                }))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Détail des missions — filtrable par période */}
        <section className="bg-surface border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h2 className="font-bold text-ink">Détail des missions</h2>
            <div className="ml-auto flex gap-1 bg-surface-2 border rounded-lg p-1">
              {PERIODS.map(p => (
                <button key={p.key} onClick={() => setPeriod(p.key)}
                  className={`px-2.5 py-1 rounded text-xs font-bold ${period === p.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-secondary hover:text-ink'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {loading && <div className="text-ink-secondary text-sm py-4">Chargement…</div>}
          {!loading && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className={th}>Dossier</th><th className={th}>Plaque</th><th className={th}>Type</th><th className={th}>Codes</th>
                    <th className={th}>Assign</th><th className={th}>Accept</th><th className={th}>En route</th><th className={th}>Sur place</th><th className={th}>Fin</th>
                    <th className={th}>A→Acc</th><th className={th}>Acc→Rte</th><th className={th}>Rte→Spot</th><th className={th}>Acc→Fin</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-line/30 hover:bg-surface-2/50">
                      <td className={td + ' font-mono'}>{r.dossier}<span className="text-ink-faint">/{r.seq}</span>
                        {r.auto_phase === 'apres' && <span className="ml-1 text-[9px] bg-green-500 text-white px-1 rounded">A</span>}</td>
                      <td className={td + ' font-mono font-bold'}>{r.plate}</td>
                      <td className={td}>{r.action}</td>
                      <td className={td + ' font-mono text-ink-secondary'}>{r.arc_code}</td>
                      <td className={td}>{fmtDT(r.assign_at)}</td>
                      <td className={td}>{fmtDT(r.accept_at)}</td>
                      <td className={td}>{fmtDT(r.onroad_at)}</td>
                      <td className={td}>{fmtDT(r.onspot_at)}</td>
                      <td className={td}>{fmtDT(r.end_at)}</td>
                      <td className={td + ' ' + cls(r.delai_assign_accept, 7)}>{fmtMin(r.delai_assign_accept)}</td>
                      <td className={td + ' ' + cls(r.delai_accept_onroad, 10)}>{fmtMin(r.delai_accept_onroad)}</td>
                      <td className={td + ' ' + clsBin(r.delai_assign_onspot, 40)}>{fmtMin(r.delai_assign_onspot)}</td>
                      <td className={td}>{fmtMin(r.delai_accept_end)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={13} className="text-ink-secondary text-sm py-4 text-center">Aucune mission sur cette période.</td></tr>}
                </tbody>
              </table>
              {rows.length >= 1000 && <div className="text-[10px] text-ink-secondary mt-2">Affichage plafonné à 1000 lignes — affine la période.</div>}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  )
}
