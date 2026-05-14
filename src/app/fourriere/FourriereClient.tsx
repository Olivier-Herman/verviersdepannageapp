'use client'

import { useEffect, useMemo, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'
import { ArrowRightLeft, RefreshCw, X, ExternalLink } from 'lucide-react'

interface Zone {
  state_id:    number
  code:        string
  label:       string
  full_name:   string
  description?: string
}

interface Vehicle {
  id:          number
  plate:       string | null
  vin:         string | null
  brand:       string
  model:       string
  driver:      string | null
  state_id:    number | null
  zone_code:   string | null
  zone_label:  string | null
  last_update: string | null
  odoo_url:    string
}

interface Props {
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
}

const ZONE_COLOR: Record<string, string> = {
  A:    'bg-critical/15 border-critical text-critical',          // Accident
  B:    'bg-info/15 border-info text-info',
  'B*': 'bg-purple-500/15 border-purple-500 text-purple-500',    // VIP
  C:    'bg-success/15 border-success text-success',
  D:    'bg-warning/15 border-warning text-warning',             // Étranger
  E:    'bg-amber-500/15 border-amber-500 text-amber-500',
  F:    'bg-cyan-500/15 border-cyan-500 text-cyan-500',
  G:    'bg-pink-500/15 border-pink-500 text-pink-500',
  H:    'bg-indigo-500/15 border-indigo-500 text-indigo-500',
  I:    'bg-rose-500/15 border-rose-500 text-rose-500',          // Domaine
  L:    'bg-orange-500/15 border-orange-500 text-orange-500',    // Mal garée
  LABO: 'bg-teal-500/15 border-teal-500 text-teal-500',
  S:    'bg-violet-500/15 border-violet-500 text-violet-500',
  BOX:  'bg-ink/10 border-ink/30 text-ink-secondary',
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return d }
}

export default function FourriereClient({ userRole, userName, userEmail, userModules }: Props) {
  const [vehicles, setVehicles]   = useState<Vehicle[]>([])
  const [zones, setZones]         = useState<Zone[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState<string>('')         // recherche libre
  const [zoneFilter, setZoneFilter] = useState<string>('all')    // code zone ou 'all'
  const [moving, setMoving]       = useState<Vehicle | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/fourriere/list')
      const j = await res.json()
      setVehicles(j.vehicles || [])
      setZones(j.zones || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    let res = vehicles
    if (zoneFilter !== 'all') res = res.filter(v => v.zone_code === zoneFilter)
    const q = filter.toLowerCase().trim()
    if (q) {
      res = res.filter(v =>
        (v.plate || '').toLowerCase().includes(q) ||
        (v.vin || '').toLowerCase().includes(q) ||
        v.brand.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        (v.driver || '').toLowerCase().includes(q)
      )
    }
    return res
  }, [vehicles, filter, zoneFilter])

  const countsByZone = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of vehicles) {
      if (!v.zone_code) continue
      m.set(v.zone_code, (m.get(v.zone_code) || 0) + 1)
    }
    return m
  }, [vehicles])

  return (
    <AppShell title="Fourrière" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <AmbientBackground>
      <div className="p-4 lg:p-6 space-y-4 ambient-fade-up">

        {/* Header + actions */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-ink-muted text-sm">{filtered.length} véhicule{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''} · {vehicles.length} total</p>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm transition disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Rafraîchir
          </button>
        </div>

        {/* Filtres zones (pills) */}
        <div className="bg-surface border rounded-2xl p-3 space-y-2">
          <p className="text-ink-muted text-xs uppercase tracking-wide font-medium">Filtrer par zone</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setZoneFilter('all')}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                zoneFilter === 'all' ? 'bg-brand text-white border-brand' : 'bg-surface text-ink-secondary hover:text-ink hover:bg-surface-hover'
              }`}
            >
              Toutes ({vehicles.length})
            </button>
            {zones.map(z => {
              const count = countsByZone.get(z.code) || 0
              const active = zoneFilter === z.code
              const colorClass = ZONE_COLOR[z.code] || 'bg-surface text-ink-secondary border'
              return (
                <button
                  key={z.code}
                  onClick={() => setZoneFilter(active ? 'all' : z.code)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                    active ? `${colorClass} scale-105 shadow-sm` : 'bg-surface text-ink-secondary border hover:text-ink hover:bg-surface-hover'
                  }`}
                  title={z.description || z.label}
                >
                  {z.code} · {count}
                </button>
              )
            })}
          </div>
        </div>

        {/* Recherche */}
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Rechercher plaque, VIN, marque, modèle, chauffeur..."
          className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint"
        />

        {/* Tableau */}
        {loading ? (
          <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">
            <RefreshCw size={24} className="mx-auto animate-spin mb-3 text-brand" />
            Chargement depuis Odoo…
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center">
            <p className="text-ink-muted text-sm">Aucun véhicule dans cette sélection.</p>
          </div>
        ) : (
          <div className="bg-surface border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 border-b text-ink-muted text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2">Zone</th>
                  <th className="text-left px-3 py-2">Plaque</th>
                  <th className="text-left px-3 py-2">Véhicule</th>
                  <th className="text-left px-3 py-2">VIN</th>
                  <th className="text-left px-3 py-2">Dernier mvmt</th>
                  <th className="w-32"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(v => {
                  const zoneColorClass = v.zone_code ? (ZONE_COLOR[v.zone_code] || 'bg-surface-2 text-ink-secondary border') : ''
                  return (
                    <tr key={v.id} className="hover:bg-surface-hover">
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold border ${zoneColorClass}`}>
                          {v.zone_code || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-ink font-semibold">{v.plate || '—'}</td>
                      <td className="px-3 py-2">
                        <p className="text-ink">{[v.brand, v.model].filter(Boolean).join(' ') || '—'}</p>
                        {v.driver && <p className="text-ink-muted text-xs">{v.driver}</p>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-secondary">{v.vin || '—'}</td>
                      <td className="px-3 py-2 text-xs text-ink-muted">{fmtDate(v.last_update)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <a href={v.odoo_url} target="_blank" rel="noreferrer"
                            className="p-1.5 text-ink-faint hover:text-brand transition rounded"
                            title="Voir fiche Odoo">
                            <ExternalLink size={14} />
                          </a>
                          <button onClick={() => setMoving(v)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-brand hover:bg-brand-hover text-white rounded-md text-xs font-semibold transition">
                            <ArrowRightLeft size={12} />
                            Déplacer
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </AmbientBackground>

      {moving && (
        <MoveModal
          vehicle={moving}
          zones={zones}
          onClose={() => setMoving(null)}
          onSaved={() => { setMoving(null); load() }}
        />
      )}
    </AppShell>
  )
}

function MoveModal({
  vehicle, zones, onClose, onSaved,
}: {
  vehicle: Vehicle
  zones:   Zone[]
  onClose: () => void
  onSaved: () => void
}) {
  const [targetStateId, setTargetStateId] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function save() {
    if (!targetStateId) { setError('Sélectionne une zone'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/fourriere/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          odoo_vehicle_id: vehicle.id,
          to_state_id:     targetStateId,
          notes:           notes.trim() || undefined,
        }),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error || 'Erreur'); return }
      onSaved()
    } catch (e: any) {
      setError(e.message || 'Erreur réseau')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-ink-muted text-xs">{vehicle.plate || '—'} · {[vehicle.brand, vehicle.model].filter(Boolean).join(' ')}</p>
            <h3 className="text-ink font-semibold">Déplacer vers une zone</h3>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X size={20} /></button>
        </div>

        <div>
          <p className="text-ink-muted text-xs mb-1">Zone actuelle</p>
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold border ${vehicle.zone_code ? (ZONE_COLOR[vehicle.zone_code] || '') : ''}`}>
            {vehicle.zone_label || '—'}
          </span>
        </div>

        <div>
          <label className="block text-ink-muted text-xs mb-2">Zone destination</label>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {zones.filter(z => z.state_id !== vehicle.state_id).map(z => {
              const active = targetStateId === z.state_id
              const colorClass = ZONE_COLOR[z.code] || ''
              return (
                <button
                  key={z.state_id}
                  type="button"
                  onClick={() => setTargetStateId(z.state_id)}
                  title={z.description || z.label}
                  className={`px-2 py-2 rounded-lg text-xs font-bold border transition ${
                    active ? `${colorClass} scale-105 shadow` : 'bg-surface-2 text-ink-secondary border hover:bg-surface-hover'
                  }`}
                >
                  {z.code}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="block text-ink-muted text-xs mb-1">Note (optionnel)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Motif du déplacement..."
            className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand resize-none" />
        </div>

        {error && (
          <div className="bg-critical-soft border border-critical rounded-lg p-2 text-critical text-xs">⚠ {error}</div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2 bg-surface-2 hover:bg-surface-hover border text-ink-secondary rounded-xl text-sm transition">
            Annuler
          </button>
          <button onClick={save} disabled={saving || !targetStateId}
            className="flex-1 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
            {saving ? '⏳…' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  )
}
