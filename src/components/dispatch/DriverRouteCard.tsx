'use client'

// Carte repliable « Trajet du chauffeur » pour la fiche dispatch.
// Charge le trajet à la demande (clic) pour ne pas charger Google Maps sur
// chaque fiche. Olivier 2026-06-16.

import { useState } from 'react'
import MissionRouteMap from '@/components/dispatch/MissionRouteMap'

interface TrackData {
  pings:       any[]
  points:      any[]
  incident?:   any
  destination?: any
}

export default function DriverRouteCard({ missionId, gmKey }: { missionId: string; gmKey: string }) {
  const [open, setOpen]       = useState(false)
  const [data, setData]       = useState<TrackData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/route-track`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setData(j)
    } catch (e: any) {
      setError(e.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !data && !loading) load()
  }

  return (
    <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
      <button onClick={toggle} className="w-full flex items-center justify-between text-left">
        <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide">🗺️ Trajet du chauffeur</h3>
        <span className="text-ink-faint text-sm">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {!gmKey && <p className="text-warning text-xs">Clé Google Maps absente — carte indisponible.</p>}
          {error && <p className="text-error text-xs">{error}</p>}
          {loading && !data && <p className="text-ink-muted text-sm">⏳ Chargement du trajet…</p>}

          {gmKey && data && (
            <>
              <MissionRouteMap
                gmKey={gmKey}
                pings={data.pings || []}
                points={data.points || []}
                incident={data.incident}
                destination={data.destination}
              />
              <div className="flex items-center justify-between text-xs text-ink-faint">
                <span>{(data.pings?.length || 0)} positions · {(data.points?.length || 0)} pointage(s)</span>
                <button onClick={load} className="text-brand hover:underline">↻ Rafraîchir</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
