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
import { RefreshCw, Car, AlertTriangle, Edit3, Check, Search, X, Ban } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { createClient } from '@supabase/supabase-js'

const sbClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

interface Zone {
  key:             string
  label:           string
  sort_order:      number
  pos_x:           number
  pos_y:           number
  width:           number  // legacy, plus utilise (auto-size)
  height:          number  // legacy, plus utilise (auto-size)
  slot_direction:  'ltr' | 'rtl'
  row_layout:      'horizontal' | 'vertical'
  strict_capacity: boolean
}

// Dimensions en pixels (zones auto-sized selon contenu).
// La forme du slot s'oriente avec le sens de la rangée :
// - rangée horizontale : slot LANDSCAPE (long horizontalement)
// - rangée verticale   : slot PORTRAIT  (long verticalement)
const SLOT_LONG    = 52   // dimension du slot dans le sens de la rangée
const SLOT_SHORT   = 38   // dimension perpendiculaire
const ROW_LABEL_W  = 32   // largeur label de rangée en layout horizontal
const COL_LABEL_H  = 16   // hauteur label de rangée en layout vertical
const ZONE_HEADER_H = 26  // hauteur header de zone
const ZONE_PAD     = 6    // padding interne zone
const SLOT_GAP     = 2    // gap entre slots

function slotDims(layout: 'horizontal' | 'vertical'): { w: number; h: number } {
  return layout === 'horizontal'
    ? { w: SLOT_LONG,  h: SLOT_SHORT }
    : { w: SLOT_SHORT, h: SLOT_LONG }
}

function zoneSize(rows: Row[], layout: 'horizontal' | 'vertical'): { w: number; h: number } {
  if (rows.length === 0) return { w: 140, h: 56 }
  const maxCap = Math.max(...rows.map(r => r.capacity)) + 1 // +1 reserve overflow
  const slot = slotDims(layout)
  if (layout === 'horizontal') {
    return {
      w: ROW_LABEL_W + SLOT_GAP + maxCap * slot.w + (maxCap - 1) * SLOT_GAP + 2 * ZONE_PAD,
      h: ZONE_HEADER_H + rows.length * slot.h + (rows.length - 1) * SLOT_GAP + 2 * ZONE_PAD,
    }
  }
  return {
    w: rows.length * slot.w + (rows.length - 1) * SLOT_GAP + 2 * ZONE_PAD,
    h: ZONE_HEADER_H + COL_LABEL_H + SLOT_GAP + maxCap * slot.h + (maxCap - 1) * SLOT_GAP + 2 * ZONE_PAD,
  }
}

interface Row {
  id:         number
  zone_key:   string
  row_number: number
  capacity:   number
  sort_order: number
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

interface BlockedSlot {
  zone_key:    string
  row_number:  number
  slot_index:  number
  reason:      string | null
}

interface State {
  zones:           Zone[]
  rows:            Row[]
  placed:          PlacedMission[]
  toPlace:         PlacedMission[]
  blocked:         BlockedSlot[]
  canvasHeightPx:  number
}

const UNPLACED_DROP_ID = 'unplaced'

export default function ParcPlanClient({ isDispatcher, isDriver, canEditLayout, canBlock, userRole, userName, userEmail, userModules }: {
  isDispatcher:   boolean
  isDriver:       boolean
  canEditLayout:  boolean
  canBlock:       boolean
  userRole:       string
  userName:       string
  userEmail?:     string
  userModules:    string[]
}) {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeMission, setActiveMission] = useState<PlacedMission | null>(null)
  const [editMode, setEditMode]   = useState(false)
  const [blockMode, setBlockMode] = useState(false)
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incoming_missions' },    () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parc_zones' },           () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parc_rows' },            () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parc_blocked_slots' },   () => load())
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

  // Map slot bloque -> reason (cle "zone-row-slot")
  const blockedMap = useMemo<Map<string, string | null>>(() => {
    const out = new Map<string, string | null>()
    if (!state) return out
    for (const b of state.blocked) {
      out.set(`${b.zone_key}-${b.row_number}-${b.slot_index}`, b.reason)
    }
    return out
  }, [state])

  const blockedCount = state?.blocked.length ?? 0

  const rowsByZone = useMemo<Record<string, Row[]>>(() => {
    if (!state) return {}
    const out: Record<string, Row[]> = {}
    for (const r of state.rows) {
      (out[r.zone_key] ||= []).push(r)
    }
    for (const z of Object.keys(out)) out[z].sort((a, b) => (a.sort_order || a.row_number) - (b.sort_order || b.row_number))
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

  async function toggleBlock(zoneKey: string, rowNumber: number, slotIndex: number) {
    const key       = `${zoneKey}-${rowNumber}-${slotIndex}`
    const isBlocked = blockedMap.has(key)
    let reason: string | null = null
    if (!isBlocked) {
      // Prompt motif optionnel (vide accepte)
      const input = window.prompt(
        `Bloquer l'emplacement ${zoneKey}${rowNumber}-${slotIndex}.\nMotif (optionnel) :`,
        '',
      )
      // null = annulation, '' = pas de motif mais on bloque
      if (input === null) return
      reason = input.trim() || null
    }
    try {
      const res = await fetch('/api/parc/block', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ zone_key: zoneKey, row_number: rowNumber, slot_index: slotIndex, reason }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      await load()
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
        <UnplacedSidebar missions={state.toPlace} matchingIds={matchingIds} blockMode={blockMode} />

        {/* Canvas des zones */}
        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-ink font-bold text-xl">Plan du parc</h1>
              <p className="text-ink-muted text-xs mt-0.5">
                {editMode
                  ? 'Glisse les zones pour les positionner, coin bas-droit pour redimensionner.'
                  : blockMode
                    ? 'Clique sur un emplacement libre pour le bloquer/débloquer. Le drag&drop est désactivé.'
                    : `Glisse les véhicules entre les slots. ${isDriver && !isDispatcher ? '— Tu peux placer uniquement dans A et Transit.' : ''}`}
                {!editMode && !blockMode && blockedCount > 0 && (
                  <span className="ml-2 text-critical">— {blockedCount} emplacement{blockedCount > 1 ? 's' : ''} bloqué{blockedCount > 1 ? 's' : ''}.</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!editMode && !blockMode && (
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
              {canBlock && !editMode && (
                <button
                  onClick={() => setBlockMode(m => !m)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                    blockMode
                      ? 'bg-critical hover:bg-critical/80 text-white'
                      : 'bg-surface-2 border text-ink-secondary hover:text-ink'
                  }`}
                  title="Bloquer manuellement des emplacements"
                >
                  {blockMode ? <><Check size={14} /> Terminer</> : <><Ban size={14} /> Bloquer</>}
                </button>
              )}
              {canEditLayout && !blockMode && (
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
                  blockedMap={blockedMap}
                  blockMode={blockMode}
                  onToggleBlock={toggleBlock}
                  canDriverDrop={canDriverDrop}
                  editMode={editMode}
                  canvasRef={canvasRef}
                  onPositionCommit={async (coords) => {
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
                      load()
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
// Zone positionnée sur le canvas (auto-size selon contenu, drag en édition)
// ─────────────────────────────────────────────────────────────────────────────
function ZoneOnCanvas({ zone, rows, missionsOnRow, matchingIds, blockedMap, blockMode, onToggleBlock, canDriverDrop, editMode, canvasRef, onPositionCommit }: {
  zone:          Zone
  rows:          Row[]
  missionsOnRow: (zoneKey: string, rowNumber: number) => PlacedMission[]
  matchingIds:   Set<string>
  blockedMap:    Map<string, string | null>
  blockMode:     boolean
  onToggleBlock: (zoneKey: string, rowNumber: number, slotIndex: number) => void
  canDriverDrop: boolean
  editMode:      boolean
  canvasRef:     React.RefObject<HTMLDivElement>
  onPositionCommit: (coords: { pos_x: number; pos_y: number }) => void
}) {
  const [localPos, setLocalPos] = useState<{ pos_x: number; pos_y: number } | null>(null)
  const pos_x = localPos?.pos_x ?? zone.pos_x
  const pos_y = localPos?.pos_y ?? zone.pos_y

  const size = useMemo(() => zoneSize(rows, zone.row_layout), [rows, zone.row_layout])

  function startDrag(e: React.MouseEvent | React.TouchEvent) {
    if (!editMode || !canvasRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const canvas = canvasRef.current.getBoundingClientRect()
    const startX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const startY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const initial = { pos_x: zone.pos_x, pos_y: zone.pos_y }
    const sizePctW = (size.w / canvas.width)  * 100
    const sizePctH = (size.h / canvas.height) * 100

    const onMove = (mv: MouseEvent | TouchEvent) => {
      const mx = 'touches' in mv ? mv.touches[0].clientX : mv.clientX
      const my = 'touches' in mv ? mv.touches[0].clientY : mv.clientY
      const dx = ((mx - startX) / canvas.width)  * 100
      const dy = ((my - startY) / canvas.height) * 100
      setLocalPos({
        pos_x: Math.max(0, Math.min(100 - sizePctW, initial.pos_x + dx)),
        pos_y: Math.max(0, Math.min(100 - sizePctH, initial.pos_y + dy)),
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend',  onUp)
      setLocalPos(curr => {
        if (curr) {
          onPositionCommit({
            pos_x: Math.round(curr.pos_x * 100) / 100,
            pos_y: Math.round(curr.pos_y * 100) / 100,
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

  const isVertical = zone.row_layout === 'vertical'

  return (
    <div
      className={`absolute bg-surface-2 border rounded-xl overflow-hidden flex flex-col ${
        editMode ? 'cursor-move ring-2 ring-brand/40 hover:ring-brand' : ''
      } ${canDriverDrop ? '' : 'opacity-50'}`}
      style={{
        left:   `${pos_x}%`,
        top:    `${pos_y}%`,
        width:  `${size.w}px`,
        height: `${size.h}px`,
        transition: localPos ? 'none' : 'left 0.2s, top 0.2s',
      }}
      onMouseDown={editMode ? startDrag : undefined}
      onTouchStart={editMode ? startDrag : undefined}
    >
      <div className="px-2 border-b bg-surface flex items-center justify-between flex-shrink-0" style={{ height: ZONE_HEADER_H }}>
        <h2 className="text-ink font-bold text-xs truncate">{zone.label}</h2>
        {!editMode && !canDriverDrop && (
          <span className="text-ink-faint text-[9px]">non autorisée</span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-1">
          <p className="text-ink-faint text-[9px] italic text-center">
            {editMode ? 'À configurer' : '—'}
          </p>
        </div>
      ) : (
        <div
          className={`flex-1 flex ${isVertical ? 'flex-row' : 'flex-col'} gap-[2px]`}
          style={{ padding: ZONE_PAD }}
        >
          {rows.map(row => (
            <RowSlots
              key={row.id}
              row={row}
              missions={missionsOnRow(zone.key, row.row_number)}
              matchingIds={matchingIds}
              blockedMap={blockedMap}
              blockMode={blockMode}
              onToggleBlock={onToggleBlock}
              direction={zone.slot_direction}
              layout={zone.row_layout}
              strict={zone.strict_capacity}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar "À placer"
// ─────────────────────────────────────────────────────────────────────────────
function UnplacedSidebar({ missions, matchingIds, blockMode }: { missions: PlacedMission[]; matchingIds: Set<string>; blockMode: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: UNPLACED_DROP_ID, disabled: blockMode })

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
          {missions.map(m => <VehicleCard key={m.id} mission={m} highlighted={matchingIds.has(m.id)} disableDrag={blockMode} />)}
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
function RowSlots({ row, missions, matchingIds, blockedMap, blockMode, onToggleBlock, direction, layout, strict }: {
  row:           Row
  missions:      PlacedMission[]
  matchingIds:   Set<string>
  blockedMap:    Map<string, string | null>
  blockMode:     boolean
  onToggleBlock: (zoneKey: string, rowNumber: number, slotIndex: number) => void
  direction:     'ltr' | 'rtl'
  layout:        'horizontal' | 'vertical'
  strict:        boolean
}) {
  const slot = slotDims(layout)
  const overflow = missions.length > row.capacity
  // Nombre de slots affiches : si strict, exactement capacity (pas d overflow).
  // Sinon : capacity + 1 (reserve visible) ou autant que de missions + 1.
  const slotCount = strict
    ? row.capacity
    : Math.max(row.capacity + 1, missions.length + 1)
  const slots: Array<PlacedMission | null> = Array.from({ length: slotCount }, () => null)
  for (const m of missions) {
    const idx = (m.parc_slot_index || 1) - 1
    if (idx >= 0 && idx < slotCount) slots[idx] = m
  }

  const labelClass = `flex-shrink-0 font-mono font-bold text-[10px] flex items-center justify-center rounded ${
    overflow ? 'bg-critical/15 text-critical' : 'bg-brand/15 text-brand'
  }`

  if (layout === 'horizontal') {
    return (
      <div className="flex items-center gap-[2px]" style={{ height: slot.h }}>
        <div className={labelClass} style={{ width: ROW_LABEL_W, height: slot.h }}>
          {row.zone_key}{row.row_number}
        </div>
        <div className={`flex gap-[2px] ${direction === 'rtl' ? 'flex-row-reverse' : ''}`}>
          {slots.map((mission, i) => {
            const slotIdx = i + 1
            const blockedKey = `${row.zone_key}-${row.row_number}-${slotIdx}`
            const blockedReason = blockedMap.has(blockedKey) ? blockedMap.get(blockedKey) ?? null : undefined
            return (
              <Slot
                key={i}
                zoneKey={row.zone_key}
                rowNumber={row.row_number}
                slotIndex={slotIdx}
                isOverflow={i >= row.capacity}
                mission={mission}
                highlighted={mission ? matchingIds.has(mission.id) : false}
                slotW={slot.w}
                slotH={slot.h}
                blockedReason={blockedReason}
                blockMode={blockMode}
                onToggleBlock={onToggleBlock}
              />
            )
          })}
        </div>
      </div>
    )
  }

  // Vertical : rangée = colonne, label en haut, slots empilés vers le bas
  return (
    <div className="flex flex-col items-center gap-[2px]" style={{ width: slot.w }}>
      <div className={labelClass} style={{ width: slot.w, height: COL_LABEL_H }}>
        {row.zone_key}{row.row_number}
      </div>
      <div className={`flex flex-col gap-[2px] ${direction === 'rtl' ? 'flex-col-reverse' : ''}`}>
        {slots.map((mission, i) => {
          const slotIdx = i + 1
          const blockedKey = `${row.zone_key}-${row.row_number}-${slotIdx}`
          const blockedReason = blockedMap.has(blockedKey) ? blockedMap.get(blockedKey) ?? null : undefined
          return (
            <Slot
              key={i}
              zoneKey={row.zone_key}
              rowNumber={row.row_number}
              slotIndex={slotIdx}
              isOverflow={i >= row.capacity}
              mission={mission}
              highlighted={mission ? matchingIds.has(mission.id) : false}
              slotW={slot.w}
              slotH={slot.h}
              blockedReason={blockedReason}
              blockMode={blockMode}
              onToggleBlock={onToggleBlock}
            />
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Un slot droppable (avec ou sans vehicule)
// ─────────────────────────────────────────────────────────────────────────────
function Slot({ zoneKey, rowNumber, slotIndex, isOverflow, mission, highlighted, slotW, slotH, blockedReason, blockMode, onToggleBlock }: {
  zoneKey:       string
  rowNumber:     number
  slotIndex:     number
  isOverflow:    boolean
  mission:       PlacedMission | null
  highlighted:   boolean
  slotW:         number
  slotH:         number
  blockedReason: string | null | undefined  // undefined = pas bloqué, null = bloqué sans motif, string = motif
  blockMode:     boolean
  onToggleBlock: (zoneKey: string, rowNumber: number, slotIndex: number) => void
}) {
  const id = `slot-${zoneKey}-${rowNumber}-${slotIndex}`
  const isBlocked = blockedReason !== undefined
  // En mode bloquer OU si deja bloque, le slot n est plus une cible drop.
  const droppable = !blockMode && !isBlocked
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable })

  const tooltip = isBlocked
    ? `Bloqué : ${zoneKey}${rowNumber}-${slotIndex}${blockedReason ? ` — ${blockedReason}` : ''}`
    : isOverflow
      ? `Slot overflow ${zoneKey}${rowNumber}-${slotIndex}`
      : `${zoneKey}${rowNumber}-${slotIndex}`

  const baseClass = isBlocked
    ? 'border-critical bg-critical/20'
    : highlighted
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

  const clickable = blockMode && !mission
  const handleClick = clickable ? () => onToggleBlock(zoneKey, rowNumber, slotIndex) : undefined

  return (
    <div
      ref={setNodeRef}
      style={{ width: slotW, height: slotH }}
      className={`flex-shrink-0 rounded border flex items-center justify-center text-[10px] transition-colors relative ${baseClass} ${
        clickable ? 'cursor-pointer hover:ring-2 hover:ring-critical' : ''
      } ${blockMode && mission ? 'opacity-60' : ''}`}
      title={tooltip}
      onClick={handleClick}
    >
      {mission ? (
        <VehicleCard mission={mission} compact highlighted={highlighted} disableDrag={blockMode} />
      ) : isBlocked ? (
        <Ban size={Math.min(slotW, slotH) - 12} className="text-critical" strokeWidth={2.5} />
      ) : (
        <span className="text-ink-faint">{slotIndex}</span>
      )}
      {/* Surcouche barré rouge sur slot occupé ET bloqué (rare mais possible) */}
      {isBlocked && mission && (
        <div className="absolute inset-0 flex items-center justify-center bg-critical/30 pointer-events-none">
          <Ban size={Math.min(slotW, slotH) - 8} className="text-critical" strokeWidth={3} />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Carte vehicule draggable
// ─────────────────────────────────────────────────────────────────────────────
function VehicleCard({ mission, compact, dragging, highlighted, disableDrag }: {
  mission: PlacedMission
  compact?: boolean
  dragging?: boolean
  highlighted?: boolean
  disableDrag?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: mission.id, disabled: disableDrag })
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
