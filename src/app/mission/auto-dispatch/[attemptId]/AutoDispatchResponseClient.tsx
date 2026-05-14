'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Clock, MapPin, Truck } from 'lucide-react'

interface Mission {
  id:                  string
  dossier_number:      string | null
  source:              string
  mission_type:        string | null
  incident_address:    string | null
  incident_city:       string | null
  destination_address: string | null
  destination_name:    string | null
  client_name:         string | null
  vehicle_plate:       string | null
  vehicle_brand:       string | null
  vehicle_model:       string | null
}

const UNAVAILABLE_REASONS = [
  { value: 'intervention_police', label: 'Intervention police' },
  { value: 'vehicule_panne',      label: 'Véhicule en panne' },
  { value: 'pause',               label: 'Pause / repos' },
  { value: 'autre',               label: 'Autre' },
]

export default function AutoDispatchResponseClient({
  attemptId, mission, isInMission,
}: {
  attemptId:   string
  mission:     Mission
  isInMission: boolean
}) {
  const router = useRouter()
  const [loading, setLoading]               = useState(false)
  const [showUnavailable, setShowUnavailable] = useState(false)
  const [reason, setReason]                 = useState('')
  const [customReason, setCustomReason]     = useState('')
  const [done, setDone]                     = useState<'accepted' | 'refused' | null>(null)

  async function respond(action: 'accept' | 'available_in' | 'unavailable', extra?: { response_min?: number; reason?: string }) {
    setLoading(true)
    try {
      const body: any = { attempt_id: attemptId, action }
      if (extra?.response_min !== undefined) body.response_min = extra.response_min
      if (extra?.reason) body.reason = extra.reason
      const r = await fetch('/api/auto-dispatch/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) {
        alert('Erreur : ' + (j.error || r.status))
        return
      }
      setDone(action === 'unavailable' ? 'refused' : 'accepted')
      // Redirect vers la mission ou dashboard apres 2s
      setTimeout(() => {
        if (action === 'unavailable') router.push('/dashboard')
        else router.push(`/mission/${mission.id}`)
      }, 2000)
    } catch (e: any) {
      alert('Erreur réseau : ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  if (done === 'accepted') {
    return (
      <div className="p-6 max-w-md mx-auto text-center min-h-screen flex flex-col justify-center">
        <div className="w-20 h-20 mx-auto mb-4 bg-success rounded-full flex items-center justify-center">
          <Check size={40} className="text-white" />
        </div>
        <h1 className="text-ink text-2xl font-bold mb-2">Mission acceptée !</h1>
        <p className="text-ink-muted">Redirection vers la mission…</p>
      </div>
    )
  }
  if (done === 'refused') {
    return (
      <div className="p-6 max-w-md mx-auto text-center min-h-screen flex flex-col justify-center">
        <div className="w-20 h-20 mx-auto mb-4 bg-ink-muted rounded-full flex items-center justify-center">
          <X size={40} className="text-white" />
        </div>
        <h1 className="text-ink text-xl font-bold mb-2">OK, on prend note</h1>
        <p className="text-ink-muted">Un autre chauffeur va être contacté.</p>
      </div>
    )
  }

  const vehicleLabel = [mission.vehicle_brand, mission.vehicle_model, mission.vehicle_plate]
    .filter(Boolean).join(' ')
  const incidentLabel = [mission.incident_address, mission.incident_city]
    .filter(Boolean).join(', ')

  return (
    <div className="min-h-screen bg-surface-2 p-4">
      <div className="max-w-md mx-auto">
        {/* Header mission */}
        <div className="bg-surface border rounded-2xl p-5 mb-4 shadow-md">
          <div className="flex items-center justify-between mb-3">
            <span className="text-ink-faint text-xs uppercase tracking-wider">Nouvelle mission</span>
            <span className="px-2 py-0.5 bg-brand-soft border border-brand text-brand rounded-md text-xs font-medium uppercase">
              {mission.mission_type}
            </span>
          </div>
          <h1 className="text-ink text-xl font-bold mb-1">
            #{mission.dossier_number || mission.id.slice(0, 8)}
          </h1>
          {mission.client_name && (
            <p className="text-ink-secondary text-sm mb-3">{mission.client_name}</p>
          )}

          {vehicleLabel && (
            <div className="flex items-start gap-2 text-sm text-ink mt-3">
              <Truck size={16} className="text-ink-muted mt-0.5 flex-shrink-0" />
              <span>{vehicleLabel}</span>
            </div>
          )}
          {incidentLabel && (
            <div className="flex items-start gap-2 text-sm text-ink mt-2">
              <MapPin size={16} className="text-ink-muted mt-0.5 flex-shrink-0" />
              <span>{incidentLabel}</span>
            </div>
          )}
          {mission.destination_address && (
            <div className="flex items-start gap-2 text-sm text-ink-secondary mt-2">
              <MapPin size={16} className="text-ink-faint mt-0.5 flex-shrink-0" />
              <span>→ {mission.destination_name || mission.destination_address}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        {!showUnavailable ? (
          <div className="space-y-2">
            {isInMission ? (
              <>
                <p className="text-ink-secondary text-sm text-center mb-3">
                  Tu es en mission actuellement. Quand seras-tu dispo ?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[5, 10, 15, 30].map(min => (
                    <button key={min}
                      disabled={loading}
                      onClick={() => respond('available_in', { response_min: min })}
                      className="px-4 py-3 bg-brand hover:bg-brand-hover text-white rounded-xl font-bold transition disabled:opacity-50">
                      <Clock size={16} className="inline mr-1" />
                      Dans {min} min
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button disabled={loading}
                onClick={() => respond('accept')}
                className="w-full px-4 py-4 bg-success hover:bg-success/90 text-white rounded-xl text-lg font-bold transition disabled:opacity-50">
                <Check size={20} className="inline mr-2" />
                Accepter la mission
              </button>
            )}

            <button disabled={loading}
              onClick={() => setShowUnavailable(true)}
              className="w-full px-4 py-3 bg-surface border border-critical/30 text-critical hover:bg-critical-soft rounded-xl text-sm font-medium transition disabled:opacity-50">
              ✕ Pas disponible
            </button>
          </div>
        ) : (
          <div className="bg-surface border rounded-2xl p-4 space-y-3">
            <h2 className="text-ink font-semibold">Motif</h2>
            {UNAVAILABLE_REASONS.map(r => (
              <label key={r.value}
                className={`flex items-center gap-2 px-3 py-2 border rounded-xl cursor-pointer transition ${
                  reason === r.value ? 'border-brand bg-brand-soft' : 'border-base bg-surface-2 hover:bg-surface-hover'
                }`}>
                <input type="radio" name="reason" value={r.value}
                  checked={reason === r.value}
                  onChange={e => setReason(e.target.value)}
                  className="text-brand" />
                <span className="text-ink text-sm">{r.label}</span>
              </label>
            ))}
            {reason === 'autre' && (
              <input value={customReason}
                onChange={e => setCustomReason(e.target.value)}
                placeholder="Précise…"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
            )}

            <div className="flex gap-2 pt-2">
              <button type="button"
                onClick={() => { setShowUnavailable(false); setReason(''); setCustomReason('') }}
                className="flex-1 px-4 py-2 bg-surface-2 hover:bg-surface-hover border text-ink-secondary rounded-xl text-sm transition">
                Annuler
              </button>
              <button type="button"
                disabled={loading || !reason}
                onClick={() => respond('unavailable', { reason: reason === 'autre' ? customReason : reason })}
                className="flex-1 px-4 py-2 bg-critical hover:bg-critical/80 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
                Confirmer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
