'use client'

import { useEffect, useState, useMemo } from 'react'
import AppShell from '@/components/layout/AppShell'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

interface StatsClientProps {
  userRole:    string
  userName:    string
  userEmail?:  string
  userModules: string[]
  userId?:     string
}

interface Period {
  from: string
  to:   string
  previousFrom: string
  previousTo:   string
  label: string
}

interface KpiValue {
  current: number | null
  previous: number | null
  delta: number | null
}

interface StatsResponse {
  period: Period
  filters: { source?: string; chauffeur?: string; type?: string }
  kpi: {
    totalMissions:                KpiValue
    completedMissions:            KpiValue
    avgInterventionMinutes:       KpiValue
    avgAcceptanceMinutes:         KpiValue
    avgDispatchConfirmMinutes:    KpiValue
    avgAssignmentMinutes:         KpiValue
  }
  byType: {
    remorquage:       number
    dsp:              number
    parc:             number
    dpr:              number
    trajet_vide:      number
    null_or_unknown:  number
  }
  conversions: { rem_to_dsp: number; dsp_to_rem: number }
  bySource:    { source: string; count: number; avgInterventionMinutes: number | null }[]
  byDriver:    { driver_id: string; name: string; missions_count: number; completed: number; refused: number; avg_intervention_minutes: number | null }[]
  heatmap:     number[][]
  geographicTop: { city: string; count: number }[]
  refusalsAutoDispatch: KpiValue
  drivers_list: { id: string; name: string }[]
}

const PERIODS = [
  { key: 'today',   label: "Aujourd'hui" },
  { key: 'week',    label: 'Cette semaine' },
  { key: 'month',   label: 'Ce mois-ci' },
  { key: 'quarter', label: 'Ce trimestre' },
  { key: 'year',    label: 'Cette année' },
]

const SOURCE_COLORS: Record<string, string> = {
  vab:      '#3b82f6',
  touring:  '#eab308',
  ima:      '#22c55e',
  mondial:  '#a855f7',
  ethias:   '#ef4444',
  inconnu:  '#9ca3af',
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

export default function StatsClient(props: StatsClientProps) {
  const [period, setPeriod] = useState<string>('month')
  const [source, setSource] = useState<string>('')
  const [chauffeur, setChauffeur] = useState<string>('')
  const [type, setType] = useState<string>('')
  const [data, setData] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const drivers = data?.drivers_list || []

  // Charger les stats à chaque changement de filtre
  useEffect(() => {
    const params = new URLSearchParams({ period })
    if (source)    params.set('source', source)
    if (chauffeur) params.set('chauffeur', chauffeur)
    if (type)      params.set('type', type)

    setLoading(true)
    setError(null)
    fetch('/api/stats/dashboard?' + params.toString())
      .then(r => r.json())
      .then(j => {
        if (j.error) { setError(j.error); setData(null) }
        else         { setData(j) }
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [period, source, chauffeur, type])

  const handleExportCsv = () => {
    if (!data) return
    const rows: string[] = []
    rows.push('Chauffeur,Missions,Terminées,Refusées,Temps moyen (min)')
    for (const d of data.byDriver) {
      rows.push(`"${d.name}",${d.missions_count},${d.completed},${d.refused},${d.avg_intervention_minutes ?? ''}`)
    }
    rows.push('')
    rows.push('Source,Missions,Temps moyen (min)')
    for (const s of data.bySource) {
      rows.push(`"${s.source}",${s.count},${s.avgInterventionMinutes ?? ''}`)
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stats_${data.period.label.replace(/\s+/g, '_')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sources = ['vab', 'touring', 'ima', 'mondial', 'ethias', 'autre']
  const types = ['remorquage', 'depannage', 'reparation_place', 'trajet_vide']

  return (
    <AppShell
      title="Statistiques"
      userRole={props.userRole}
      userName={props.userName}
      userEmail={props.userEmail}
      userId={props.userId}
      userModules={props.userModules}
    >
      <div className="space-y-4 max-w-7xl mx-auto p-4">
        {/* ── Filtres ────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 items-center bg-surface p-3 rounded-lg">
          <select value={period} onChange={e => setPeriod(e.target.value)} className="px-3 py-2 bg-surface-hover rounded text-sm">
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <select value={source} onChange={e => setSource(e.target.value)} className="px-3 py-2 bg-surface-hover rounded text-sm">
            <option value="">Toutes sources</option>
            {sources.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
          <select value={chauffeur} onChange={e => setChauffeur(e.target.value)} className="px-3 py-2 bg-surface-hover rounded text-sm">
            <option value="">Tous chauffeurs</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value)} className="px-3 py-2 bg-surface-hover rounded text-sm">
            <option value="">Tous types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="ml-auto flex gap-2">
            <button onClick={handleExportCsv} disabled={!data} className="px-3 py-2 bg-brand text-surface rounded text-sm font-medium disabled:opacity-50">
              📥 Export CSV
            </button>
          </div>
        </div>

        {error && <div className="bg-red-500/10 text-red-500 p-3 rounded">{error}</div>}
        {loading && <div className="text-center text-ink-faint py-8">Chargement…</div>}

        {data && !loading && (
          <>
            {/* ── KPI cards ──────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <KpiCard
                label="Total missions"
                value={data.kpi.totalMissions.current ?? 0}
                delta={data.kpi.totalMissions.delta}
                tooltip="Missions assignées/traitées sur la période (statuts: assigned, accepted, in_progress, delivering, parked, completed, to_invoice). Exclut new/dispatching."
              />
              <KpiCard
                label="Terminées"
                value={data.kpi.completedMissions.current ?? 0}
                delta={data.kpi.completedMissions.delta}
                tooltip="Missions complétées par le chauffeur (statut completed ou to_invoice)."
              />
              <KpiCard
                label="Temps moyen interv."
                value={data.kpi.avgInterventionMinutes.current ?? '—'} suffix=" min"
                delta={data.kpi.avgInterventionMinutes.delta} deltaInverse
                tooltip="Durée moyenne entre acceptation chauffeur (accepted_at) et completion mission (completed_at). Mesure l'efficacité chauffeur sur place."
              />
              <KpiCard
                label="Délai accept. chauffeur"
                value={data.kpi.avgAcceptanceMinutes.current ?? '—'} suffix=" min"
                delta={data.kpi.avgAcceptanceMinutes.delta} deltaInverse
                tooltip="Durée moyenne entre réception mission (received_at) et acceptation chauffeur (accepted_at). Mesure la réactivité du chauffeur."
              />
              <KpiCard
                label="Délai confirm. dispatch"
                value={data.kpi.avgDispatchConfirmMinutes.current ?? '—'} suffix=" min"
                delta={data.kpi.avgDispatchConfirmMinutes.delta} deltaInverse
                tooltip="Durée moyenne entre réception mission (received_at) et confirmation par le dispatcher (action dispatched dans mission_logs). Mesure la réactivité du dispatcher."
              />
              <KpiCard
                label="Délai assignation"
                value={data.kpi.avgAssignmentMinutes.current ?? '—'} suffix=" min"
                delta={data.kpi.avgAssignmentMinutes.delta} deltaInverse
                tooltip="Durée moyenne entre réception mission (received_at) et assignation à un chauffeur (assigned_at). Mesure la rapidité d'affectation."
              />
            </div>

            {/* ── Stats secondaires ──────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MiniStat label="Remorquages (REM)" value={data.byType.remorquage || 0} icon="🚛"
                tooltip="Missions de type REM ou remorquage (insensible à la casse)." />
              <MiniStat label="Dépannages (DSP)"  value={data.byType.dsp || 0}        icon="🔧"
                tooltip="Missions DSP / dépannage / réparation sur place (toutes regroupées)." />
              <MiniStat label="Mises en parc"     value={data.byType.parc || 0}       icon="🅿️"
                tooltip="Missions avec status = parked (véhicule mis en parc Verviers)." />
              <MiniStat label="Trajets à vide"    value={data.byType.trajet_vide || 0} icon="🛣️"
                tooltip="Missions de type trajet_vide (déplacement sans véhicule à dépanner)." />
              <MiniStat label="DPR"               value={data.byType.dpr || 0}        icon="❌" color="text-red-500"
                tooltip="Missions avec dpr_motif renseigné (Dépannage Refusé, le client ou le véhicule rejette l'intervention)." />
              <MiniStat label="REM → DSP"         value={data.conversions.rem_to_dsp} icon="↔️"
                tooltip="Missions où le chauffeur a changé le type initial REM en DSP (mission_logs action=change_type)." />
              <MiniStat label="DSP → REM"         value={data.conversions.dsp_to_rem} icon="↔️"
                tooltip="Missions où le chauffeur a changé le type initial DSP en REM." />
              <MiniStat label="Refus auto-disp."  value={data.refusalsAutoDispatch.current ?? 0} icon="🚫" color="text-orange-500"
                tooltip="Tentatives auto-dispatch refusées par les chauffeurs (dispatch_attempts_log status=refused)." />
            </div>

            {/* ── Charts ──────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard title="Missions par source">
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={data.bySource} dataKey="count" nameKey="source" cx="50%" cy="50%" outerRadius={80} label>
                      {data.bySource.map((entry, idx) => (
                        <Cell key={idx} fill={SOURCE_COLORS[entry.source.toLowerCase()] || '#9ca3af'} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Top chauffeurs (volume)">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={data.byDriver.slice(0, 10)} layout="vertical" margin={{ left: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="name" width={80} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="missions_count" fill="#3b82f6" name="Missions" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── Heatmap ─────────────────────────────────────── */}
            <ChartCard title="Heatmap activité (jour × heure)">
              <HeatmapGrid matrix={data.heatmap} />
            </ChartCard>

            {/* ── Top villes ──────────────────────────────────── */}
            {data.geographicTop.length > 0 && (
              <ChartCard title="Top 10 villes d'intervention">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.geographicTop}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="city" fontSize={11} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#22c55e" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            {/* ── Tableau détaillé chauffeurs ────────────────── */}
            <ChartCard title="Détail par chauffeur">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-ink-faint uppercase tracking-wider">
                    <tr>
                      <th className="text-left py-2 px-3">Chauffeur</th>
                      <th className="text-right py-2 px-3">Missions</th>
                      <th className="text-right py-2 px-3">Terminées</th>
                      <th className="text-right py-2 px-3">Temps moyen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byDriver.map(d => (
                      <tr key={d.driver_id} className="border-t border-surface-hover">
                        <td className="py-2 px-3 font-medium">{d.name}</td>
                        <td className="py-2 px-3 text-right">{d.missions_count}</td>
                        <td className="py-2 px-3 text-right text-green-500">{d.completed}</td>
                        <td className="py-2 px-3 text-right text-ink-faint">
                          {d.avg_intervention_minutes ?? '—'}{d.avg_intervention_minutes != null ? ' min' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>

            <div className="text-xs text-ink-faint text-center pt-4">
              Période : {data.period.label} • Comparé à la période précédente
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

function KpiCard({ label, value, suffix = '', delta, deltaInverse = false, tooltip }: { label: string; value: any; suffix?: string; delta?: number | null; deltaInverse?: boolean; tooltip?: string }) {
  const isPositive = delta != null && delta > 0
  const isNegative = delta != null && delta < 0
  const good = deltaInverse ? isNegative : isPositive
  const bad  = deltaInverse ? isPositive : isNegative
  return (
    <div className="bg-surface p-4 rounded-lg relative group">
      <div className="text-xs text-ink-faint uppercase tracking-wider mb-1 flex items-center gap-1">
        <span>{label}</span>
        {tooltip && <InfoIcon tooltip={tooltip} />}
      </div>
      <div className="text-2xl font-display font-bold">{value}{suffix}</div>
      {delta != null && (
        <div className={`text-xs mt-1 ${good ? 'text-green-500' : bad ? 'text-red-500' : 'text-ink-faint'}`}>
          {delta > 0 ? '↑' : delta < 0 ? '↓' : '='} {Math.abs(delta).toFixed(1)}% vs période précédente
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value, icon, color, tooltip }: { label: string; value: number; icon: string; color?: string; tooltip?: string }) {
  return (
    <div className="bg-surface p-3 rounded-lg flex items-center gap-2 relative">
      <span className="text-lg">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className={`text-lg font-bold ${color || ''}`}>{value}</div>
        <div className="text-xs text-ink-faint truncate flex items-center gap-1">
          <span className="truncate">{label}</span>
          {tooltip && <InfoIcon tooltip={tooltip} />}
        </div>
      </div>
    </div>
  )
}

function InfoIcon({ tooltip }: { tooltip: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-surface-hover text-ink-faint text-[9px] font-bold cursor-help hover:bg-brand hover:text-surface flex-shrink-0"
      title={tooltip}
      aria-label={tooltip}
    >
      ?
    </span>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface p-4 rounded-lg">
      <h3 className="text-sm font-display font-semibold mb-3">{title}</h3>
      {children}
    </div>
  )
}

function HeatmapGrid({ matrix }: { matrix: number[][] }) {
  const max = useMemo(() => {
    let m = 0
    for (const row of matrix) for (const v of row) if (v > m) m = v
    return m || 1
  }, [matrix])

  return (
    <div className="overflow-x-auto">
      <table className="text-[10px]">
        <thead>
          <tr>
            <th></th>
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="px-1 text-ink-faint font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, wday) => (
            <tr key={wday}>
              <td className="pr-2 text-ink-faint">{WEEKDAYS[wday]}</td>
              {row.map((v, h) => {
                const intensity = v / max
                return (
                  <td
                    key={h}
                    className="w-6 h-6 border border-surface-hover text-center"
                    style={{
                      backgroundColor: v > 0 ? `rgba(59, 130, 246, ${0.15 + intensity * 0.7})` : 'transparent',
                      color: intensity > 0.5 ? 'white' : undefined,
                    }}
                    title={`${WEEKDAYS[wday]} ${h}h : ${v} mission${v !== 1 ? 's' : ''}`}
                  >
                    {v > 0 ? v : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
