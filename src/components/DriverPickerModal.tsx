'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface DriverEta {
  id: string
  name: string
  avatar_url: string | null
  has_position: boolean
  location_age_seconds: number | null
  is_fresh: boolean
  status: 'free' | 'on_mission'
  eta_to_incident_min: number | null
  current_mission: null | {
    id: string
    dossier_number: string | null
    mission_type: string | null
    destination_address: string
    eta_to_destination_min: number | null
    eta_destination_to_incident_min: number | null
    status: string
  }
}

/**
 * Modal de sélection chauffeur avec ETA temps réel + cap 90 km/h camion.
 * Réutilisable depuis n'importe quel écran qui a un missionId (et optionnellement
 * les coords incident pour bypasser la lecture DB).
 */
export default function DriverPickerModal({ missionId, incidentLat, incidentLng, onPick, onClose }: {
  missionId:    string
  incidentLat?: number | null
  incidentLng?: number | null
  onPick:       (driverId: string) => void
  onClose:      () => void
}) {
  const [drivers, setDrivers] = useState<DriverEta[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const qs = incidentLat != null && incidentLng != null
          ? `?lat=${incidentLat}&lng=${incidentLng}`
          : ''
        const res  = await fetch(`/api/missions/${missionId}/driver-eta${qs}`)
        const data = await res.json()
        if (data.error) setError(data.error)
        else setDrivers(data.drivers || [])
      } catch (e: any) {
        setError(e.message || 'Erreur de chargement')
      } finally {
        setLoading(false)
      }
    })()
  }, [missionId, incidentLat, incidentLng])

  const fmtAge = (sec: number | null) => {
    if (sec == null) return ''
    if (sec < 60)    return `il y a ${sec}s`
    const min = Math.floor(sec / 60)
    if (min < 60)    return `il y a ${min} min`
    return `il y a ${Math.floor(min / 60)}h`
  }

  // Portal au niveau body pour éviter les conflits de z-index/transform
  // si le modal est instancié depuis une card avec transform/overflow.
  if (typeof window === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-[#2a2a2a] flex items-center justify-between sticky top-0 bg-[#1A1A1A]">
          <div>
            <h2 className="text-white font-bold text-lg">🚛 Choisir un chauffeur</h2>
            <p className="text-zinc-400 text-xs mt-1">ETA camion (90 km/h max sur autoroute)</p>
          </div>
          <button type="button" onClick={onClose}
            className="text-zinc-500 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-2">
          {loading && <p className="text-zinc-500 text-sm text-center py-8">⏳ Calcul des temps de trajet…</p>}
          {error && <p className="text-red-400 text-sm text-center py-8">❌ {error}</p>}
          {!loading && !error && drivers.length === 0 && (
            <p className="text-zinc-500 text-sm text-center py-8">Aucun chauffeur en service actuellement.</p>
          )}
          {drivers.map(d => {
            const free = d.status === 'free'
            const cm = d.current_mission
            const totalEta = !free && cm
              ? (cm.eta_to_destination_min || 0) + (cm.eta_destination_to_incident_min || 0)
              : d.eta_to_incident_min

            return (
              <button key={d.id} type="button" onClick={() => onPick(d.id)}
                className={`w-full text-left p-4 rounded-xl border transition ${
                  free
                    ? 'bg-green-500/5 hover:bg-green-500/10 border-green-500/30'
                    : 'bg-amber-500/5 hover:bg-amber-500/10 border-amber-500/30'
                }`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${free ? 'bg-green-400' : 'bg-amber-400'}`}></span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold">{d.name}</p>
                      {free ? (
                        <p className="text-green-300 text-xs">
                          Libre {d.has_position && d.location_age_seconds != null && `· position ${fmtAge(d.location_age_seconds)}`}
                        </p>
                      ) : (
                        <p className="text-amber-300 text-xs truncate">
                          En mission → {cm?.destination_address || '(destination inconnue)'}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {totalEta != null ? (
                      <p className="text-white text-lg font-bold tabular-nums">{totalEta} min</p>
                    ) : (
                      <p className="text-zinc-500 text-xs">ETA indispo</p>
                    )}
                    <p className="text-zinc-500 text-xs">vers incident</p>
                  </div>
                </div>
                {!free && cm && (
                  <div className="mt-3 pt-3 border-t border-amber-500/20 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-zinc-500">Arrive à destination dans</p>
                      <p className="text-white font-semibold">
                        {cm.eta_to_destination_min != null ? `${cm.eta_to_destination_min} min` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Puis trajet vers incident</p>
                      <p className="text-white font-semibold">
                        {cm.eta_destination_to_incident_min != null ? `${cm.eta_destination_to_incident_min} min` : '—'}
                      </p>
                    </div>
                  </div>
                )}
                {!d.has_position && (
                  <p className="text-zinc-500 text-xs mt-2">⚠ Position non disponible</p>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}
