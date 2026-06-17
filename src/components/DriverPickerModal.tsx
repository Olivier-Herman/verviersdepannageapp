'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'

interface DriverEta {
  id: string
  name: string
  avatar_url: string | null
  has_position: boolean
  location_age_seconds: number | null
  is_fresh: boolean
  is_on_duty?: boolean       // Olivier 2026-06-03
  is_on_schedule?: boolean
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
  // Toutes les missions actives du chauffeur (peut en avoir plusieurs).
  current_missions?: Array<{
    id: string
    dossier_number: string | null
    mission_type: string | null
    destination_address: string
    status: string
  }>
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
        // Olivier 2026-06-03 : include_off_duty=1 → DriverPickerModal voit
        // aussi les chauffeurs hors service (grises). Le dispatcher peut
        // quand meme les selectionner manuellement.
        const params = new URLSearchParams({ include_off_duty: '1' })
        if (incidentLat != null && incidentLng != null) {
          params.set('lat', String(incidentLat))
          params.set('lng', String(incidentLng))
        }
        const res  = await fetch(`/api/missions/${missionId}/driver-eta?${params.toString()}`)
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

  // Escape ferme la modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="driver-picker-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border rounded-card w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h2 id="driver-picker-title" className="font-display text-ink font-bold text-lg">
              🚛 Choisir un chauffeur
            </h2>
            <p className="text-ink-muted text-xs mt-0.5">ETA camion (90 km/h max sur autoroute)</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-2">
          {loading && (
            <p className="text-ink-muted text-sm text-center py-8">⏳ Calcul des temps de trajet…</p>
          )}
          {error && (
            <p className="text-critical text-sm text-center py-8">❌ {error}</p>
          )}
          {!loading && !error && drivers.length === 0 && (
            <p className="text-ink-muted text-sm text-center py-8">Aucun chauffeur en service actuellement.</p>
          )}
          {/* Olivier 2026-06-04 : chauffeurs hors-garde (grises) en bas de liste.
              On garde l ordre relatif initial (ETA) au sein de chaque groupe. */}
          {[...drivers].sort((a, b) => {
            const aOff = a.is_on_duty === false
            const bOff = b.is_on_duty === false
            if (aOff !== bOff) return aOff ? 1 : -1
            return 0
          }).map(d => {
            const free = d.status === 'free'
            const cm = d.current_mission
            const totalEta = !free && cm
              ? (cm.eta_to_destination_min || 0) + (cm.eta_destination_to_incident_min || 0)
              : d.eta_to_incident_min

            // Olivier 2026-06-03 : chauffeurs HORS GARDE affiches grises.
            // Le dispatcher peut quand meme les choisir avec confirmation.
            const isOffDuty = d.is_on_duty === false

            // Olivier 2026-06-04 : position datee = > 2h sans mise a jour.
            // Le chauffeur n est peut-etre plus a l endroit indique, l ETA
            // est donc peu fiable.
            const isStalePosition = d.location_age_seconds != null && d.location_age_seconds > 7200

            // Couleur de bordure et fond selon disponibilité — variants thème.
            const skinCls = isOffDuty
              ? 'bg-surface border opacity-50 grayscale'
              : free
                ? 'bg-success-soft border-success'
                : 'bg-warning-soft border-warning'

            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  if (isOffDuty) {
                    if (!window.confirm(`${d.name} n'est pas de garde actuellement. Confirmer son attribution ?`)) return
                  }
                  onPick(d.id)
                }}
                className={`w-full text-left p-4 rounded-card border transition-all hover:shadow-md hover:-translate-y-px ${skinCls}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Avatar
                      name={d.name}
                      userId={d.id}
                      size="md"
                      status={free ? 'available' : 'busy'}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-ink text-sm font-semibold truncate">
                        {d.name}
                        {isOffDuty && <span className="ml-2 text-[10px] uppercase font-bold text-ink-muted">⏸ Pas de garde</span>}
                        {isStalePosition && !isOffDuty && <span className="ml-2 text-[10px] uppercase font-bold text-warning-700">⚠ Position datée</span>}
                      </p>
                      {free ? (
                        <p className={`${isOffDuty ? 'text-ink-muted' : isStalePosition ? 'text-warning-700' : 'text-success'} text-xs`}>
                          Libre {d.has_position && d.location_age_seconds != null && `· position ${fmtAge(d.location_age_seconds)}${isStalePosition ? ' — peut être ailleurs maintenant' : ''}`}
                        </p>
                      ) : (() => {
                        // Toutes les missions en cours du chauffeur (pas juste une).
                        const cms = (d.current_missions && d.current_missions.length)
                          ? d.current_missions
                          : (cm ? [{ id: cm.id, dossier_number: cm.dossier_number, mission_type: cm.mission_type, destination_address: cm.destination_address, status: cm.status }] : [])
                        return (
                          <div className="text-warning text-xs space-y-0.5">
                            <p className="font-medium">{cms.length > 1 ? `${cms.length} missions en cours :` : 'En mission :'}</p>
                            {cms.map(mm => (
                              <p key={mm.id} className="truncate">
                                → {mm.destination_address || '(destination inconnue)'}{mm.dossier_number ? ` · ${mm.dossier_number}` : ''}
                              </p>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {totalEta != null ? (
                      <p className="text-ink text-lg font-bold tabular-nums font-display">{totalEta} min</p>
                    ) : (
                      <p className="text-ink-muted text-xs">ETA indispo</p>
                    )}
                    <p className="text-ink-muted text-xs">vers incident</p>
                  </div>
                </div>
                {!free && cm && (
                  <div className="mt-3 pt-3 border-t border-warning grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-ink-muted">Arrive à destination dans</p>
                      <p className="text-ink font-semibold">
                        {cm.eta_to_destination_min != null ? `${cm.eta_to_destination_min} min` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-ink-muted">Puis trajet vers incident</p>
                      <p className="text-ink font-semibold">
                        {cm.eta_destination_to_incident_min != null ? `${cm.eta_destination_to_incident_min} min` : '—'}
                      </p>
                    </div>
                  </div>
                )}
                {!d.has_position && (
                  <p className="text-ink-muted text-xs mt-2">⚠ Position non disponible</p>
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
