'use client'

import { useEffect, useMemo, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'
import { ArrowRightLeft, RefreshCw, X, ExternalLink, ScanLine, Map as MapIcon, MapPin, AlertCircle, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

interface Zone {
  state_id:    number
  code:        string
  label:       string
  full_name:   string
  description?: string
}

interface Vehicle {
  id:               number
  mission_id:       string | null
  plate:            string | null
  vin:              string | null
  brand:            string
  model:            string
  driver:           string | null
  state_id:         number | null
  zone_code:        string | null
  zone_label:       string | null
  parc_row_number:  number | null
  parc_slot_index:  number | null
  last_update:      string | null
  odoo_url:         string
}

interface Props {
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
  // Olivier 2026-06-03 : props optionnels pour la vue parc precis.
  // Si depotZoneKeys est defini, on restreint l affichage aux zones de ce parc
  // et on affiche TOUTES les zones (meme celles a 0 vehicule).
  depotName?:     string
  depotZoneKeys?: string[]
}

const ZONE_COLOR: Record<string, string> = {
  A:       'bg-critical/15 border-critical text-critical',          // Accident
  B:       'bg-info/15 border-info text-info',
  'B*':    'bg-purple-500/15 border-purple-500 text-purple-500',    // VIP
  C:       'bg-success/15 border-success text-success',
  D:       'bg-warning/15 border-warning text-warning',             // Étranger
  E:       'bg-amber-500/15 border-amber-500 text-amber-500',
  F:       'bg-cyan-500/15 border-cyan-500 text-cyan-500',
  G:       'bg-pink-500/15 border-pink-500 text-pink-500',
  H:       'bg-indigo-500/15 border-indigo-500 text-indigo-500',
  I:       'bg-rose-500/15 border-rose-500 text-rose-500',          // Domaine
  J:       'bg-emerald-500/15 border-emerald-500 text-emerald-500',
  K:       'bg-sky-500/15 border-sky-500 text-sky-500',
  L:       'bg-orange-500/15 border-orange-500 text-orange-500',    // Mal garée
  LABO:    'bg-teal-500/15 border-teal-500 text-teal-500',
  S:       'bg-violet-500/15 border-violet-500 text-violet-500',
  Box:     'bg-ink/10 border-ink/30 text-ink-secondary',
  Transit: 'bg-yellow-500/15 border-yellow-500 text-yellow-700',
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return d }
}

export default function FourriereClient({ userRole, userName, userEmail, userModules, depotName, depotZoneKeys }: Props) {
  const [vehicles, setVehicles]   = useState<Vehicle[]>([])
  const [allZones, setAllZones]   = useState<Zone[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState<string>('')         // recherche libre
  const [zoneFilter, setZoneFilter] = useState<string>('all')    // code zone ou 'all'
  const [onlyToPlace, setOnlyToPlace] = useState<boolean>(false) // toggle "À placer"
  const [moving, setMoving]       = useState<Vehicle | null>(null)
  const [unlocatedCount, setUnlocatedCount] = useState<number>(0)

  async function load() {
    setLoading(true)
    try {
      const [resList, resUnloc] = await Promise.all([
        fetch('/api/fourriere/list'),
        fetch('/api/fourriere/non-localises'),
      ])
      const j = await resList.json()
      setVehicles(j.vehicles || [])
      setAllZones(j.zones || [])
      if (resUnloc.ok) {
        const ju = await resUnloc.json()
        setUnlocatedCount((ju.vehicles || []).length)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // Un vehicule est "a placer" s il est dans une zone fourriere Odoo mais
  // qu il manque rangee ou emplacement dans incoming_missions
  function needsPlacement(v: Vehicle): boolean {
    return v.zone_code != null && (v.parc_row_number == null || v.parc_slot_index == null)
  }

  // Olivier 2026-06-03 : si vue parc precis (depotZoneKeys defini, meme vide),
  // on restreint zones et vehicules a ce parc. Un tableau vide = parc sans
  // zones, donc on doit afficher 0 zones (pas un fallback global qui leak les
  // zones des autres parcs).
  const zones = useMemo(() => {
    if (!depotZoneKeys) return allZones
    const set = new Set(depotZoneKeys)
    return allZones.filter(z => set.has(z.code))
  }, [allZones, depotZoneKeys])

  const scopedVehicles = useMemo(() => {
    if (!depotZoneKeys) return vehicles
    const set = new Set(depotZoneKeys)
    return vehicles.filter(v => v.zone_code && set.has(v.zone_code))
  }, [vehicles, depotZoneKeys])

  const toPlaceCount = useMemo(() => scopedVehicles.filter(needsPlacement).length, [scopedVehicles])

  const filtered = useMemo(() => {
    let res = scopedVehicles
    if (onlyToPlace) res = res.filter(needsPlacement)
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
  }, [scopedVehicles, filter, zoneFilter, onlyToPlace])

  const countsByZone = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of scopedVehicles) {
      if (!v.zone_code) continue
      m.set(v.zone_code, (m.get(v.zone_code) || 0) + 1)
    }
    return m
  }, [scopedVehicles])

  return (
    <AppShell title="Fourrière" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <AmbientBackground>
      <div className="p-4 lg:p-6 space-y-4 ambient-fade-up">

        {/* Header + actions */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            {depotName && (
              <h1 className="font-display text-xl font-bold text-ink mb-0.5">Parc {depotName}</h1>
            )}
            <p className="text-ink-muted text-sm">{filtered.length} véhicule{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''} · {scopedVehicles.length} total{depotName ? ' dans ce parc' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/fourriere/non-localises"
              className={`flex items-center gap-2 px-3 py-2 border rounded-xl text-sm font-medium transition ${
                unlocatedCount > 0
                  ? 'bg-warning/10 hover:bg-warning/20 border-warning/40 text-warning'
                  : 'bg-surface-2 hover:bg-surface-hover border-ink/15 text-ink-secondary hover:text-ink'
              }`}>
              <AlertTriangle size={14} />
              Non-localisés
              {unlocatedCount > 0 && (
                <span className="px-1.5 py-0.5 bg-warning text-white rounded-full text-xs font-bold leading-none">
                  {unlocatedCount}
                </span>
              )}
            </Link>
            <Link href="/fourriere/plan"
              className="flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm transition">
              <MapIcon size={14} />
              Plan du parc
            </Link>
            <Link href="/fourriere/inventaire"
              className="flex items-center gap-2 px-3 py-2 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-medium transition">
              <ScanLine size={14} />
              Inventaire
            </Link>
            <button onClick={load} disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm transition disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Rafraîchir
            </button>
          </div>
        </div>

        {/* Filtres zones (pills) */}
        <div className="bg-surface border rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-ink-muted text-xs uppercase tracking-wide font-medium">Filtrer par zone</p>
            {toPlaceCount > 0 && (
              <button
                onClick={() => setOnlyToPlace(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                  onlyToPlace
                    ? 'bg-warning text-white border-warning shadow-sm'
                    : 'bg-warning/10 text-warning border-warning/40 hover:bg-warning/20'
                }`}
                title="N'afficher que les véhicules dont la rangée ou l'emplacement n'est pas encore défini"
              >
                <AlertCircle size={12} />
                {onlyToPlace ? 'Tous' : 'À placer'} ({toPlaceCount})
              </button>
            )}
          </div>
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
        ) : depotZoneKeys && depotZoneKeys.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center">
            <p className="text-ink-secondary text-sm font-medium">Aucune zone configurée pour ce parc.</p>
            <p className="text-ink-muted text-xs mt-2">
              Crée des zones depuis <Link href="/admin/parc" className="text-brand hover:underline">/admin/parc</Link> et assigne-les à ce parc.
            </p>
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
                  <th className="text-center px-2 py-2">Rangée</th>
                  <th className="text-center px-2 py-2">Empl.</th>
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
                  const toPlace = needsPlacement(v)
                  return (
                    <tr key={v.id} className={`hover:bg-surface-hover ${toPlace ? 'bg-warning/5' : ''}`}>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold border ${zoneColorClass}`}>
                          {v.zone_code || '—'}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-center font-mono text-ink-secondary">
                        {v.parc_row_number ?? <span className="text-warning font-bold" title="Rangée à définir">—</span>}
                      </td>
                      <td className="px-2 py-2 text-center font-mono text-ink-secondary">
                        {v.parc_slot_index ?? <span className="text-warning font-bold" title="Emplacement à définir">—</span>}
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
