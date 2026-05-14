'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { ExternalLink, Search, Archive } from 'lucide-react'

interface TerminatedMission {
  id: string
  external_id:     string | null
  dossier_number:  string | null
  source:          string | null
  status:          string
  mission_type:    string | null
  incident_type:   string | null
  parent_mission_id: string | null
  vehicle_plate:   string | null
  vehicle_brand:   string | null
  vehicle_model:   string | null
  client_name:     string | null
  intervention_date: string | null
  completed_at:    string | null
  invoiced_at:     string | null
  invoice_number:  string | null
  invoice_method:  'manual' | 'auto' | null
  invoice_url:     string | null
  no_charge_at:    string | null
  no_charge_reason: string | null
  archived_at:     string | null
  received_at:     string
}

interface Counts {
  all:        number
  to_invoice: number
  invoiced:   number
  no_charge:  number
  cancelled:  number
  archived:   number
}

type StatusFilter = 'all' | 'to_invoice' | 'invoiced' | 'no_charge' | 'cancelled' | 'archived'

const SOURCE_LABELS: Record<string, string> = {
  touring: 'Touring', allianz: 'Allianz', vab: 'VAB',
  axa: 'AXA', ethias: 'Ethias', vivium: 'Vivium',
  mondial: 'Mondial', ardenne: 'Ardenne',
  appel_police_accident: 'Police Accident',
  prive: 'Privé', garage: 'Garage',
}
function fmtSource(s: string | null): string {
  if (!s) return '—'
  return SOURCE_LABELS[s.toLowerCase()] || s
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function missionKind(m: { mission_type: string | null; incident_type: string | null; parent_mission_id: string | null }): 'REL' | 'REM' | 'DSP' | 'DPR' | 'AUTRE' {
  const it = (m.incident_type || '').toLowerCase()
  const mt = (m.mission_type   || '').toLowerCase()
  if (it === 'relivraison' || m.parent_mission_id) return 'REL'
  if (it === 'dpr')                                 return 'DPR'
  if (mt === 'remorquage')                          return 'REM'
  if (['depannage', 'reparation_place', 'trajet_vide'].includes(mt)) return 'DSP'
  return 'AUTRE'
}

const KIND_COLOR: Record<string, string> = {
  REM: 'bg-amber-500',
  DSP: 'bg-info',
  REL: 'bg-purple-600',
  DPR: 'bg-critical',
  AUTRE: 'bg-ink-faint',
}

interface ChipProps {
  active: boolean
  onClick: () => void
  count: number
  label: string
  color?: string
}
function Chip({ active, onClick, count, label, color }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition ${
        active
          ? `${color || 'bg-brand'} text-white`
          : 'bg-surface-2 hover:bg-surface-hover text-ink-secondary border'
      }`}
    >
      {label}
      <span className={`text-xs px-1.5 py-0.5 rounded ${active ? 'bg-white/20' : 'bg-ink-faint/15 text-ink-muted'}`}>
        {count}
      </span>
    </button>
  )
}

/**
 * Tampon visuel : à facturer / facturée / autofacturée / sans frais / annulée / archivée.
 */
function MissionStamp({ m }: { m: TerminatedMission }) {
  if (m.archived_at) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-ink-faint/15 text-ink-muted">🗄 Archivée</span>
  }
  if (m.status === 'cancelled') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-critical-soft text-critical">❌ Annulée</span>
  }
  if (m.status === 'to_invoice') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-warning-soft text-warning">⏳ À facturer</span>
  }
  if (m.no_charge_at) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-600/15 text-purple-600 max-w-[200px] truncate"
        title={m.no_charge_reason || undefined}
      >
        🚫 Sans frais{m.no_charge_reason ? ' — ' + m.no_charge_reason : ''}
      </span>
    )
  }
  if (m.invoice_method === 'auto') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-info-soft text-info">⚡ Autofacturée</span>
  }
  if (m.invoice_number) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium bg-success-soft text-success">
        🧾 {m.invoice_number}
      </span>
    )
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-ink-faint/15 text-ink-muted">{m.status}</span>
}

interface Props {
  userRole:    string
  userName:    string
  userEmail:   string
  userId:      string
  userModules: string[]
}

export default function MissionsTermineesClient({ userRole, userName, userEmail, userId, userModules }: Props) {
  const [missions, setMissions] = useState<TerminatedMission[]>([])
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sources,  setSources]  = useState<string[]>([])
  const [counts,   setCounts]   = useState<Counts>({ all: 0, to_invoice: 0, invoiced: 0, no_charge: 0, cancelled: 0, archived: 0 })
  const [filterSource, setFilterSource] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [query,    setQuery]    = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [loading,  setLoading]  = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterSource !== 'all') params.set('source', filterSource)
      if (query.trim())            params.set('q', query.trim())
      if (statusFilter !== 'all')  params.set('status', statusFilter)
      if (includeArchived)         params.set('includeArchived', '1')
      params.set('page', String(page))
      const res = await fetch(`/api/missions/terminated?${params}`)
      const j = await res.json()
      setMissions(j.missions || [])
      setTotal(j.total || 0)
      setPageSize(j.pageSize || 50)
      setSources(j.sources || [])
      setCounts(j.counts || { all: 0, to_invoice: 0, invoiced: 0, no_charge: 0, cancelled: 0, archived: 0 })
    } finally {
      setLoading(false)
    }
  }, [filterSource, query, page, statusFilter, includeArchived])

  useEffect(() => { load() }, [load])

  // Reset page si filtre change
  useEffect(() => { setPage(1) }, [filterSource, statusFilter, includeArchived, query])

  const totalPages = Math.ceil(total / pageSize)

  return (
    <AppShell title="Missions terminées" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userId={userId || undefined} userModules={userModules}>
      <div className="p-4 lg:p-6 space-y-4">

        <div>
          <h1 className="text-ink text-xl font-semibold">Missions terminées</h1>
          <p className="text-ink-muted text-sm">Toutes les missions clôturées : à facturer, facturées, sans frais, annulées. Les archivées sont masquées par défaut.</p>
        </div>

        {/* Filtres chips */}
        <div className="flex flex-wrap gap-2">
          <Chip active={statusFilter === 'all'}        onClick={() => setStatusFilter('all')}        count={counts.all}        label="Toutes" />
          <Chip active={statusFilter === 'to_invoice'} onClick={() => setStatusFilter('to_invoice')} count={counts.to_invoice} label="À facturer" color="bg-warning" />
          <Chip active={statusFilter === 'invoiced'}   onClick={() => setStatusFilter('invoiced')}   count={counts.invoiced}   label="Facturées"  color="bg-success" />
          <Chip active={statusFilter === 'no_charge'}  onClick={() => setStatusFilter('no_charge')}  count={counts.no_charge}  label="Sans frais" color="bg-purple-600" />
          <Chip active={statusFilter === 'cancelled'}  onClick={() => setStatusFilter('cancelled')}  count={counts.cancelled}  label="Annulées"   color="bg-critical" />
        </div>

        {/* Filtres recherche + source + toggle archives */}
        <div className="bg-surface border rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative sm:col-span-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Recherche (référence, dossier, client, plaque, n° facture)..."
              className="w-full bg-surface-2 border rounded-xl pl-9 pr-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
            />
          </div>
          <select
            value={filterSource}
            onChange={e => setFilterSource(e.target.value)}
            className="bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
          >
            <option value="all">Toutes sources</option>
            {sources.map(s => <option key={s} value={s}>{fmtSource(s)}</option>)}
          </select>
        </div>

        {/* Toggle archives */}
        <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={e => setIncludeArchived(e.target.checked)}
            className="rounded border-ink-faint"
          />
          <Archive size={14} />
          Inclure les archivées ({counts.archived})
        </label>

        {/* Compteur */}
        <p className="text-ink-muted text-sm">{total} mission{total > 1 ? 's' : ''}</p>

        {/* Liste */}
        {loading ? (
          <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">⏳ Chargement…</div>
        ) : missions.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center">
            <p className="text-ink-muted text-sm">Aucune mission pour cette sélection.</p>
          </div>
        ) : (
          <div className="bg-surface border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-b">
                <tr className="text-ink-muted text-xs uppercase tracking-wide">
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Référence</th>
                  <th className="px-4 py-2 text-left">Source</th>
                  <th className="px-4 py-2 text-left">Véhicule</th>
                  <th className="px-4 py-2 text-left">Client</th>
                  <th className="px-4 py-2 text-left">Intervention</th>
                  <th className="px-4 py-2 text-left">Statut</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {missions.map(m => {
                  const kind = missionKind(m)
                  return (
                    <tr key={m.id} className="hover:bg-surface-hover">
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-white text-[10px] font-bold ${KIND_COLOR[kind]}`}>
                          {kind}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{m.external_id || m.dossier_number || m.id.slice(0, 8)}</td>
                      <td className="px-4 py-2 text-xs text-ink-secondary">{fmtSource(m.source)}</td>
                      <td className="px-4 py-2">
                        <p className="text-ink text-xs font-mono">{m.vehicle_plate || '—'}</p>
                        <p className="text-ink-muted text-xs">{[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
                      </td>
                      <td className="px-4 py-2 text-ink text-xs truncate max-w-[200px]">{m.client_name || '—'}</td>
                      <td className="px-4 py-2 text-ink-secondary text-xs">{fmtDate(m.intervention_date)}</td>
                      <td className="px-4 py-2">
                        <MissionStamp m={m} />
                      </td>
                      <td className="px-4 py-2">
                        <Link href={`/dispatch/${m.id}`}
                          className="p-1.5 text-ink-faint hover:text-brand transition rounded inline-block" title="Ouvrir la fiche">
                          <ExternalLink size={14} />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between bg-surface border rounded-2xl p-3">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover disabled:opacity-30 border text-ink-secondary rounded-lg text-sm">
              ← Précédent
            </button>
            <p className="text-ink-muted text-sm">Page {page} / {totalPages}</p>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover disabled:opacity-30 border text-ink-secondary rounded-lg text-sm">
              Suivant →
            </button>
          </div>
        )}
      </div>
    </AppShell>
  )
}
