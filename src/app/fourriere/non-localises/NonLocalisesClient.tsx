'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AppShell        from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'
import {
  AlertTriangle, RefreshCw, ArrowLeft, Search, Download, MapPin,
  ExternalLink, CheckCircle2, XCircle, Clock,
} from 'lucide-react'

interface UnlocatedVehicle {
  id:               string
  external_id:      string | null
  dossier_number:   string | null
  vehicle_plate:    string | null
  vehicle_brand:    string | null
  vehicle_model:    string | null
  vehicle_vin:      string | null
  client_name:      string | null
  billed_to_name:   string | null
  source:           string | null
  received_at:      string | null
  parc_zone_key:    string | null
  parc_row_number:  number | null
  parc_slot_index:  number | null
  unlocated_at:     string | null
  unlocated_zone:   string | null
  status:           string
  updated_at:       string
}

interface Props {
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('fr-BE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return d }
}

function fmtDateOnly(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('fr-BE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    })
  } catch { return d }
}

function daysSince(d: string | null): number | null {
  if (!d) return null
  const t = new Date(d).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

function escCsv(v: any): string {
  if (v == null) return ''
  const s = String(v)
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function NonLocalisesClient({ userRole, userName, userEmail, userModules }: Props) {
  const [vehicles, setVehicles] = useState<UnlocatedVehicle[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('')
  const [zoneFilter, setZoneFilter] = useState<string>('all')
  const [migrationMissing, setMigrationMissing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/fourriere/non-localises')
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Erreur')
      setVehicles(j.vehicles || [])
      setMigrationMissing(Boolean(j.migration_missing))
    } catch (e: any) {
      setErr(e.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function act(missionId: string, action: 'release' | 'cancel') {
    const label = action === 'release' ? 'Sortie définitive' : 'Annuler'
    if (!confirm(`${label} ce véhicule ? Cette action est irréversible.`)) return
    setBusy(missionId)
    try {
      const res = await fetch('/api/fourriere/non-localises', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: missionId, action }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Erreur')
      setVehicles(prev => prev.filter(v => v.id !== missionId))
    } catch (e: any) {
      alert(e.message || 'Erreur')
    } finally {
      setBusy(null)
    }
  }

  const zoneCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of vehicles) {
      const z = v.unlocated_zone || v.parc_zone_key || '—'
      m.set(z, (m.get(z) || 0) + 1)
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [vehicles])

  const filtered = useMemo(() => {
    let res = vehicles
    if (zoneFilter !== 'all') {
      res = res.filter(v => (v.unlocated_zone || v.parc_zone_key || '—') === zoneFilter)
    }
    const q = filter.trim().toLowerCase()
    if (q) {
      res = res.filter(v =>
        (v.vehicle_plate || '').toLowerCase().includes(q) ||
        (v.vehicle_vin || '').toLowerCase().includes(q) ||
        (v.vehicle_brand || '').toLowerCase().includes(q) ||
        (v.vehicle_model || '').toLowerCase().includes(q) ||
        (v.client_name || '').toLowerCase().includes(q) ||
        (v.dossier_number || '').toLowerCase().includes(q) ||
        (v.external_id || '').toLowerCase().includes(q) ||
        (v.billed_to_name || '').toLowerCase().includes(q)
      )
    }
    return res
  }, [vehicles, zoneFilter, filter])

  function downloadCsv() {
    const header = 'Plaque,Marque,Modele,VIN,Client,Dossier,Source,Facture a,Zone perte,Date perte,Recu le'
    const rows = filtered.map(v => [
      escCsv(v.vehicle_plate),
      escCsv(v.vehicle_brand),
      escCsv(v.vehicle_model),
      escCsv(v.vehicle_vin),
      escCsv(v.client_name),
      escCsv(v.dossier_number || v.external_id),
      escCsv(v.source),
      escCsv(v.billed_to_name),
      escCsv(v.unlocated_zone),
      escCsv(v.unlocated_at),
      escCsv(v.received_at),
    ].join(','))
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const today = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `non-localises_${today}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AppShell title="Véhicules non-localisés" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <AmbientBackground>
        <div className="p-4 lg:p-6 space-y-4 ambient-fade-up">

          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Link href="/fourriere"
                className="flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm transition">
                <ArrowLeft size={14} />
                Fourrière
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-ink flex items-center gap-2">
                  <AlertTriangle size={18} className="text-warning" />
                  Véhicules non-localisés
                </h1>
                <p className="text-ink-muted text-sm">
                  {filtered.length} affiché{filtered.length > 1 ? 's' : ''} · {vehicles.length} au total
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={downloadCsv}
                disabled={filtered.length === 0}
                className="flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm transition disabled:opacity-50">
                <Download size={14} />
                CSV
              </button>
              <button onClick={load} disabled={loading}
                className="flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm transition disabled:opacity-50">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                Rafraîchir
              </button>
            </div>
          </div>

          {/* Explication */}
          <div className="bg-warning/5 border border-warning/30 rounded-2xl p-4 text-sm text-ink-secondary">
            <p className="font-medium text-ink mb-1 flex items-center gap-2">
              <AlertTriangle size={14} className="text-warning" />
              Comment un véhicule arrive ici ?
            </p>
            <p>
              Lors d&apos;un inventaire de zone, si un véhicule attendu n&apos;est pas scanné, il passe
              en <span className="font-mono text-warning">unlocated</span>. Soit on le retrouve plus
              tard en le scannant dans sa nouvelle zone (transition automatique → <span className="font-mono">parked</span>),
              soit on confirme ici qu&apos;il est sorti définitivement (sortie discrète) ou
              qu&apos;il faut annuler la mission (jamais arrivé).
            </p>
          </div>

          {migrationMissing && (
            <div className="bg-critical/10 border border-critical/40 rounded-2xl p-4 text-sm text-critical">
              <p className="font-medium">⚠️ Migration BDD manquante</p>
              <p className="text-ink-secondary mt-1">
                La migration <code>202605202000_unlocated_status.sql</code> n&apos;est pas encore appliquée.
                Les colonnes <code>unlocated_at</code> et <code>unlocated_zone</code> sont manquantes →
                la date de perte et la zone d&apos;origine ne sont pas affichées.
              </p>
            </div>
          )}

          {err && (
            <div className="bg-critical/10 border border-critical/40 rounded-2xl p-4 text-sm text-critical">
              {err}
            </div>
          )}

          {/* Filtres */}
          <div className="bg-surface border rounded-2xl p-3 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="Plaque, VIN, marque, client, dossier…"
                  className="w-full pl-9 pr-3 py-2 bg-surface-2 border rounded-xl text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-brand"
                />
              </div>
            </div>

            {zoneCounts.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setZoneFilter('all')}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                    zoneFilter === 'all'
                      ? 'bg-brand/20 border-brand text-brand'
                      : 'bg-surface-2 border-ink/15 text-ink-secondary hover:text-ink'
                  }`}>
                  Toutes ({vehicles.length})
                </button>
                {zoneCounts.map(([zone, count]) => (
                  <button
                    key={zone}
                    onClick={() => setZoneFilter(zone)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                      zoneFilter === zone
                        ? 'bg-warning/20 border-warning text-warning'
                        : 'bg-surface-2 border-ink/15 text-ink-secondary hover:text-ink'
                    }`}>
                    {zone === '—' ? 'Sans zone' : `Zone ${zone}`} ({count})
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Table */}
          {loading ? (
            <div className="bg-surface border rounded-2xl p-8 text-center text-ink-muted text-sm">
              Chargement…
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-surface border rounded-2xl p-8 text-center">
              <CheckCircle2 className="mx-auto text-success mb-2" size={32} />
              <p className="text-ink font-medium">Aucun véhicule non-localisé</p>
              <p className="text-ink-muted text-sm mt-1">
                {vehicles.length === 0
                  ? 'Tous les véhicules attendus ont été retrouvés lors des derniers inventaires.'
                  : 'Aucun résultat pour ce filtre.'}
              </p>
            </div>
          ) : (
            <div className="bg-surface border rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 border-b">
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-2.5 font-medium">Plaque</th>
                      <th className="px-3 py-2.5 font-medium">Véhicule</th>
                      <th className="px-3 py-2.5 font-medium">Client</th>
                      <th className="px-3 py-2.5 font-medium">Dossier</th>
                      <th className="px-3 py-2.5 font-medium">Zone perte</th>
                      <th className="px-3 py-2.5 font-medium">Perdu depuis</th>
                      <th className="px-3 py-2.5 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {filtered.map(v => {
                      const days = daysSince(v.unlocated_at)
                      return (
                        <tr key={v.id} className="hover:bg-surface-hover transition">
                          <td className="px-3 py-2.5">
                            <span className="font-mono font-medium text-ink">{v.vehicle_plate || '—'}</span>
                            {v.vehicle_vin && (
                              <div className="text-xs text-ink-muted font-mono mt-0.5">{v.vehicle_vin}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-ink-secondary">
                            {[v.vehicle_brand, v.vehicle_model].filter(Boolean).join(' ') || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-ink-secondary">
                            <div>{v.client_name || '—'}</div>
                            {v.billed_to_name && v.billed_to_name !== v.client_name && (
                              <div className="text-xs text-ink-muted">💳 {v.billed_to_name}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-mono text-xs text-ink-secondary">{v.dossier_number || v.external_id || '—'}</div>
                            {v.source && (
                              <div className="text-xs text-ink-muted uppercase mt-0.5">{v.source}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {v.unlocated_zone ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-warning/15 border border-warning/40 text-warning text-xs font-semibold rounded-md">
                                <MapPin size={11} />
                                {v.unlocated_zone}
                              </span>
                            ) : (
                              <span className="text-ink-muted text-xs">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5 text-ink-secondary">
                              <Clock size={12} className="text-ink-muted" />
                              <span className={days !== null && days > 7 ? 'text-warning font-medium' : ''}>
                                {days !== null ? `${days} j` : '—'}
                              </span>
                            </div>
                            <div className="text-xs text-ink-muted mt-0.5">{fmtDateOnly(v.unlocated_at)}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              <Link
                                href={`/dispatch/${v.id}`}
                                className="p-1.5 hover:bg-surface-hover rounded-md text-ink-muted hover:text-ink transition"
                                title="Voir la mission">
                                <ExternalLink size={14} />
                              </Link>
                              <button
                                onClick={() => act(v.id, 'release')}
                                disabled={busy === v.id}
                                className="px-2 py-1 bg-success/10 hover:bg-success/20 border border-success/30 text-success text-xs font-semibold rounded-md transition disabled:opacity-50"
                                title="Sortie définitive (le véhicule a été restitué/sorti, marquer terminé)">
                                <CheckCircle2 size={12} className="inline mr-1" />
                                Sortie
                              </button>
                              <button
                                onClick={() => act(v.id, 'cancel')}
                                disabled={busy === v.id}
                                className="px-2 py-1 bg-critical/10 hover:bg-critical/20 border border-critical/30 text-critical text-xs font-semibold rounded-md transition disabled:opacity-50"
                                title="Annuler (mission jamais arrivée ou erreur)">
                                <XCircle size={12} className="inline mr-1" />
                                Annuler
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </AmbientBackground>
    </AppShell>
  )
}
