'use client'
// src/app/parc/plan/ParcPlanClient.tsx
//
// Plan visuel du parc fourriere avec drag&drop entre slots.
// - Sidebar "À placer" : vehicules sans coordonnees
// - Grille par zone : N lignes auto-incrementees, chaque ligne = N slots
// - Overflow : si vehicules > capacite, des slots supplementaires
//   apparaissent avec un bord rouge + badge "+N"
// - Drop sur sidebar = retire du parc (parc_zone_key = null)

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable, DragOverlay, type DragEndEvent,
} from '@dnd-kit/core'
import { RefreshCw, Car, AlertTriangle, X } from 'lucide-react'

interface Zone {
  key:        string
  label:      string
  sort_order: number
}

interface Row {
  id:         number
  zone_key:   string
  row_number: number
  capacity:   number
}

interface PlacedMission {
  id:                  string
  external_id:         string
  vehicle_plate:       string | null
  vehicle_brand:       string | null
  vehicle_model:       string | null
  client_name:         string | null
  status:              string
  mission_type:        string | null
  parc_zone_key:       string | null
  parc_row_number:     number | null
  parc_slot_index:     number | null
}

interface State {
  zones:   Zone[]
  rows:    Row[]
  placed:  PlacedMission[]
  toPlace: PlacedMission[]
}

const UNPLACED_DROP_ID = 'unplaced'

export default function ParcPlanClient({ isDispatcher, isDriver }: {
  isDispatcher: boolean
  isDriver:     boolean
}) {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeMission, setActiveMission] = useState<PlacedMission | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
  )

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/parc/state')
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setState(j)
    } catch (e: any) {
      setError(e.message || 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const rowsByZone = useMemo<Record<string, Row[]>>(() => {
    if (!state) return {}
    const out: Record<string, Row[]> = {}
    for (const r of state.rows) {
      (out[r.zone_key] ||= []).push(r)
    }
    for (const z of Object.keys(out)) out[z].sort((a, b) => a.row_number - b.row_number)
    return out
  }, [state])

  /** Liste des missions sur une ligne donnee, triees par slot_index */
  function missionsOnRow(zoneKey: string, rowNumber: number): PlacedMission[] {
    if (!state) return []
    return state.placed
      .filter(m => m.parc_zone_key === zoneKey && m.parc_row_number === rowNumber)
      .sort((a, b) => (a.parc_slot_index || 0) - (b.parc_slot_index || 0))
  }

  async function handleDragEnd(ev: DragEndEvent) {
    setActiveMission(null)
    const { active, over } = ev
    if (!over) return
    const missionId = String(active.id)
    const overId    = String(over.id)

    if (overId === UNPLACED_DROP_ID) {
      // Retirer du parc
      await placeMission(missionId, null, null, null)
      return
    }

    // Format attendu : "slot-<zoneKey>-<rowNumber>-<slotIndex>"
    const match = overId.match(/^slot-(.+)-(\d+)-(\d+)$/)
    if (!match) return
    const [, zoneKey, rowNumStr, slotIdxStr] = match
    const rowNumber = parseInt(rowNumStr, 10)
    const slotIndex = parseInt(slotIdxStr, 10)
    await placeMission(missionId, zoneKey, rowNumber, slotIndex)
  }

  async function placeMission(
    missionId: string,
    zoneKey:   string | null,
    rowNumber: number | null,
    slotIndex: number | null,
  ) {
    try {
      const res = await fetch('/api/parc/place', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: missionId, zone_key: zoneKey, row_number: rowNumber, slot_index: slotIndex }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      await load() // refresh apres deplacement (couvre les swaps)
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
    }
  }

  if (loading && !state) return <div className="p-8 text-ink-muted text-center"><RefreshCw className="inline animate-spin mr-2" size={16} /> Chargement…</div>
  if (error && !state)   return <div className="p-8 text-critical">⚠ {error}</div>
  if (!state)            return null

  const allMissions: Record<string, PlacedMission> = {}
  for (const m of [...state.placed, ...state.toPlace]) allMissions[m.id] = m

  return (
    <DndContext
      sensors={sensors}
      onDragStart={ev => setActiveMission(allMissions[String(ev.active.id)] || null)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveMission(null)}
    >
      <div className="flex flex-col lg:flex-row gap-4 p-4 max-w-[1600px] mx-auto">
        {/* Sidebar : a placer */}
        <UnplacedSidebar missions={state.toPlace} />

        {/* Grille des zones */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-ink font-bold text-xl">Plan du parc</h1>
              <p className="text-ink-muted text-xs mt-0.5">
                Glisse les véhicules entre les slots. {isDriver && !isDispatcher && '— Tu peux placer uniquement dans A et Transit.'}
              </p>
            </div>
            <button onClick={load} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 bg-surface-2 border rounded-lg text-ink-secondary hover:text-ink text-xs transition disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Rafraîchir
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {state.zones.map(zone => {
              const zRows = rowsByZone[zone.key] || []
              const canDriverDrop = !isDriver || isDispatcher || ['A', 'Transit'].includes(zone.key)
              return (
                <div key={zone.key} className={`bg-surface-2 border rounded-2xl overflow-hidden ${canDriverDrop ? '' : 'opacity-50'}`}>
                  <div className="px-4 py-2.5 border-b bg-surface flex items-center justify-between">
                    <h2 className="text-ink font-bold">Zone {zone.label}</h2>
                    {!canDriverDrop && (
                      <span className="text-ink-faint text-[10px]">non autorisée</span>
                    )}
                  </div>
                  <div className="p-3 space-y-2">
                    {zRows.length === 0 ? (
                      <p className="text-ink-faint text-xs italic text-center py-3">
                        Aucune ligne configurée (admin → parc)
                      </p>
                    ) : zRows.map(row => (
                      <RowSlots
                        key={row.id}
                        row={row}
                        missions={missionsOnRow(zone.key, row.row_number)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeMission && <VehicleCard mission={activeMission} dragging />}
      </DragOverlay>
    </DndContext>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar "À placer"
// ─────────────────────────────────────────────────────────────────────────────
function UnplacedSidebar({ missions }: { missions: PlacedMission[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: UNPLACED_DROP_ID })

  return (
    <div
      ref={setNodeRef}
      className={`lg:w-72 bg-surface-2 border rounded-2xl p-3 lg:sticky lg:top-4 lg:max-h-[85vh] overflow-y-auto transition-colors ${
        isOver ? 'border-brand bg-brand/5' : ''
      }`}
    >
      <h2 className="text-ink font-semibold text-sm mb-3 flex items-center gap-2">
        <Car size={16} /> À placer ({missions.length})
      </h2>
      {missions.length === 0 ? (
        <p className="text-ink-faint text-xs italic text-center py-6">
          Aucun véhicule en attente
        </p>
      ) : (
        <div className="space-y-2">
          {missions.map(m => <VehicleCard key={m.id} mission={m} />)}
        </div>
      )}
      <p className="text-ink-faint text-[10px] mt-3 italic">
        Dépose un véhicule ici pour le retirer du parc.
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Ligne avec ses slots (+ overflow si vehicules > capacite)
// ─────────────────────────────────────────────────────────────────────────────
function RowSlots({ row, missions }: { row: Row; missions: PlacedMission[] }) {
  const overflow = missions.length > row.capacity
  // Nombre total de slots à afficher : capacité + 1 vide (pour pouvoir drop)
  // OU si déjà en overflow, on affiche autant que de missions + 1 supplémentaire.
  const slotCount = Math.max(row.capacity, missions.length) + 1

  // Place chaque mission sur son slot_index (1-based)
  const slots: Array<PlacedMission | null> = Array.from({ length: slotCount }, () => null)
  for (const m of missions) {
    const idx = (m.parc_slot_index || 1) - 1
    if (idx >= 0 && idx < slotCount) slots[idx] = m
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`flex-shrink-0 w-10 text-center font-mono font-bold text-xs px-1.5 py-1 rounded ${
        overflow ? 'bg-critical/15 text-critical' : 'bg-brand/15 text-brand'
      }`}>
        {row.zone_key}{row.row_number}
      </span>
      <div className="flex-1 flex gap-1 flex-wrap">
        {slots.map((mission, i) => (
          <Slot
            key={i}
            zoneKey={row.zone_key}
            rowNumber={row.row_number}
            slotIndex={i + 1}
            isOverflow={i >= row.capacity}
            mission={mission}
          />
        ))}
      </div>
      {overflow && (
        <span className="flex-shrink-0 text-critical text-[10px] font-bold whitespace-nowrap" title="Capacité dépassée">
          <AlertTriangle size={12} className="inline" /> +{missions.length - row.capacity}
        </span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Un slot droppable (avec ou sans vehicule)
// ─────────────────────────────────────────────────────────────────────────────
function Slot({ zoneKey, rowNumber, slotIndex, isOverflow, mission }: {
  zoneKey:    string
  rowNumber:  number
  slotIndex:  number
  isOverflow: boolean
  mission:    PlacedMission | null
}) {
  const id = `slot-${zoneKey}-${rowNumber}-${slotIndex}`
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={`w-[78px] h-[46px] rounded border flex items-center justify-center text-[10px] transition-colors ${
        mission
          ? isOverflow
            ? 'border-critical bg-critical/10'
            : 'border-zinc-700 bg-surface'
          : isOver
            ? 'border-brand bg-brand/10 border-2'
            : isOverflow
              ? 'border-dashed border-critical/40 bg-critical/5'
              : 'border-dashed border-zinc-700/60 bg-surface/40'
      }`}
      title={isOverflow ? `Slot overflow ${zoneKey}${rowNumber}-${slotIndex}` : `${zoneKey}${rowNumber}-${slotIndex}`}
    >
      {mission ? <VehicleCard mission={mission} compact /> : <span className="text-ink-faint">{slotIndex}</span>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Carte vehicule draggable
// ─────────────────────────────────────────────────────────────────────────────
function VehicleCard({ mission, compact, dragging }: {
  mission: PlacedMission
  compact?: boolean
  dragging?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: mission.id })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`cursor-grab active:cursor-grabbing select-none rounded ${
        compact
          ? `w-full h-full flex flex-col items-center justify-center text-[9px] leading-tight px-1 ${isDragging ? 'opacity-30' : ''}`
          : `bg-surface border px-2.5 py-2 hover:border-brand text-xs ${dragging ? 'shadow-2xl border-brand bg-brand/5' : ''} ${isDragging ? 'opacity-30' : ''}`
      }`}
    >
      {compact ? (
        <>
          <span className="font-mono font-bold text-ink truncate w-full text-center">{mission.vehicle_plate || '—'}</span>
          <span className="text-ink-faint truncate w-full text-center">{mission.vehicle_brand || ''}</span>
        </>
      ) : (
        <>
          <div className="font-mono font-bold text-ink">{mission.vehicle_plate || '—'}</div>
          <div className="text-ink-muted text-[11px] truncate">
            {[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ') || mission.client_name || '?'}
          </div>
        </>
      )}
    </div>
  )
}
