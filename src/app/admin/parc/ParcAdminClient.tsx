'use client'
// src/app/admin/parc/ParcAdminClient.tsx
//
// UI admin : configurer les lignes du parc fourriere par zone.
// - Liste les zones (figees, defile par sort_order)
// - Pour chaque zone : ses lignes (A1, A2, ...) avec capacite editable
// - + Ajouter ligne / supprimer ligne (refus si vehicules dessus)

import { useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Trash2, Check, X, GripVertical, ArrowLeftRight, RotateCw, Lock, Unlock } from 'lucide-react'

interface Zone {
  key:             string
  label:           string
  active:          boolean
  sort_order:      number
  slot_direction:  'ltr' | 'rtl'
  row_layout:      'horizontal' | 'vertical'
  strict_capacity: boolean
}

interface Row {
  id:          number
  zone_key:    string
  row_number:  number
  capacity:    number
  sort_order:  number
}

export default function ParcAdminClient({ initialZones, initialRows, initialCanvasHeight }: {
  initialZones:        Zone[]
  initialRows:         Row[]
  initialCanvasHeight: number
}) {
  const [zones, setZones] = useState<Zone[]>(initialZones)
  const [rows, setRows] = useState<Row[]>(initialRows)
  const [busy, setBusy] = useState(false)
  const [canvasHeight, setCanvasHeight] = useState(initialCanvasHeight)
  const [canvasInput, setCanvasInput]   = useState(String(initialCanvasHeight))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function toggleZoneOption(zoneKey: string, patch: Partial<Pick<Zone, 'slot_direction' | 'row_layout' | 'strict_capacity'>>) {
    setBusy(true)
    setZones(zs => zs.map(z => z.key === zoneKey ? { ...z, ...patch } : z))
    try {
      const res = await fetch(`/api/admin/parc/zones/${encodeURIComponent(zoneKey)}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
      // rollback
      setZones(initialZones.map(z => ({ ...z })))
    } finally {
      setBusy(false)
    }
  }

  async function handleReorderDragEnd(zoneKey: string, ev: DragEndEvent) {
    const { active, over } = ev
    if (!over || active.id === over.id) return
    const zRows = rowsOf(zoneKey)
    const oldIdx = zRows.findIndex(r => r.id === Number(active.id))
    const newIdx = zRows.findIndex(r => r.id === Number(over.id))
    if (oldIdx < 0 || newIdx < 0) return

    // Reordonner localement et renumeroter row_number
    const reordered = [...zRows]
    const [moved] = reordered.splice(oldIdx, 1)
    reordered.splice(newIdx, 0, moved)
    const orderedIds = reordered.map(r => r.id)

    // Update local state : on ne touche QUE sort_order (row_number reste fige)
    setRows(prev => {
      const others = prev.filter(r => r.zone_key !== zoneKey)
      const resorted = reordered.map((r, i) => ({ ...r, sort_order: i + 1 }))
      return [...others, ...resorted]
    })

    setBusy(true)
    try {
      const res = await fetch('/api/admin/parc/rows/reorder', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ zone_key: zoneKey, ordered_ids: orderedIds }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
      setRows(initialRows.map(r => ({ ...r })))
    } finally {
      setBusy(false)
    }
  }

  async function saveCanvasHeight() {
    const n = parseInt(canvasInput, 10)
    if (!Number.isInteger(n) || n < 400 || n > 8000) {
      alert('Hauteur invalide (entre 400 et 8000 px)')
      return
    }
    if (n === canvasHeight) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/parc/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ canvas_height_px: n }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setCanvasHeight(n)
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
      setCanvasInput(String(canvasHeight))
    } finally {
      setBusy(false)
    }
  }

  function rowsOf(zoneKey: string): Row[] {
    return rows.filter(r => r.zone_key === zoneKey)
      .sort((a, b) => (a.sort_order || a.row_number) - (b.sort_order || b.row_number))
  }

  async function addRow(zoneKey: string) {
    const capStr = prompt(`Capacité de la nouvelle ligne dans ${zoneKey} ?`, '5')
    if (!capStr) return
    const capacity = parseInt(capStr, 10)
    if (!Number.isInteger(capacity) || capacity <= 0) {
      alert('Capacité invalide (entier > 0)')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/parc/rows', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ zone_key: zoneKey, capacity }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setRows(r => [...r, j.row])
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function updateCapacity(row: Row, newCapacity: number) {
    if (newCapacity === row.capacity) return
    if (!Number.isInteger(newCapacity) || newCapacity <= 0) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/parc/rows/${row.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ capacity: newCapacity }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setRows(r => r.map(x => x.id === row.id ? j.row : x))
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function deleteRow(row: Row) {
    if (!confirm(`Supprimer la ligne ${row.zone_key}${row.row_number} ?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/parc/rows/${row.id}`, { method: 'DELETE' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setRows(r => r.filter(x => x.id !== row.id))
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-ink font-bold text-xl">Configuration du parc</h1>
        <p className="text-ink-muted text-sm mt-1">
          Les zones sont figées. Pour chaque zone, configure les lignes (auto-numérotées) et leur capacité.
          Capacité = nombre de places affichées ; l&apos;overflow (+N) est accepté avec un warning visuel.
        </p>
      </div>

      {/* Canvas size config */}
      <div className="bg-surface-2 border rounded-2xl p-4">
        <h2 className="text-ink font-semibold text-sm mb-2">Dimensions du plan</h2>
        <p className="text-ink-muted text-xs mb-3">
          La largeur du canvas s&apos;adapte automatiquement à l&apos;écran. La hauteur (en pixels) permet d&apos;allonger le plan
          verticalement si ton parking est long (ex : 50 rangées → 2400-3000px).
        </p>
        <div className="flex items-center gap-2">
          <label className="text-ink-muted text-xs">Hauteur du canvas (px)</label>
          <input
            type="number" min={400} max={8000} step={100}
            value={canvasInput}
            onChange={e => setCanvasInput(e.target.value)}
            onBlur={saveCanvasHeight}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            disabled={busy}
            className="w-24 bg-surface border rounded px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand"
          />
          <span className="text-ink-faint text-xs">actuelle : {canvasHeight}px</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {zones.map(zone => {
          const zRows = rowsOf(zone.key)
          return (
            <div key={zone.key} className="bg-surface-2 border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b bg-surface space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-ink font-bold text-base">Zone {zone.label}</h2>
                  <button
                    onClick={() => addRow(zone.key)}
                    disabled={busy}
                    className="flex items-center gap-1 px-2.5 py-1 bg-brand hover:bg-brand-dark text-white rounded-lg text-xs font-medium transition disabled:opacity-50"
                  >
                    <Plus size={14} /> Ajouter ligne
                  </button>
                </div>
                {/* Options de la zone : orientation + sens */}
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    onClick={() => toggleZoneOption(zone.key, { row_layout: zone.row_layout === 'horizontal' ? 'vertical' : 'horizontal' })}
                    disabled={busy}
                    className="flex items-center gap-1 px-2 py-1 bg-surface border rounded text-ink-secondary hover:text-ink transition disabled:opacity-50"
                    title="Orientation des rangées"
                  >
                    <RotateCw size={11} /> {zone.row_layout === 'horizontal' ? 'Horizontale' : 'Verticale'}
                  </button>
                  <button
                    onClick={() => toggleZoneOption(zone.key, { slot_direction: zone.slot_direction === 'ltr' ? 'rtl' : 'ltr' })}
                    disabled={busy}
                    className="flex items-center gap-1 px-2 py-1 bg-surface border rounded text-ink-secondary hover:text-ink transition disabled:opacity-50"
                    title="Sens des voitures dans la rangée"
                  >
                    <ArrowLeftRight size={11} /> {zone.slot_direction === 'ltr' ? '→' : '←'}
                  </button>
                  <button
                    onClick={() => toggleZoneOption(zone.key, { strict_capacity: !zone.strict_capacity })}
                    disabled={busy}
                    className={`flex items-center gap-1 px-2 py-1 rounded border transition disabled:opacity-50 ${
                      zone.strict_capacity
                        ? 'bg-critical/10 border-critical/40 text-critical'
                        : 'bg-surface text-ink-secondary hover:text-ink'
                    }`}
                    title={zone.strict_capacity ? 'Zone strict : pas d overflow autorise' : 'Zone tolerante (overflow +N OK)'}
                  >
                    {zone.strict_capacity ? <Lock size={11} /> : <Unlock size={11} />}
                    {zone.strict_capacity ? 'Strict' : 'Tolerant'}
                  </button>
                </div>
              </div>
              <div className="divide-y divide-[#222]">
                {zRows.length === 0 ? (
                  <p className="px-4 py-6 text-ink-muted text-sm text-center italic">
                    Aucune ligne configurée
                  </p>
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={ev => handleReorderDragEnd(zone.key, ev)}>
                    <SortableContext items={zRows.map(r => r.id)} strategy={verticalListSortingStrategy}>
                      {zRows.map(row => (
                        <SortableRowEditor
                          key={row.id}
                          row={row}
                          busy={busy}
                          onSave={cap => updateCapacity(row, cap)}
                          onDelete={() => deleteRow(row)}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RowEditor({ row, busy, onSave, onDelete }: {
  row:      Row
  busy:     boolean
  onSave:   (capacity: number) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(String(row.capacity))

  function commit() {
    const n = parseInt(val, 10)
    if (!Number.isInteger(n) || n <= 0) {
      setVal(String(row.capacity))
      setEditing(false)
      return
    }
    onSave(n)
    setEditing(false)
  }

  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-surface-hover">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-ink font-mono font-bold text-sm bg-brand/15 text-brand px-2 py-0.5 rounded">
          {row.zone_key}{row.row_number}
        </span>
        {editing ? (
          <>
            <input
              type="number" min={1}
              value={val}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') { setVal(String(row.capacity)); setEditing(false) }
              }}
              autoFocus
              className="w-16 bg-surface border rounded px-2 py-1 text-sm text-ink"
            />
            <button onClick={commit} disabled={busy} className="text-success hover:text-success-soft">
              <Check size={16} />
            </button>
            <button onClick={() => { setVal(String(row.capacity)); setEditing(false) }}
                    className="text-ink-muted hover:text-ink">
              <X size={16} />
            </button>
          </>
        ) : (
          <button
            onClick={() => { setVal(String(row.capacity)); setEditing(true) }}
            className="text-ink-secondary text-sm hover:text-ink"
            title="Cliquer pour modifier"
          >
            Capacité : <span className="font-semibold">{row.capacity}</span>
          </button>
        )}
      </div>
      <button
        onClick={onDelete} disabled={busy}
        className="text-ink-muted hover:text-critical p-1.5 transition disabled:opacity-50"
        title="Supprimer la ligne"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

// Wrapper sortable autour de RowEditor : ajoute une poignee GripVertical
// a gauche pour drag&drop de reordonnancement.
function SortableRowEditor(props: {
  row:      Row
  busy:     boolean
  onSave:   (capacity: number) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.row.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity:   isDragging ? 0.6 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className={`flex items-center ${isDragging ? 'bg-surface-hover' : ''}`}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-ink-faint hover:text-ink-secondary touch-none px-2"
        aria-label="Réordonner la ligne"
      >
        <GripVertical size={14} />
      </button>
      <div className="flex-1">
        <RowEditor {...props} />
      </div>
    </div>
  )
}
