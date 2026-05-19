'use client'
// src/app/parc/plan/ParcPlanClient.tsx
//
// Plan visuel du parc fourriere avec drag&drop entre slots.
// - Sidebar "À placer" : vehicules sans coordonnees
// - Grille par zone : N lignes auto-incrementees, chaque ligne = N slots
// - Overflow : si vehicules > capacite, des slots supplementaires
//   apparaissent avec un bord rouge + badge "+N"
// - Drop sur sidebar = retire du parc (parc_zone_key = null)

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable, DragOverlay, type DragEndEvent,
} from '@dnd-kit/core'
import { RefreshCw, Car, AlertTriangle, Edit3, Check, Search, X } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { createClient } from '@supabase/supabase-js'

const sbClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

interface Zone {
  key:        string
  label:      string
  sort_order: number
  pos_x:      number
  pos_y:      number
  width:      number
  height:     number
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
  zones:           Zone[]
  rows:            Row[]
  placed:          PlacedMission[]
  toPlace:         PlacedMission[]
  canvasHeightPx:  number
}

const UNPLACED_DROP_ID = 'unplaced'

export default function ParcPlanClient({ isDispatcher, isDriver, canEditLayout, userRole, userName, userEmail, userModules }: {
  isDispatcher:   boolean
  isDriver:       boolean
  canEditLayout:  boolean
  userRole:       string
  userName:       string
  userEmail?:     string
  userModules:    string[]
}) {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeMission, setActiveMission] = useState<PlacedMission | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [search, setSearch] = useState('')
  const canvasRef = useRef<HTMLDivElement>(null)

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

  // Realtime : reload sur tout changement parc_* ou placement vehicule
  useEffect(() => {
    const channel = sbClient
      .channel('parc-plan-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incoming_missions' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parc_zones' },        () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parc_rows' },         () => load())
      .subscribe()
    return () => { sbClient.removeChannel(channel) }
  }, [load])

  // Set des mission_id qui matchent la recherche (plate / brand / model / client / external_id)
  const matchingIds = useMemo<Set<string>>(() => {
    const q = search.trim().toLowerCase()
    if (!q || !state) return new Set()
    const out = new Set<string>()
    for (const m of [...state.placed, ...state.toPlace]) {
      const hay = [m.vehicle_plate, m.vehicle_brand, m.vehicle_model, m.client_name, m.external_id]
        .filter(Boolean).join(' ').toLowerCase()
      if (hay.includes(q)) out.add(m.id)
    }
    return out
  }, [search, state])

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

  const shellProps = { title: 'Plan du parc', userRole, userName, userEmail, userModules }

  if (loading && !state) return <AppShell {...shellProps}><div className="p-8 text-ink-muted text-center"><RefreshCw className="inline animate-spin mr-2" size={16} /> Chargement…</div></AppShell>
  if (error && !state)   return <AppShell {...shellProps}><div className="p-8 text-critical">⚠ {error}</div></AppShell>
  if (!state)            return <AppShell {...shellProps}><div /></AppShell>

  const allMissions: Record<string, PlacedMission> = {}
  for (const m of [...state.placed, ...state.toPlace]) allMissions[m.id] = m

  return (
    <AppShell {...shellProps}>
    <DndContext
      sensors={sensors}
      onDragStart={ev => setActiveMission(allMissions[String(ev.active.id)] || null)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveMission(null)}
    >
      <div className="flex flex-col lg:flex-row gap-4 p-4 max-w-[1600px] mx-auto">
        {/* Sidebar : a placer */}
        <UnplacedSidebar missions={state.toPlace} matchingIds={matchingIds} />

        {/* Canvas des zones */}
        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-ink font-bold text-xl">Plan du parc</h1>
              <p className="text-ink-muted text-xs mt-0.5">
                {editMode
                  ? 'Glisse les zones pour les positionner, coin bas-droit pour redimensionner.'
                  : `Glisse les véhicules entre les slots. ${isDriver && !isDispatcher ? '— Tu peux placer uniquement dans A et Transit.' : ''}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!editMode && (
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Rechercher plaque, marque, client…"
                    className="pl-7 pr-7 py-2 bg-surface-2 border rounded-lg text-ink text-xs w-56 focus:outline-none focus:border-brand"
                  />
                  {search && (
                    <button onClick={() => setSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                      title="Effacer">
                      <X size={14} />
                    </button>
                  )}
                  {search && (
                    <span className="absolute -bottom-4 right-1 text-[10px] text-ink-muted">
                      {matchingIds.size} match{matchingIds.size > 1 ? 'es' : ''}
                    </span>
                  )}
                </div>
              )}
              {canEditLayout && (
                <button
                  onClick={() => setEditMode(m => !m)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                    editMode
                      ? 'bg-success hover:bg-success-soft text-white'
                      : 'bg-surface-2 border text-ink-secondary hover:text-ink'
                  }`}
                >
                  {editMode ? <><Check size={14} /> Terminer l&apos;édition</> : <><Edit3 size={14} /> Éditer le plan</>}
                </button>
              )}
              <button onClick={load} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 bg-surface-2 border rounded-lg text-ink-secondary hover:text-ink text-xs transition disabled:opacity-50">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Rafraîchir
              </button>
            </div>
          </div>

          {/* Canvas avec ratio fixe — zones positionnees en absolute % */}
          <div
            ref={canvasRef}
            className={`relative w-full bg-surface border rounded-2xl overflow-hidden ${editMode ? 'bg-grid-pattern' : ''}`}
            style={{ height: `${state.canvasHeightPx}px` }}
          >
            {state.zones.map(zone => {
              const zRows = rowsByZone[zone.key] || []
              const canDriverDrop = !isDriver || isDispatcher || ['A', 'Transit'].includes(zone.key)
              return (
                <ZoneOnCanvas
                  key={zone.key}
                  zone={zone}
                  rows={zRows}
                  missionsOnRow={missionsOnRow}
                  matchingIds={matchingIds}
                  canDriverDrop={canDriverDrop}
                  editMode={editMode}
                  canvasRef={canvasRef}
                  onLayoutCommit={async (coords) => {
                    // Optimistic update
                    setState(s => s ? { ...s, zones: s.zones.map(z => z.key === zone.key ? { ...z, ...coords } : z) } : s)
                    try {
                      const res = await fetch(`/api/admin/parc/zones/${encodeURIComponent(zone.key)}`, {
                        method:  'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify(coords),
                      })
                      if (!res.ok) {
                        const j = await res.json().catch(() => ({}))
                        throw new Error(j.error || `Erreur ${res.status}`)
                      }
                    } catch (e: any) {
                      alert(`Sauvegarde plan : ${e.message}`)
                      load() // rollback en relisant
                    }
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeMission && <VehicleCard mission={activeMission} dragging />}
      </DragOverlay>
    </DndContext>
    </AppShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Zone positionnée sur le canvas (drag + resize en mode édition)
// ─────────────────────────────────────────────────────────────────────────────
function ZoneOnCanvas({ zone, rows, missionsOnRow, matchingIds, canDriverDrop, editMode, canvasRef, onLayoutCommit }: {
  zone:          Zone
  rows:          Row[]
  missionsOnRow: (zoneKey: string, rowNumber: number) => PlacedMission[]
  matchingIds:   Set<string>
  canDriverDrop: boolean
  editMode:      boolean
  canvasRef:     React.RefObject<HTMLDivElement>
  onLayoutCommit: (coords: { pos_x: number; pos_y: number; width: number; height: number }) => void
}) {
  // Coords locales pendant un drag/resize (commit en fin de geste seulement)
  const [local, setLocal] = useState<{ pos_x: number; pos_y: number; width: number; height: number } | null>(null)
  const pos_x  = local?.pos_x  ?? zone.pos_x
  const pos_y  = local?.pos_y  ?? zone.pos_y
  const width  = local?.width  ?? zone.width
  const height = local?.height ?? zone.height

  function startDrag(e: React.MouseEvent | React.TouchEvent, mode: 'move' | 'resize') {
    if (!editMode || !canvasRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const canvas = canvasRef.current.getBoundingClientRect()
    const startX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const startY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const initial = { pos_x: zone.pos_x, pos_y: zone.pos_y, width: zone.width, height: zone.height }

    const onMove = (mv: MouseEvent | TouchEvent) => {
      const mx = 'touches' in mv ? mv.touches[0].clientX : mv.clientX
      const my = 'touches' in mv ? mv.touches[0].clientY : mv.clientY
      const dx = ((mx - startX) / canvas.width) * 100
      const dy = ((my - startY) / canvas.height) * 100
      if (mode === 'move') {
        setLocal({
          pos_x:  Math.max(0, Math.min(100 - initial.width,  initial.pos_x + dx)),
          pos_y:  Math.max(0, Math.min(100 - initial.height, initial.pos_y + dy)),
          width:  initial.width,
          height: initial.height,
        })
      } else {
        setLocal({
          pos_x:  initial.pos_x,
          pos_y:  initial.pos_y,
          width:  Math.max(5, Math.min(100 - initial.pos_x, initial.width  + dx)),
          height: Math.max(5, Math.min(100 - initial.pos_y, initial.height + dy)),
        })
      }
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend',  onUp)
      setLocal(curr => {
        if (curr) {
          onLayoutCommit({
            pos_x:  Math.round(curr.pos_x * 100) / 100,
            pos_y:  Math.round(curr.pos_y * 100) / 100,
            width:  Math.round(curr.width  * 100) / 100,
            height: Math.round(curr.height * 100) / 100,
          })
        }
        return null
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend',  onUp)
  }

  return (
    <div
      className={`absolute bg-surface-2 border rounded-xl overflow-hidden flex flex-col ${
        editMode ? 'cursor-move ring-2 ring-brand/40 hover:ring-brand' : ''
      } ${canDriverDrop ? '' : 'opacity-50'}`}
      style={{
        left:   `${pos_x}%`,
        top:    `${pos_y}%`,
        width:  `${width}%`,
        height: `${height}%`,
        transition: local ? 'none' : 'left 0.2s, top 0.2s, width 0.2s, height 0.2s',
      }}
      onMouseDown={editMode ? (e => startDrag(e, 'move')) : undefined}
      onTouchStart={editMode ? (e => startDrag(e, 'move')) : undefined}
    >
      <div className="px-2 py-1 border-b bg-surface flex items-center justify-between flex-shrink-0">
        <h2 className="text-ink font-bold text-sm truncate">Zone {zone.label}</h2>
        {editMode && (
          <span className="text-ink-faint text-[9px] font-mono">{width.toFixed(0)}×{height.toFixed(0)}%</span>
        )}
        {!editMode && !canDriverDrop && (
          <span className="text-ink-faint text-[10px]">non autorisée</span>
        )}
      </div>
      {!editMode && (
        <div className="p-2 space-y-1.5 overflow-auto flex-1">
          {rows.length === 0 ? (
            <p className="text-ink-faint text-[10px] italic text-center py-2">
              Aucune ligne configurée
            </p>
          ) : rows.map(row => (
            <RowSlots
              key={row.id}
              row={row}
              missions={missionsOnRow(zone.key, row.row_number)}
              matchingIds={matchingIds}
            />
          ))}
        </div>
      )}
      {editMode && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 bg-brand cursor-nwse-resize rounded-tl"
          onMouseDown={e => startDrag(e, 'resize')}
          onTouchStart={e => startDrag(e, 'resize')}
          title="Redimensionner"
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar "À placer"
// ─────────────────────────────────────────────────────────────────────────────
function UnplacedSidebar({ missions, matchingIds }: { missions: PlacedMission[]; matchingIds: Set<string> }) {
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
          {missions.map(m => <VehicleCard key={m.id} mission={m} highlighted={matchingIds.has(m.id)} />)}
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
function RowSlots({ row, missions, matchingIds }: { row: Row; missions: PlacedMission[]; matchingIds: Set<string> }) {
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
            highlighted={mission ? matchingIds.has(mission.id) : false}
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
function Slot({ zoneKey, rowNumber, slotIndex, isOverflow, mission, highlighted }: {
  zoneKey:     string
  rowNumber:   number
  slotIndex:   number
  isOverflow:  boolean
  mission:     PlacedMission | null
  highlighted: boolean
}) {
  const id = `slot-${zoneKey}-${rowNumber}-${slotIndex}`
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={`w-[78px] h-[46px] rounded border flex items-center justify-center text-[10px] transition-colors ${
        highlighted
          ? 'ring-4 ring-amber-400 ring-offset-1 border-amber-500 bg-amber-100 animate-pulse'
          : mission
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
      {mission ? <VehicleCard mission={mission} compact highlighted={highlighted} /> : <span className="text-ink-faint">{slotIndex}</span>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Carte vehicule draggable
// ─────────────────────────────────────────────────────────────────────────────
function VehicleCard({ mission, compact, dragging, highlighted }: {
  mission: PlacedMission
  compact?: boolean
  dragging?: boolean
  highlighted?: boolean
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
          : `bg-surface border px-2.5 py-2 hover:border-brand text-xs ${dragging ? 'shadow-2xl border-brand bg-brand/5' : ''} ${highlighted ? 'ring-4 ring-amber-400 border-amber-500 bg-amber-50 animate-pulse' : ''} ${isDragging ? 'opacity-30' : ''}`
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
