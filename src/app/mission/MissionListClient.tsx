'use client'
// src/app/mission/MissionListClient.tsx
// Liste des missions du chauffeur avec bouton "+" flottant

import Link         from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

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

  // Realtime — écoute les nouvelles missions assignées
  useEffect(() => {
    if (!currentUserId) return
    const ch = sb.channel('mission-list')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'incoming_missions',
        filter: `assigned_to=eq.${currentUserId}`,
      }, () => {
        // Rafraîchir la liste via hard reload léger
        window.location.reload()
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [currentUserId])

  // Sépare actives et terminées
  const active    = missions.filter(m => m.status !== 'completed')
  const completed = missions.filter(m => m.status === 'completed')

  return (
    <div className="relative pb-24">
      <div className="px-4 py-4 space-y-2">

        {/* ── Missions actives ─────────────────────────────────────────── */}
        {active.length === 0 && completed.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
            <p className="text-5xl mb-4">🚗</p>
            <p className="text-lg font-semibold text-white mb-1">Aucune mission</p>
            <p className="text-sm mb-6">Vous n&apos;avez pas de mission assignée</p>
            <Link href="/mission/new"
              className="flex items-center gap-2 px-5 py-3 bg-brand text-white rounded-2xl font-semibold">
              + Nouvelle intervention
            </Link>
          </div>
        )}

        {active.length > 0 && (
          <>
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wide px-1 mb-3">
              En cours · {active.length}
            </p>
            {active.map(m => <MissionRow key={m.id} mission={m} router={router} />)}
          </>
        )}

        {/* ── Missions terminées (repliables) ──────────────────────────── */}
        {completed.length > 0 && (
          <>
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wide px-1 mt-6 mb-3">
              Terminées récentes · {completed.length}
            </p>
            {completed.map(m => <MissionRow key={m.id} mission={m} router={router} />)}
          </>
        )}
      </div>

      {/* ── FAB Nouvelle intervention ────────────────────────────────────── */}
      <Link
        href="/mission/new"
        className="fixed bottom-6 right-5 w-16 h-16 bg-brand rounded-full shadow-2xl flex items-center justify-center text-white text-3xl font-bold transition active:scale-95 z-20"
        title="Nouvelle intervention">
        +
      </Link>
    </div>
  )
}

// ── Mission Row ───────────────────────────────────────────────────────────────

function MissionRow({ mission, router }: { mission: Mission; router: ReturnType<typeof useRouter> }) {
  const cfg = STATUS_CONFIG[mission.status] || STATUS_CONFIG.assigned

  return (
    <div
      onClick={() => router.push(`/mission/${mission.id}`)}
      className={`bg-[#1A1A1A] border border-[#2a2a2a] border-l-4 rounded-2xl p-4 cursor-pointer hover:bg-[#222] transition active:scale-[0.99] ${cfg.row}`}
    >
      <div className="flex items-start justify-between gap-3">

        {/* Infos principales */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
            <span className="text-zinc-400 text-xs font-medium">{cfg.label}</span>
            {mission.mission_type && (
              <span className="bg-[#2a2a2a] text-zinc-300 text-xs px-1.5 py-0.5 rounded font-medium">
                {TYPE_SHORT[mission.mission_type] || mission.mission_type}
              </span>
            )}
            <span className="text-zinc-600 text-xs">{SOURCE_LABELS[mission.source] || mission.source}</span>
          </div>

          <p className="text-white font-bold text-base leading-tight truncate">
            {mission.client_name || 'Client inconnu'}
          </p>

          {(mission.vehicle_plate || mission.vehicle_brand) && (
            <p className="text-zinc-400 text-sm mt-0.5">
              {mission.vehicle_plate && (
                <span className="font-mono font-bold text-zinc-300">{mission.vehicle_plate} · </span>
              )}
              {[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')}
            </p>
          )}

          {(mission.incident_address || mission.incident_city) && (
            <p className="text-zinc-500 text-xs mt-1 truncate">
              📍 {mission.incident_address}{mission.incident_city ? `, ${mission.incident_city}` : ''}
            </p>
          )}
        </div>

        {/* Heure + flèche */}
        <div className="text-right flex-shrink-0">
          <p className="text-zinc-500 text-xs">{fmt(mission.received_at)}</p>
          <p className="text-zinc-700 text-xl mt-2">›</p>
        </div>
      </div>

      {/* Timeline compacte pour missions actives */}
      {mission.status !== 'completed' && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#2a2a2a] overflow-x-auto">
          {[
            { label: 'Acceptée',  ts: mission.accepted_at,  dot: 'bg-indigo-400' },
            { label: 'En route',  ts: mission.on_way_at,    dot: 'bg-amber-400'  },
            { label: 'Sur place', ts: mission.on_site_at,   dot: 'bg-orange-400' },
          ].map(step => (
            <div key={step.label} className={`flex items-center gap-1.5 flex-shrink-0 ${step.ts ? 'opacity-100' : 'opacity-30'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${step.ts ? step.dot : 'bg-zinc-600'}`} />
              <span className="text-xs text-zinc-500">{step.label}</span>
              {step.ts && <span className="text-xs text-zinc-400">{fmt(step.ts)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
