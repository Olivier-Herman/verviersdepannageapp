'use client'
// src/app/mission/[id]/DriverClient.tsx

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

type MissionStatus = 'new' | 'dispatching' | 'assigned' | 'accepted' | 'in_progress' | 'completed'

interface Mission {
  id: string
  status: MissionStatus
  external_id?: string
  dossier_number?: string
  source?: string
  mission_type?: string
  client_name?: string
  client_phone?: string
  vehicle_brand?: string
  vehicle_model?: string
  vehicle_plate?: string
  incident_address?: string
  incident_city?: string
  incident_lat?: number
  incident_lng?: number
  destination_address?: string
  destination_name?: string
  remarks_general?: string
  accepted_at?: string
  on_way_at?: string
  on_site_at?: string
  completed_at?: string
  assigned_at?: string
  amount_guaranteed?: number
  amount_currency?: string
}

interface Props {
  mission: Mission
  currentUserId: string
  isReadOnly?: boolean
}

interface ClosingData {
  payment_method: string
  amount: string
  notes: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}

const TIMELINE_STEPS = [
  { label: 'Mission reçue', field: 'assigned_at'  as keyof Mission, icon: '📋' },
  { label: 'Acceptée',      field: 'accepted_at'  as keyof Mission, icon: '✅' },
  { label: 'En route',      field: 'on_way_at'    as keyof Mission, icon: '🚗' },
  { label: 'Sur place',     field: 'on_site_at'   as keyof Mission, icon: '📍' },
  { label: 'Terminée',      field: 'completed_at' as keyof Mission, icon: '🏁' },
]

function buildTimeline(mission: Mission) {
  const currentIdx = TIMELINE_STEPS.findIndex((s, i) => i > 0 && !mission[s.field])
  return TIMELINE_STEPS.map((s, i) => ({
    ...s,
    timestamp: mission[s.field] as string | undefined,
    status: (mission[s.field] ? 'done' : i === currentIdx ? 'current' : 'pending') as 'done' | 'current' | 'pending',
  }))
}

function mapsUrl(lat?: number, lng?: number, addr?: string) {
  if (lat && lng) return `https://www.google.com/maps?q=${lat},${lng}`
  if (addr)       return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`
  return undefined
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MissionStatus }) {
  const map: Record<MissionStatus, { label: string; className: string }> = {
    new:         { label: 'Nouveau',     className: 'bg-gray-100 text-gray-600' },
    dispatching: { label: 'Dispatching', className: 'bg-yellow-100 text-yellow-700' },
    assigned:    { label: 'Assignée',    className: 'bg-blue-100 text-blue-700' },
    accepted:    { label: 'Acceptée',    className: 'bg-indigo-100 text-indigo-700' },
    in_progress: { label: 'En cours',    className: 'bg-orange-100 text-orange-700' },
    completed:   { label: 'Terminée',    className: 'bg-green-100 text-green-700' },
  }
  const { label, className } = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' }
  return <span className={`text-xs font-semibold px-2 py-1 rounded-full ${className}`}>{label}</span>
}

function InfoCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{icon} {title}</p>
      {children}
    </div>
  )
}

function ClosingForm({ onSubmit, loading }: { onSubmit: (d: ClosingData) => void; loading: boolean }) {
  const [data, setData] = useState<ClosingData>({ payment_method: 'cash', amount: '', notes: '' })
  const set = (k: keyof ClosingData, v: string) => setData(d => ({ ...d, [k]: v }))

  return (
    <div className="bg-white rounded-2xl shadow p-4 space-y-3">
      <h3 className="font-bold text-gray-800">Clôture de mission</h3>

      <div>
        <label className="text-sm text-gray-500 block mb-1">Mode de paiement</label>
        <select
          className="w-full border rounded-xl px-3 py-2 text-sm"
          value={data.payment_method}
          onChange={e => set('payment_method', e.target.value)}
        >
          <option value="cash">Espèces</option>
          <option value="card">Carte bancaire</option>
          <option value="invoice">Facturation directe</option>
          <option value="assurance">Assurance (pas d&apos;encaissement)</option>
        </select>
      </div>

      {data.payment_method !== 'assurance' && (
        <div>
          <label className="text-sm text-gray-500 block mb-1">Montant encaissé (€)</label>
          <input
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            className="w-full border rounded-xl px-3 py-2 text-sm"
            value={data.amount}
            onChange={e => set('amount', e.target.value)}
          />
        </div>
      )}

      <div>
        <label className="text-sm text-gray-500 block mb-1">Notes (optionnel)</label>
        <textarea
          rows={2}
          placeholder="Remarques, difficultés..."
          className="w-full border rounded-xl px-3 py-2 text-sm resize-none"
          value={data.notes}
          onChange={e => set('notes', e.target.value)}
        />
      </div>

      <button
        onClick={() => onSubmit(data)}
        disabled={loading}
        className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm"
      >
        {loading ? 'Envoi...' : '✅ Confirmer la clôture'}
      </button>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DriverClient({ mission: initial, isReadOnly = false }: Props) {
  const router = useRouter()
  const [mission, setMission] = useState<Mission>(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [showClosing, setShowClosing] = useState(false)

  const timeline = buildTimeline(mission)

  async function doAction(action: string, closingData?: ClosingData) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/missions/driver-action', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_id:   mission.id,
          action,
          closing_data: closingData ? {
            payment_method: closingData.payment_method,
            amount:         closingData.amount ? parseFloat(closingData.amount) : undefined,
            notes:          closingData.notes || undefined,
          } : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erreur serveur')
      setMission(json.mission)
      if (action === 'completed') { setShowClosing(false); router.refresh() }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  // CTA selon statut
  type CTA = { label: string; action: string; color: string; emoji: string } | null
  const cta: CTA = isReadOnly ? null : (() => {
    switch (mission.status) {
      case 'assigned':
        return { label: 'Accepter la mission', action: 'accept',     color: 'bg-blue-600',   emoji: '✅' }
      case 'accepted':
        return { label: 'Je suis en route',    action: 'on_way',     color: 'bg-amber-500',  emoji: '🚗' }
      case 'in_progress':
        if (!mission.on_site_at)
          return { label: 'Je suis sur place', action: 'on_site',    color: 'bg-orange-500', emoji: '📍' }
        if (!showClosing)
          return { label: 'Terminer la mission', action: '__closing', color: 'bg-green-600',  emoji: '🏁' }
        return null
      default: return null
    }
  })()

  const pickupUrl = mapsUrl(mission.incident_lat, mission.incident_lng, mission.incident_address)

  return (
    <div className="min-h-screen bg-gray-50 pb-8">

      {/* Header */}
      <div className="bg-white shadow-sm px-4 pt-6 pb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-mono text-gray-400 uppercase">
            {mission.dossier_number ?? mission.external_id ?? mission.id.slice(0, 8)}
            {mission.source && <span className="ml-2 text-gray-300">· {mission.source}</span>}
          </span>
          <StatusBadge status={mission.status} />
        </div>
        <h1 className="text-lg font-bold text-gray-900">{mission.client_name ?? 'Client inconnu'}</h1>
        {mission.client_phone && (
          <a href={`tel:${mission.client_phone}`} className="text-blue-600 text-sm font-medium">
            📞 {mission.client_phone}
          </a>
        )}
      </div>

      <div className="px-4 mt-4 space-y-4">

        {/* Vehicle */}
        {(mission.vehicle_brand || mission.vehicle_plate) && (
          <InfoCard title="Véhicule" icon="🚘">
            <p className="text-sm font-semibold text-gray-800">
              {[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')}
            </p>
            {mission.vehicle_plate && (
              <p className="text-xs text-gray-500 font-mono uppercase tracking-widest mt-0.5">
                {mission.vehicle_plate}
              </p>
            )}
          </InfoCard>
        )}

        {/* Addresses */}
        <InfoCard title="Localisation" icon="📍">
          {mission.incident_address && (
            <div className="mb-2">
              <p className="text-xs text-gray-400">Lieu d&apos;intervention</p>
              <p className="text-sm text-gray-800">{mission.incident_address}{mission.incident_city ? `, ${mission.incident_city}` : ''}</p>
              {pickupUrl && (
                <a href={pickupUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 font-medium">
                  Ouvrir dans Maps →
                </a>
              )}
            </div>
          )}
          {mission.destination_address && (
            <div>
              <p className="text-xs text-gray-400">Destination</p>
              <p className="text-sm text-gray-800">
                {mission.destination_name ? `${mission.destination_name} — ` : ''}{mission.destination_address}
              </p>
              <a
                href={mapsUrl(undefined, undefined, mission.destination_address)}
                target="_blank" rel="noreferrer"
                className="text-xs text-blue-600 font-medium"
              >
                Ouvrir dans Maps →
              </a>
            </div>
          )}
        </InfoCard>

        {/* Montant garanti */}
        {mission.amount_guaranteed != null && (
          <InfoCard title="Montant garanti" icon="💶">
            <p className="text-lg font-bold text-gray-900">
              {mission.amount_guaranteed} {mission.amount_currency ?? '€'}
            </p>
          </InfoCard>
        )}

        {/* Remarques */}
        {mission.remarks_general && (
          <InfoCard title="Remarques" icon="📝">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{mission.remarks_general}</p>
          </InfoCard>
        )}

        {/* Timeline */}
        <InfoCard title="Progression" icon="🕐">
          <ol className="space-y-2">
            {timeline.map((step, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className={`w-7 h-7 flex items-center justify-center rounded-full text-sm flex-shrink-0 ${
                  step.status === 'done'    ? 'bg-green-100 text-green-700' :
                  step.status === 'current' ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-400' :
                  'bg-gray-100 text-gray-400'
                }`}>{step.icon}</span>
                <div className="flex-1">
                  <span className={`text-sm ${step.status === 'pending' ? 'text-gray-400' : 'text-gray-800 font-medium'}`}>
                    {step.label}
                  </span>
                  {step.timestamp && (
                    <span className="ml-2 text-xs text-gray-400">{formatTime(step.timestamp)}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </InfoCard>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            ⚠️ {error}
          </div>
        )}

        {/* Closing form */}
        {showClosing && (
          <ClosingForm onSubmit={data => doAction('completed', data)} loading={loading} />
        )}

        {/* CTA */}
        {cta && (
          <button
            onClick={() => cta.action === '__closing' ? setShowClosing(true) : doAction(cta.action)}
            disabled={loading}
            className={`w-full ${cta.color} hover:opacity-90 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-base shadow-lg`}
          >
            {loading ? '⏳ En cours...' : `${cta.emoji} ${cta.label}`}
          </button>
        )}
      </div>
    </div>
  )
}
