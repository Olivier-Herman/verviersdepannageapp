'use client'

import { useMemo, useState } from 'react'
import Link                   from 'next/link'
import AppShell               from '@/components/layout/AppShell'
import { formatEur }          from '@/lib/format'

interface Fine {
  id:                       string
  photo_url:                string
  infraction_date:          string
  infraction_place:         string | null
  infraction_type:          string | null
  infraction_ref:           string | null
  amount:                   number
  plate:                    string
  driver_id:                string | null
  driver_match_method:      string | null
  driver_match_confidence:  string | null
  mission_id:               string | null
  status:                   string
  notes:                    string | null
  purchase_email_sent:      boolean
  purchase_email_sent_at:   string | null
  created_at:               string
  driver:                   { id: string; name: string; email: string } | null
  created_by_user:          { name: string } | null
  mission:                  { id: string; mission_number: number | null; external_id: string | null; dossier_number: string | null } | null
}

interface Driver { id: string; name: string }

const TYPE_LABEL: Record<string, string> = {
  speeding:  '🚓 Excès vitesse',
  parking:   '🅿️ Stationnement',
  red_light: '🚦 Feu rouge',
  priority:  '⚠️ Priorité',
  phone:     '📱 Téléphone',
  belt:      '🔓 Ceinture',
  other:     '📝 Autre',
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:          { label: '⏳ En attente',         color: 'bg-amber-500/15 text-amber-700 border-amber-500/30' },
  sent_to_purchase: { label: '📧 Envoyée compta',     color: 'bg-blue-500/15 text-blue-700 border-blue-500/30' },
  paid:             { label: '✅ Payée',              color: 'bg-green-500/15 text-green-700 border-green-500/30' },
  disputed:         { label: '⚖️ Contestée',          color: 'bg-purple-500/15 text-purple-700 border-purple-500/30' },
  cancelled:        { label: '❌ Annulée',             color: 'bg-gray-500/15 text-gray-700 border-gray-500/30' },
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function AdminAmendesClient({ fines, drivers, userRole, userName, userModules }: {
  fines:       Fine[]
  drivers:     Driver[]
  userRole:    string
  userName:    string
  userModules: string[]
}) {
  const [driverFilter, setDriverFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [yearFilter,   setYearFilter]   = useState<string>('all')

  const years = useMemo(() => {
    const set = new Set<number>()
    fines.forEach(f => set.add(new Date(f.infraction_date).getFullYear()))
    return Array.from(set).sort((a, b) => b - a)
  }, [fines])

  const filtered = useMemo(() => fines.filter(f => {
    if (driverFilter !== 'all') {
      if (driverFilter === 'unknown') {
        if (f.driver_id) return false
      } else if (f.driver_id !== driverFilter) return false
    }
    if (statusFilter !== 'all' && f.status !== statusFilter) return false
    if (yearFilter !== 'all'   && String(new Date(f.infraction_date).getFullYear()) !== yearFilter) return false
    return true
  }), [fines, driverFilter, statusFilter, yearFilter])

  // Stats : total par chauffeur (sur le filtre courant sans driver)
  const statsByDriver = useMemo(() => {
    const filteredSansDriver = fines.filter(f => {
      if (statusFilter !== 'all' && f.status !== statusFilter) return false
      if (yearFilter !== 'all'   && String(new Date(f.infraction_date).getFullYear()) !== yearFilter) return false
      return true
    })
    const map = new Map<string, { name: string; count: number; total: number }>()
    for (const f of filteredSansDriver) {
      const key  = f.driver_id || 'unknown'
      const name = f.driver?.name || '— non identifié —'
      const cur  = map.get(key) || { name, count: 0, total: 0 }
      cur.count++
      cur.total += Number(f.amount) || 0
      map.set(key, cur)
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.total - a.total)
  }, [fines, statusFilter, yearFilter])

  const grandTotal      = filtered.reduce((s, f) => s + Number(f.amount), 0)
  const grandCount      = filtered.length
  const grandUnknown    = filtered.filter(f => !f.driver_id).length

  return (
    <AppShell title="Amendes — Administration" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-4">
        {/* Header + actions */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-ink font-bold text-xl">⚠️ Amendes / PV</h1>
            <p className="text-ink-muted text-sm mt-0.5">{grandCount} amende(s) — Total {formatEur(grandTotal)}{grandUnknown > 0 && ` · ${grandUnknown} sans chauffeur`}</p>
          </div>
          <Link href="/amendes"
            className="px-4 py-2 bg-brand text-ink rounded-xl text-sm font-semibold whitespace-nowrap">
            + Saisir un PV
          </Link>
        </div>

        {/* Filtres */}
        <div className="bg-surface border rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">Chauffeur</label>
            <select value={driverFilter} onChange={e => setDriverFilter(e.target.value)}
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm">
              <option value="all">Tous</option>
              <option value="unknown">— Non identifié —</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">Statut</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm">
              <option value="all">Tous</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">Année</label>
            <select value={yearFilter} onChange={e => setYearFilter(e.target.value)}
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm">
              <option value="all">Toutes</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* Stats par chauffeur */}
        {statsByDriver.length > 0 && (
          <div className="bg-surface border rounded-2xl p-4">
            <h2 className="text-ink-muted text-xs uppercase tracking-wider font-medium mb-3">
              💰 Coût par chauffeur (filtres appliqués hors chauffeur)
            </h2>
            <div className="space-y-1.5">
              {statsByDriver.map(s => (
                <button key={s.id}
                  onClick={() => setDriverFilter(s.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition ${
                    driverFilter === s.id ? 'bg-brand/15 border border-brand/30' : 'bg-surface-2 border hover:border-zinc-600'
                  }`}>
                  <span className={`flex-1 text-left ${s.id === 'unknown' ? 'text-ink-faint italic' : 'text-ink font-medium'}`}>
                    {s.name}
                  </span>
                  <span className="text-ink-muted text-xs">{s.count} amende{s.count > 1 ? 's' : ''}</span>
                  <span className="text-ink font-bold tabular-nums w-20 text-right">{formatEur(s.total)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Liste des amendes */}
        {filtered.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center">
            <p className="text-ink-muted text-sm">Aucune amende avec ces filtres.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map(f => {
              const status = STATUS_LABEL[f.status] || { label: f.status, color: 'bg-gray-500/15 text-gray-700 border-gray-500/30' }
              const isAuto = f.driver_match_method === 'auto'
              return (
                <li key={f.id} className="bg-surface border rounded-2xl p-4 flex flex-col sm:flex-row gap-3">
                  <a href={f.photo_url} target="_blank" rel="noopener noreferrer"
                    className="flex-shrink-0 w-16 h-16 bg-surface-2 border rounded-xl flex items-center justify-center text-xl hover:border-brand">
                    📄
                  </a>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-ink font-semibold text-sm">{f.plate}</span>
                      <span className="text-ink-muted text-xs">·</span>
                      <span className="text-ink-secondary text-xs">{fmtDate(f.infraction_date)}</span>
                      {f.infraction_type && <span className="text-ink-muted text-xs">· {TYPE_LABEL[f.infraction_type] || f.infraction_type}</span>}
                    </div>
                    {f.infraction_place && <p className="text-ink-muted text-xs truncate">{f.infraction_place}</p>}
                    <p className="text-ink-muted text-xs mt-0.5">
                      {f.driver
                        ? <>Chauffeur : <span className="text-ink font-medium">{f.driver.name}</span> {isAuto && <span className="text-ink-faint">· auto</span>}</>
                        : <span className="text-amber-700 italic">⚠️ Chauffeur non identifié</span>}
                      {f.mission && (
                        <> · <Link href={`/dispatch/${f.mission.id}`} className="text-info hover:underline">
                          Mission {f.mission.mission_number != null ? `#${f.mission.mission_number}` : (f.mission.external_id || f.mission.dossier_number)}
                        </Link></>
                      )}
                    </p>
                    {f.infraction_ref && <p className="text-ink-faint text-xs font-mono mt-0.5">N° {f.infraction_ref}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-ink font-bold text-base tabular-nums">{formatEur(f.amount)}</span>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${status.color}`}>
                      {status.label}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </AppShell>
  )
}
