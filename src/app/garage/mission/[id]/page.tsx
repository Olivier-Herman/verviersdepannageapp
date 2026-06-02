'use client'

import { useEffect, useState } from 'react'
import { useParams }           from 'next/navigation'
import Link                    from 'next/link'

interface Mission {
  id:                       string
  mission_number:           number | null
  status:                   string
  mission_type:             string | null
  vehicle_plate:            string | null
  vehicle_brand:            string | null
  vehicle_model:            string | null
  incident_address:         string | null
  client_phone:             string | null
  received_at:              string
  assigned_at:              string | null
  accepted_at:              string | null
  on_way_at:                string | null
  on_site_at:               string | null
  loaded_at:                string | null
  completed_at:             string | null
  remarks_general:          string | null
  photos_visible_to_garage: boolean
  driver_photos:            string[] | null
}

const STATUS_LABEL: Record<string, { label: string; color: string; sub?: string }> = {
  new:         { label: '⏳ Demande envoyée',  color: 'bg-blue-50 border-blue-300 text-blue-900',     sub: "Notre équipe va la traiter dans les minutes qui suivent." },
  assigned:    { label: '✓ Acceptée',          color: 'bg-indigo-50 border-indigo-300 text-indigo-900', sub: "Un chauffeur va prendre la mission en charge." },
  accepted:    { label: '✓ Acceptée',          color: 'bg-indigo-50 border-indigo-300 text-indigo-900', sub: "Le chauffeur est en route." },
  in_progress: { label: '🚗 En cours',         color: 'bg-orange-50 border-orange-300 text-orange-900', sub: "Le chauffeur est en route ou sur place." },
  delivering:  { label: '🚛 Livraison',        color: 'bg-teal-50 border-teal-300 text-teal-900',     sub: "Le véhicule est en cours de transport." },
  completed:   { label: '✅ Terminée',         color: 'bg-green-50 border-green-300 text-green-900',   sub: "Mission terminée. Facture à venir selon nos accords." },
  to_invoice:  { label: '✅ Terminée',         color: 'bg-green-50 border-green-300 text-green-900',   sub: "Mission terminée. Facture en cours d'émission." },
  cancelled:   { label: '✕ Annulée',           color: 'bg-gray-50 border-gray-300 text-gray-700',     sub: "Mission annulée." },
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function GarageMissionDetailPage() {
  const params = useParams<{ id: string }>()
  const id     = params?.id as string
  const [mission, setMission] = useState<Mission | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [busy, setBusy]               = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/garage/missions/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setMission(data.mission)
    } catch (e: any) { setError(e?.message || 'Erreur') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (id) load() }, [id])

  async function submitCancel() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/garage/missions/${id}/cancel`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason: cancelReason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setCancelOpen(false)
      setCancelReason('')
      await load()
      if (data.notice) alert(data.notice)
    } catch (e: any) {
      setError(e?.message || 'Erreur')
    } finally { setBusy(false) }
  }

  if (loading)  return <p className="text-gray-400 text-sm">Chargement…</p>
  if (!mission) return <p className="text-red-600 text-sm">{error || 'Mission introuvable'}</p>

  const cfg     = STATUS_LABEL[mission.status] || { label: mission.status, color: 'bg-gray-100 border-gray-300 text-gray-700' }
  const canCancel = !['completed', 'to_invoice', 'cancelled'].includes(mission.status)
  const photos  = mission.photos_visible_to_garage && Array.isArray(mission.driver_photos) ? mission.driver_photos : []

  return (
    <div className="space-y-5">
      <div>
        <Link href="/garage" className="text-sm text-gray-500 hover:text-gray-700">← Retour</Link>
        <h1 className="text-xl font-bold text-gray-900 mt-1">Mission #{mission.mission_number || '—'}</h1>
      </div>

      <div className={`border-2 rounded-2xl p-5 ${cfg.color}`}>
        <p className="font-bold text-base">{cfg.label}</p>
        {cfg.sub && <p className="text-sm mt-1 opacity-80">{cfg.sub}</p>}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3 text-sm">
        <div>
          <p className="text-gray-500 text-xs uppercase font-semibold mb-1">Véhicule</p>
          <p className="text-gray-900 font-semibold">
            {mission.vehicle_plate && <span className="font-mono">{mission.vehicle_plate}</span>}
            {(mission.vehicle_brand || mission.vehicle_model) && <span className="ml-2 text-gray-600">{[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')}</span>}
          </p>
        </div>
        {mission.incident_address && (
          <div>
            <p className="text-gray-500 text-xs uppercase font-semibold mb-1">Adresse intervention</p>
            <p className="text-gray-900">{mission.incident_address}</p>
          </div>
        )}
        {mission.client_phone && (
          <div>
            <p className="text-gray-500 text-xs uppercase font-semibold mb-1">Téléphone contact</p>
            <p className="text-gray-900">{mission.client_phone}</p>
          </div>
        )}
        {mission.remarks_general && (
          <div>
            <p className="text-gray-500 text-xs uppercase font-semibold mb-1">Notes</p>
            <p className="text-gray-900 whitespace-pre-line">{mission.remarks_general}</p>
          </div>
        )}
        <div>
          <p className="text-gray-500 text-xs uppercase font-semibold mb-1">Type</p>
          <p className="text-gray-900">{mission.mission_type === 'depannage' ? '🔧 Dépannage sur place (DSP)' : mission.mission_type === 'remorquage' ? '🚛 Remorquage (REM)' : mission.mission_type}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <p className="text-gray-500 text-xs uppercase font-semibold mb-3">Avancement</p>
        <div className="space-y-1.5 text-sm">
          {[
            { label: 'Demande reçue',          ts: mission.received_at  },
            { label: 'Acceptée par dispatch',  ts: mission.accepted_at || mission.assigned_at },
            { label: 'Chauffeur en route',     ts: mission.on_way_at    },
            { label: 'Sur place',              ts: mission.on_site_at   },
            { label: 'Mission terminée',       ts: mission.completed_at },
          ].map((step, i) => (
            <div key={i} className={`flex items-center gap-2 ${step.ts ? 'text-gray-900' : 'text-gray-300'}`}>
              <span className={`w-2 h-2 rounded-full ${step.ts ? 'bg-red-500' : 'bg-gray-300'}`} />
              <span className="font-medium">{step.label}</span>
              <span className="text-gray-400 ml-auto text-xs">{step.ts ? fmtDateTime(step.ts) : '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {photos.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <p className="text-gray-500 text-xs uppercase font-semibold mb-3">Photos ({photos.length})</p>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Photo ${i + 1}`} className="w-full aspect-square object-cover rounded-lg border border-gray-200" />
              </a>
            ))}
          </div>
        </div>
      )}

      {canCancel && !cancelOpen && (
        <button onClick={() => setCancelOpen(true)}
          className="w-full py-2.5 bg-white border border-red-300 text-red-700 hover:bg-red-50 rounded-xl text-sm font-medium">
          ✕ Demander l&apos;annulation
        </button>
      )}

      {cancelOpen && (
        <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-5 space-y-3">
          <p className="text-red-900 font-semibold text-sm">Demander l&apos;annulation</p>
          <p className="text-red-800 text-xs">
            Si la mission n&apos;a pas encore été acceptée par notre dispatch, elle sera annulée immédiatement. Sinon, une demande sera envoyée à notre équipe qui décidera d&apos;annuler totalement ou de facturer un déplacement.
          </p>
          <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)}
            placeholder="Motif (optionnel mais conseillé)"
            rows={2}
            className="w-full bg-white border border-red-300 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-red-500" />
          <div className="flex gap-2">
            <button onClick={() => { setCancelOpen(false); setCancelReason('') }} disabled={busy}
              className="flex-1 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm">Retour</button>
            <button onClick={submitCancel} disabled={busy}
              className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
              {busy ? '⏳ Envoi…' : 'Confirmer la demande d\'annulation'}
            </button>
          </div>
          {error && <p className="text-red-700 text-xs">⚠ {error}</p>}
        </div>
      )}
    </div>
  )
}
