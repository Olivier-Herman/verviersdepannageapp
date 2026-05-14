'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArchiveRestore, ExternalLink, Search } from 'lucide-react'

interface ArchivedMission {
  id: string
  external_id:     string | null
  dossier_number:  string | null
  source:          string | null
  status:          string
  vehicle_plate:   string | null
  vehicle_brand:   string | null
  vehicle_model:   string | null
  client_name:     string | null
  intervention_date: string | null
  completed_at:    string | null
  invoiced_at:     string | null
  invoice_number:  string | null
  invoice_method:  'manual' | 'auto' | null
  archived_at:     string
}

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

export default function ArchivesClient() {
  const [missions, setMissions] = useState<ArchivedMission[]>([])
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sources,  setSources]  = useState<string[]>([])
  const [filterSource, setFilterSource] = useState<string>('all')
  const [query,    setQuery]    = useState('')
  const [loading,  setLoading]  = useState(true)
  const [unarchiving, setUnarchiving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterSource !== 'all') params.set('source', filterSource)
      if (query.trim())            params.set('q', query.trim())
      params.set('page', String(page))
      const res = await fetch(`/api/admin/archives?${params}`)
      const j = await res.json()
      setMissions(j.missions || [])
      setTotal(j.total || 0)
      setPageSize(j.pageSize || 50)
      setSources(j.sources || [])
    } finally {
      setLoading(false)
    }
  }, [filterSource, query, page])

  useEffect(() => { load() }, [load])

  async function unarchive(m: ArchivedMission) {
    if (!confirm(`Désarchiver la mission ${m.external_id || m.id.slice(0,8)} ?\nElle réapparaîtra dans la liste dispatch normale.`)) return
    setUnarchiving(m.id)
    try {
      const res = await fetch('/api/admin/archives/unarchive', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: m.id }),
      })
      if (!res.ok) { alert((await res.json()).error || 'Erreur'); return }
      // Refresh
      load()
    } finally {
      setUnarchiving(null)
    }
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="p-4 lg:p-6 space-y-4">

      <div>
        <h1 className="text-ink text-xl font-semibold">Archives</h1>
        <p className="text-ink-muted text-sm">Missions archivées automatiquement 7 jours après facturation complète. Toujours accessibles via la recherche globale ⌘K.</p>
      </div>

      {/* Filtres */}
      <div className="bg-surface border rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="relative sm:col-span-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(1) }}
            placeholder="Recherche (référence, dossier, client, plaque)..."
            className="w-full bg-surface-2 border rounded-xl pl-9 pr-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
          />
        </div>
        <select
          value={filterSource}
          onChange={e => { setFilterSource(e.target.value); setPage(1) }}
          className="bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
        >
          <option value="all">Toutes sources</option>
          {sources.map(s => <option key={s} value={s}>{fmtSource(s)}</option>)}
        </select>
      </div>

      {/* Compteur */}
      <p className="text-ink-muted text-sm">{total} mission{total > 1 ? 's' : ''} archivée{total > 1 ? 's' : ''}</p>

      {/* Liste */}
      {loading ? (
        <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">⏳ Chargement…</div>
      ) : missions.length === 0 ? (
        <div className="bg-surface border rounded-2xl p-10 text-center">
          <p className="text-ink-muted text-sm">Aucune mission archivée pour cette sélection.</p>
        </div>
      ) : (
        <div className="bg-surface border rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 border-b">
              <tr className="text-ink-muted text-xs uppercase tracking-wide">
                <th className="px-4 py-2 text-left">Référence</th>
                <th className="px-4 py-2 text-left">Source</th>
                <th className="px-4 py-2 text-left">Véhicule</th>
                <th className="px-4 py-2 text-left">Client</th>
                <th className="px-4 py-2 text-left">Intervention</th>
                <th className="px-4 py-2 text-left">Facture</th>
                <th className="px-4 py-2 text-left">Archivée</th>
                <th className="w-32"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {missions.map(m => (
                <tr key={m.id} className="hover:bg-surface-hover">
                  <td className="px-4 py-2 font-mono text-xs">{m.external_id || m.dossier_number || m.id.slice(0,8)}</td>
                  <td className="px-4 py-2 text-xs text-ink-secondary">{fmtSource(m.source)}</td>
                  <td className="px-4 py-2">
                    <p className="text-ink text-xs font-mono">{m.vehicle_plate || '—'}</p>
                    <p className="text-ink-muted text-xs">{[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
                  </td>
                  <td className="px-4 py-2 text-ink text-xs truncate max-w-[200px]">{m.client_name || '—'}</td>
                  <td className="px-4 py-2 text-ink-secondary text-xs">{fmtDate(m.intervention_date)}</td>
                  <td className="px-4 py-2 text-xs">
                    {m.invoice_method === 'auto' ? (
                      <span className="text-purple-500">⚡ Auto</span>
                    ) : m.invoice_number ? (
                      <span className="text-success font-mono">{m.invoice_number}</span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-muted text-xs">{fmtDate(m.archived_at)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      <Link href={`/dispatch/${m.id}`}
                        className="p-1.5 text-ink-faint hover:text-brand transition rounded" title="Ouvrir la fiche">
                        <ExternalLink size={14} />
                      </Link>
                      <button onClick={() => unarchive(m)} disabled={unarchiving === m.id}
                        className="flex items-center gap-1 px-2.5 py-1 bg-warning-soft hover:bg-warning text-warning hover:text-white rounded-md text-xs font-semibold transition disabled:opacity-50"
                        title="Désarchiver">
                        <ArchiveRestore size={12} />
                        {unarchiving === m.id ? '⏳…' : 'Désarchiver'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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
  )
}
