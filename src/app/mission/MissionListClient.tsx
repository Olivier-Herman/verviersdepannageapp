'use client'
// src/app/mission/MissionListClient.tsx
// Liste des missions du chauffeur avec bouton "+" flottant

import Link         from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Shield, Wallet, X } from 'lucide-react'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mission {
  id: string
  external_id: string
  dossier_number: string | null
  source: string
  mission_type: string | null
  status: string
  client_name: string | null
  client_phone: string | null
  vehicle_plate: string | null
  vehicle_brand: string | null
  vehicle_model: string | null
  incident_address: string | null
  incident_city: string | null
  received_at: string
  accepted_at: string | null
  on_way_at: string | null
  on_site_at: string | null
  completed_at: string | null
  assigned_at: string | null
}

// ── Constantes ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; dot: string; row: string }> = {
  assigned:    { label: 'À accepter', dot: 'bg-blue-400',   row: 'border-l-blue-500'   },
  accepted:    { label: 'Acceptée',   dot: 'bg-indigo-400', row: 'border-l-indigo-500' },
  in_progress: { label: 'En cours',   dot: 'bg-orange-400', row: 'border-l-orange-500' },
  parked:      { label: 'En dépôt',   dot: 'bg-yellow-400', row: 'border-l-yellow-500' },
  completed:   { label: 'Terminée',   dot: 'bg-green-400',  row: 'border-l-green-500'  },
}

const TYPE_SHORT: Record<string, string> = {
  remorquage: 'REM', depannage: 'DSP', transport: 'Transport',
  DSP: 'DSP', REM: 'REM', Transport: 'Transport', DPR: 'DPR', VR: 'VR',
}

const SOURCE_LABELS: Record<string, string> = {
  touring: 'TOURING', ethias: 'ETHIAS', vivium: 'VIVIUM',
  axa: 'IPA', ardenne: 'ARDENNE', mondial: 'MONDIAL',
  vab: 'VAB', police: 'POLICE', prive: 'PRIVÉ', garage: 'GARAGE',
}

function fmt(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function MissionListClient({
  missions: initialMissions,
  navApp,
  currentUserId,
}: {
  missions: Mission[]
  navApp: string
  currentUserId?: string
}) {
  const router = useRouter()
  const [missions, setMissions] = useState<Mission[]>(initialMissions)
  const [showChoice, setShowChoice] = useState(false)

  // Force refresh à l'ouverture — données toujours fraîches
  useEffect(() => {
    router.refresh()
  }, [])

  // Realtime — écoute les nouvelles missions assignées
  useEffect(() => {
    if (!currentUserId) return
    const ch = sb.channel('mission-list')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'incoming_missions',
        filter: `assigned_to=eq.${currentUserId}`,
      }, () => {
        window.location.reload()
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [currentUserId])

  // Filtrage des completed cote serveur deja, ici on a uniquement les actives
  const active = missions

  return (
    <div className="relative pb-24">
      <div className="px-4 py-4 space-y-2">

        {active.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-ink-muted">
            <p className="text-5xl mb-4">🚗</p>
            <p className="text-lg font-semibold text-ink mb-1">Aucune mission</p>
            <p className="text-sm mb-6">Vous n&apos;avez pas de mission assignée</p>
            <button type="button" onClick={() => setShowChoice(true)}
              className="flex items-center gap-2 px-5 py-3 bg-brand text-white rounded-2xl font-semibold">
              + Nouvelle intervention
            </button>
          </div>
        )}

        {active.length > 0 && (
          <>
            <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide px-1 mb-3">
              En cours · {active.length}
            </p>
            {active.map(m => <MissionRow key={m.id} mission={m} router={router} />)}
          </>
        )}
      </div>

      {/* ── FAB Nouvelle intervention ────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setShowChoice(true)}
        className="fixed bottom-6 right-5 w-16 h-16 bg-brand rounded-full shadow-2xl flex items-center justify-center text-ink text-3xl font-bold transition active:scale-95 z-20"
        title="Nouvelle intervention">
        +
      </button>

      {/* ── Modal choix type d'intervention ────────────────────────────── */}
      {showChoice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowChoice(false)}>
          <div onClick={e => e.stopPropagation()}
            className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-ink font-bold text-lg">Quel type d&apos;intervention ?</h3>
              <button type="button" onClick={() => setShowChoice(false)}
                className="text-ink-muted hover:text-ink p-1">
                <X size={20} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => router.push('/mission/new')}
              className="w-full flex items-start gap-3 p-4 bg-surface-2 hover:bg-surface-hover border rounded-2xl text-left transition active:scale-[0.98]">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
                <Shield size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-ink font-semibold">Appel Police</p>
                <p className="text-ink-muted text-xs mt-0.5">Accident · Saisie · Mal garée · SNC · AVP</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => router.push('/encaissement')}
              className="w-full flex items-start gap-3 p-4 bg-surface-2 hover:bg-surface-hover border rounded-2xl text-left transition active:scale-[0.98]">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-success/10 text-success flex items-center justify-center">
                <Wallet size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-ink font-semibold">Intervention avec encaissement</p>
                <p className="text-ink-muted text-xs mt-0.5">Mission privée à encaisser directement par le chauffeur</p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Mission Row ───────────────────────────────────────────────────────────────

function MissionRow({ mission, router }: { mission: Mission; router: ReturnType<typeof useRouter> }) {
  const cfg = STATUS_CONFIG[mission.status] || STATUS_CONFIG.assigned

  return (
    <div
      onClick={() => router.push(`/mission/${mission.id}`)}
      className={`bg-surface border border border-l-4 rounded-2xl p-4 cursor-pointer hover:bg-surface-2 transition active:scale-[0.99] ${cfg.row}`}
    >
      <div className="flex items-start justify-between gap-3">

        {/* Infos principales */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
            <span className="text-ink-secondary text-xs font-medium">{cfg.label}</span>
            {mission.mission_type && (
              <span className="bg-surface-hover text-ink-secondary text-xs px-1.5 py-0.5 rounded font-medium">
                {TYPE_SHORT[mission.mission_type] || mission.mission_type}
              </span>
            )}
            <span className="text-ink-faint text-xs">{SOURCE_LABELS[mission.source] || mission.source}</span>
          </div>

          <p className="text-ink font-bold text-base leading-tight truncate">
            {mission.client_name || 'Client inconnu'}
          </p>

          {(mission.vehicle_plate || mission.vehicle_brand) && (
            <p className="text-ink-secondary text-sm mt-0.5">
              {mission.vehicle_plate && (
                <span className="font-mono font-bold text-ink-secondary">{mission.vehicle_plate} · </span>
              )}
              {[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')}
            </p>
          )}

          {(mission.incident_address || mission.incident_city) && (
            <p className="text-ink-muted text-xs mt-1 truncate">
              📍 {mission.incident_address}{mission.incident_city ? `, ${mission.incident_city}` : ''}
            </p>
          )}
        </div>

        {/* Heure + flèche */}
        <div className="text-right flex-shrink-0">
          <p className="text-ink-muted text-xs">{fmt(mission.received_at)}</p>
          <p className="text-ink-faint text-xl mt-2">›</p>
        </div>
      </div>

      {/* Timeline compacte pour missions actives */}
      {mission.status !== 'completed' && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border overflow-x-auto">
          {[
            { label: 'Acceptée',  ts: mission.accepted_at,  dot: 'bg-indigo-400' },
            { label: 'En route',  ts: mission.on_way_at,    dot: 'bg-amber-400'  },
            { label: 'Sur place', ts: mission.on_site_at,   dot: 'bg-orange-400' },
          ].map(step => (
            <div key={step.label} className={`flex items-center gap-1.5 flex-shrink-0 ${step.ts ? 'opacity-100' : 'opacity-30'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${step.ts ? step.dot : 'bg-ink-faint'}`} />
              <span className="text-xs text-ink-muted">{step.label}</span>
              {step.ts && <span className="text-xs text-ink-secondary">{fmt(step.ts)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
