'use client'
// src/app/admin/parc/ParcAdminClient.tsx
//
// UI admin : configurer les lignes du parc fourriere par zone.
// - Liste les zones (figees, defile par sort_order)
// - Pour chaque zone : ses lignes (A1, A2, ...) avec capacite editable
// - + Ajouter ligne / supprimer ligne (refus si vehicules dessus)

import { useState } from 'react'
import { Plus, Trash2, Check, X } from 'lucide-react'

interface Zone {
  key:        string
  label:      string
  active:     boolean
  sort_order: number
}

interface Row {
  id:          number
  zone_key:    string
  row_number:  number
  capacity:    number
}

export default function ParcAdminClient({ initialZones, initialRows }: {
  initialZones: Zone[]
  initialRows:  Row[]
}) {
  const [zones]   = useState<Zone[]>(initialZones)
  const [rows, setRows] = useState<Row[]>(initialRows)
  const [busy, setBusy] = useState(false)

  function rowsOf(zoneKey: string): Row[] {
    return rows.filter(r => r.zone_key === zoneKey).sort((a, b) => a.row_number - b.row_number)
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {zones.map(zone => {
          const zRows = rowsOf(zone.key)
          return (
            <div key={zone.key} className="bg-surface-2 border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between bg-surface">
                <h2 className="text-ink font-bold text-base">Zone {zone.label}</h2>
                <button
                  onClick={() => addRow(zone.key)}
                  disabled={busy}
                  className="flex items-center gap-1 px-2.5 py-1 bg-brand hover:bg-brand-dark text-white rounded-lg text-xs font-medium transition disabled:opacity-50"
                >
                  <Plus size={14} /> Ajouter ligne
                </button>
              </div>
              <div className="divide-y divide-[#222]">
                {zRows.length === 0 ? (
                  <p className="px-4 py-6 text-ink-muted text-sm text-center italic">
                    Aucune ligne configurée
                  </p>
                ) : zRows.map(row => (
                  <RowEditor
                    key={row.id}
                    row={row}
                    busy={busy}
                    onSave={cap => updateCapacity(row, cap)}
                    onDelete={() => deleteRow(row)}
                  />
                ))}
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
