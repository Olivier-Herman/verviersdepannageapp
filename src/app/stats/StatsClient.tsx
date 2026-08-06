'use client'

import { useEffect, useState, useMemo } from 'react'
import AppShell from '@/components/layout/AppShell'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { getSourceColorHex, type SourceDisplay as CatalogSource } from '@/lib/missions/source-display'

interface StatsClientProps {
  catalogSources: CatalogSource[]
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

interface RevenueResponse {
  period: Period
  odooOk: boolean
  total_htva: number
  invoiced_htva: number
  estimated_htva: number
  byDriver: {
    driver_id: string
    name: string
    missions_count: number
    invoiced_count: number
    revenue_odoo: number
    revenue_estimate: number
    revenue_htva: number
  }[]
}

const eur = (n: number) =>
  new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(n || 0)

const PERIODS = [
  { key: 'today',   label: "Aujourd'hui" },
  { key: 'week',    label: 'Cette semaine' },
  { key: 'month',   label: 'Ce mois-ci' },
  { key: 'quarter', label: 'Ce trimestre' },
  { key: 'year',    label: 'Cette année' },
  { key: 'custom',  label: 'Période personnalisée…' },
]

// SOURCE_COLORS retire : remplace par getSourceColorHex(key, catalog) qui
// lit display_color_hex depuis mission_source_catalog (charge en prop).

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

export default function StatsClient({ catalogSources, ...props }: StatsClientProps) {
  const [period, setPeriod] = useState<string>('month')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [source, setSource] = useState<string>('')
  const [chauffeur, setChauffeur] = useState<string>('')
  const [type, setType] = useState<string>('')
  const [data, setData] = useState<StatsResponse | null>(null)
  const [revenue, setRevenue] = useState<RevenueResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const drivers = data?.drivers_list || []

  // Charger les stats à chaque changement de filtre
  useEffect(() => {
    // Période perso : on attend que les deux dates soient renseignées.
    if (period === 'custom' && (!dateFrom || !dateTo)) return

    // dateTo inclusif : on passe le lendemain (le backend filtre avec `< to`).
    const nextDay = (d: string) => {
      const dt = new Date(d); dt.setDate(dt.getDate() + 1)
      return dt.toISOString().slice(0, 10)
    }
    const applyDates = (pp: URLSearchParams) => {
      if (period === 'custom') { pp.set('dateFrom', dateFrom); pp.set('dateTo', nextDay(dateTo)) }
    }

    const params = new URLSearchParams({ period })
    applyDates(params)
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

    // CA par chauffeur : endpoint séparé (touche Odoo, plus lent) — le type ne
    // le concerne pas.
    const rParams = new URLSearchParams({ period })
    applyDates(rParams)
    if (source)    rParams.set('source', source)
    if (chauffeur) rParams.set('chauffeur', chauffeur)
    setRevenue(null)
    fetch('/api/stats/driver-revenue?' + rParams.toString())
      .then(r => r.json())
      .then(j => { if (!j.error) setRevenue(j) })
      .catch(() => {})
  }, [period, dateFrom, dateTo, source, chauffeur, type])

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
    if (revenue) {
      rows.push('')
      rows.push('Chauffeur,Missions,Facturées Odoo,CA facturé Odoo (HTVA),CA estimé (HTVA),CA total (HTVA)')
      for (const d of revenue.byDriver) {
        rows.push(`"${d.name}",${d.missions_count},${d.invoiced_count},${d.revenue_odoo.toFixed(2)},${d.revenue_estimate.toFixed(2)},${d.revenue_htva.toFixed(2)}`)
      }
      rows.push(`"TOTAL",,,${revenue.invoiced_htva.toFixed(2)},${revenue.estimated_htva.toFixed(2)},${revenue.total_htva.toFixed(2)}`)
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stats_${data.period.label.replace(/\s+/g, '_')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Sources : lues depuis le catalog (passe en prop server-side)
  const sources = catalogSources.map(s => s.key)
  const types: { value: string; label: string }[] = [
    { value: 'remorquage',  label: 'Remorquage (REM)' },
    { value: 'depannage',   label: 'Dépannage (DSP)' },
    { value: 'trajet_vide', label: 'Trajet à vide' },
  ]

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
        {/* Sous-page « Déroulement Touring » (SLA historique COMEX BKO) */}
        <a href="/stats/touring"
          className="flex items-center gap-3 bg-[#1f5fd6]/[.08] border border-[#1f5fd6]/25 rounded-xl px-4 py-3 hover:bg-[#1f5fd6]/[.14] transition">
          <span className="text-2xl">🚗</span>
          <div>
            <div className="font-bold text-ink text-sm">Déroulement Touring</div>
            <div className="text-xs text-ink-secondary">Heures de pointage & délais SLA (avant/après automatisation) — moyennes mensuelles</div>
          </div>
          <span className="ml-auto text-[#1f5fd6] font-bold">→</span>
        </a>

        {/* ── Filtres ────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 items-center bg-surface p-3 rounded-lg">
          <select value={period} onChange={e => setPeriod(e.target.value)} className="px-3 py-2 bg-surface-hover rounded text-sm">
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>

          {/* Choisir un mois précis → bascule en période perso sur ce mois */}
          <input
            type="month"
            className="px-3 py-2 bg-surface-hover rounded text-sm"
            title="Choisir un mois précis"
            onChange={e => {
              const v = e.target.value // 'YYYY-MM'
              if (!v) return
              const [y, m] = v.split('-').map(Number)
              const first = new Date(y, m - 1, 1)
              const last  = new Date(y, m, 0) // dernier jour du mois
              const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
              setDateFrom(iso(first))
              setDateTo(iso(last))
              setPeriod('custom')
            }}
          />

          {period === 'custom' && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-ink-faint">du</span>
              <input type="date" value={dateFrom} max={dateTo || undefined}
                onChange={e => setDateFrom(e.target.value)}
                className="px-2 py-2 bg-surface-hover rounded text-sm" />
              <span className="text-xs text-ink-faint">au</span>
              <input type="date" value={dateTo} min={dateFrom || undefined}
                onChange={e => setDateTo(e.target.value)}
                className="px-2 py-2 bg-surface-hover rounded text-sm" />
            </div>
          )}
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
            {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <div className="ml-auto flex gap-2">
            <button onClick={handleExportCsv} disabled={!data} className="px-3 py-2 bg-brand text-surface rounded text-sm font-medium disabled:opacity-50">
              📥 Export CSV
            </button>
          </div>
        </div>

        {error && <div className="bg-red-500/10 text-red-500 p-3 rounded">{error}</div>}
        {period === 'custom' && (!dateFrom || !dateTo) && (
          <div className="bg-brand/10 text-brand p-3 rounded text-sm">
            📅 Choisis une date de début et de fin (ou un mois) pour afficher les statistiques.
          </div>
        )}
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
                        <Cell key={idx} fill={getSourceColorHex(entry.source.toLowerCase(), catalogSources)} />
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

            {/* ── Chiffre d'affaires par chauffeur (HTVA) ─────── */}
            <ChartCard title="💶 Chiffre d'affaires par chauffeur (HTVA)">
              {!revenue ? (
                <div className="text-center text-ink-faint py-6 text-sm">Calcul du CA en cours…</div>
              ) : revenue.byDriver.length === 0 ? (
                <div className="text-center text-ink-faint py-6 text-sm">Aucune mission sur la période.</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-surface-hover p-3 rounded-lg">
                      <div className="text-xs text-ink-faint uppercase tracking-wider mb-1">CA total HTVA</div>
                      <div className="text-2xl font-display font-bold">{eur(revenue.total_htva)}</div>
                    </div>
                    <div className="bg-surface-hover p-3 rounded-lg">
                      <div className="text-xs text-ink-faint uppercase tracking-wider mb-1 flex items-center gap-1">
                        <span>Facturé Odoo</span>
                        <InfoIcon tooltip="Somme des factures Odoo postées (amount_untaxed, net des notes de crédit). Montant qui fait foi." />
                      </div>
                      <div className="text-xl font-bold text-green-500">{eur(revenue.invoiced_htva)}</div>
                    </div>
                    <div className="bg-surface-hover p-3 rounded-lg">
                      <div className="text-xs text-ink-faint uppercase tracking-wider mb-1 flex items-center gap-1">
                        <span>Estimé (pas encore facturé)</span>
                        <InfoIcon tooltip="Estimation HTVA quand aucune facture Odoo n'existe encore : tarif spécial HTVA, sinon montant à encaisser ou encaissé / 1,21." />
                      </div>
                      <div className="text-xl font-bold text-ink-faint">{eur(revenue.estimated_htva)}</div>
                    </div>
                  </div>

                  {!revenue.odooOk && (
                    <div className="bg-orange-500/10 text-orange-600 text-xs p-2 rounded mb-3">
                      ⚠️ Odoo injoignable : tous les montants sont des estimations (aucune facture Odoo prise en compte).
                    </div>
                  )}

                  <ResponsiveContainer width="100%" height={Math.max(180, revenue.byDriver.length * 34)}>
                    <BarChart data={revenue.byDriver.slice(0, 15)} layout="vertical" margin={{ left: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis type="number" tickFormatter={(v) => `${v} €`} />
                      <YAxis type="category" dataKey="name" width={90} fontSize={12} />
                      <Tooltip formatter={(v: any) => eur(Number(v))} />
                      <Legend />
                      <Bar dataKey="revenue_odoo"     stackId="ca" fill="#22c55e" name="Facturé Odoo" />
                      <Bar dataKey="revenue_estimate" stackId="ca" fill="#94a3b8" name="Estimé" />
                    </BarChart>
                  </ResponsiveContainer>

                  <div className="overflow-x-auto mt-3">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-ink-faint uppercase tracking-wider">
                        <tr>
                          <th className="text-left py-2 px-3">Chauffeur</th>
                          <th className="text-right py-2 px-3">Missions</th>
                          <th className="text-right py-2 px-3">Facturé Odoo</th>
                          <th className="text-right py-2 px-3">Estimé</th>
                          <th className="text-right py-2 px-3">CA total HTVA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revenue.byDriver.map(d => (
                          <tr key={d.driver_id} className="border-t border-surface-hover">
                            <td className="py-2 px-3 font-medium">{d.name}</td>
                            <td className="py-2 px-3 text-right text-ink-faint">
                              {d.missions_count}
                              {d.invoiced_count > 0 && <span className="text-green-500"> ({d.invoiced_count} fact.)</span>}
                            </td>
                            <td className="py-2 px-3 text-right text-green-600">{eur(d.revenue_odoo)}</td>
                            <td className="py-2 px-3 text-right text-ink-faint">{eur(d.revenue_estimate)}</td>
                            <td className="py-2 px-3 text-right font-semibold">{eur(d.revenue_htva)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-surface-hover font-bold">
                          <td className="py-2 px-3">TOTAL</td>
                          <td className="py-2 px-3"></td>
                          <td className="py-2 px-3 text-right text-green-600">{eur(revenue.invoiced_htva)}</td>
                          <td className="py-2 px-3 text-right text-ink-faint">{eur(revenue.estimated_htva)}</td>
                          <td className="py-2 px-3 text-right">{eur(revenue.total_htva)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="text-xs text-ink-faint mt-2">
                    Toutes les missions (hors annulées) comptent. Base : montant total HTVA de chaque mission ; si une facture Odoo existe, c'est son montant qui est pris en compte. Avances de fonds exclues.
                  </div>
                </>
              )}
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
