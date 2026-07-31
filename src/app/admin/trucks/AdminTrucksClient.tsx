'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Truck {
  id:         string
  name:       string
  plate:      string
  brand:      string | null
  model:      string | null
  year:       number | null
  active:     boolean
  sort_order: number
  notes:      string | null
}

interface Driver {
  id:                       string
  name:                     string
  email:                    string
  role:                     string
  default_truck_id:         string | null
  current_truck_id:         string | null
  truck_confirm_disabled?:  boolean
}

const EMPTY: Partial<Truck> = {
  name: '', plate: '', brand: '', model: '', year: null, active: true, sort_order: 100, notes: '',
}

export default function AdminTrucksClient({ initialTrucks, initialDrivers }: {
  initialTrucks:  Truck[]
  initialDrivers: Driver[]
}) {
  const router = useRouter()
  const [trucks, setTrucks] = useState<Truck[]>(initialTrucks)
  const [drivers, setDrivers] = useState<Driver[]>(initialDrivers)
  const [editing, setEditing] = useState<Partial<Truck> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [savingAssign, setSavingAssign] = useState<string | null>(null)

  function openCreate() { setError(null); setEditing({ ...EMPTY }) }
  function openEdit(t: Truck) { setError(null); setEditing({ ...t }) }

  async function save() {
    if (!editing) return
    const isUpdate = !!editing.id
    setBusy(true); setError(null)
    try {
      const url = isUpdate ? `/api/admin/trucks?id=${editing.id}` : '/api/admin/trucks'
      const res = await fetch(url, {
        method:  isUpdate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(editing),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      // Refresh local
      if (isUpdate) {
        setTrucks(trucks.map(t => t.id === editing.id ? data.truck : t))
      } else {
        setTrucks([...trucks, data.truck].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)))
      }
      setEditing(null)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  async function softDelete(t: Truck) {
    if (!confirm(`Désactiver la dépanneuse "${t.name}" (${t.plate}) ?\nElle ne sera plus dans les sélecteurs mais l'historique sera conservé.`)) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/trucks?id=${t.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setTrucks(trucks.map(x => x.id === t.id ? { ...x, active: false } : x))
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  const visible = trucks.filter(t => showInactive || t.active)
  const activeTrucks = trucks.filter(t => t.active)

  async function assignDriverTruck(userId: string, truckId: string | null) {
    setSavingAssign(userId)
    setError(null)
    try {
      const res = await fetch('/api/admin/users/default-truck', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user_id: userId, default_truck_id: truckId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setDrivers(drivers.map(d => d.id === userId ? { ...d, default_truck_id: truckId } : d))
    } catch (e: any) {
      setError(e.message)
    } finally { setSavingAssign(null) }
  }

  async function toggleConfirmDisabled(userId: string, disabled: boolean) {
    setSavingAssign(userId)
    setError(null)
    try {
      const res = await fetch('/api/admin/users/default-truck', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user_id: userId, truck_confirm_disabled: disabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setDrivers(drivers.map(d => d.id === userId ? { ...d, truck_confirm_disabled: disabled } : d))
    } catch (e: any) {
      setError(e.message)
    } finally { setSavingAssign(null) }
  }

  return (
    <div className="min-h-screen bg-surface max-w-4xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">🚚 Dépanneuses</h1>
            <p className="text-ink-muted text-xs">Référentiel des véhicules VD utilisés par les chauffeurs.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-ink-secondary text-sm cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Afficher les désactivées
          </label>
          <button onClick={openCreate}
            className="px-4 py-2 bg-brand text-white rounded-xl text-sm font-semibold">
            + Nouvelle dépanneuse
          </button>
        </div>

        {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}

        {visible.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">
            Aucune dépanneuse. Clique "+ Nouvelle dépanneuse" pour commencer.
          </div>
        ) : (
          <>
          <h2 className="text-ink-muted text-xs font-medium uppercase tracking-wider mb-2 mt-4">Dépanneuses</h2>
          <ul className="space-y-2">
            {visible.map(t => (
              <li key={t.id} className={`bg-surface border rounded-2xl p-4 flex items-center gap-3 ${!t.active ? 'opacity-50' : ''}`}>
                <div className="text-2xl">🚚</div>
                <div className="flex-1 min-w-0">
                  <p className="text-ink font-semibold text-sm">{t.name} {!t.active && <span className="text-xs font-normal text-ink-faint">(désactivée)</span>}</p>
                  <p className="text-ink-muted text-xs font-mono">{t.plate}</p>
                  {(t.brand || t.model || t.year) && (
                    <p className="text-ink-faint text-xs mt-0.5">
                      {[t.brand, t.model, t.year].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {t.notes && <p className="text-ink-faint text-xs italic mt-1">{t.notes}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => openEdit(t)}
                    className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-xs">
                    Modifier
                  </button>
                  {t.active && (
                    <button onClick={() => softDelete(t)}
                      className="px-3 py-1.5 bg-critical/10 hover:bg-critical/20 border border-critical/30 text-critical rounded-lg text-xs">
                      Désactiver
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          </>
        )}

        {/* Section assignation chauffeurs - depanneuse par defaut */}
        {drivers.length > 0 && activeTrucks.length > 0 && (
          <>
            <h2 className="text-ink-muted text-xs font-medium uppercase tracking-wider mb-2 mt-6">
              👥 Assignations chauffeurs (dépanneuse par défaut)
            </h2>
            <p className="text-ink-faint text-xs mb-3">
              Le chauffeur peut changer ponctuellement via son app. L'app lui demande confirmation à 7h et 17h.
            </p>
            <ul className="space-y-1.5">
              {drivers.map(d => {
                const currentTruck = trucks.find(t => t.id === d.current_truck_id)
                const inUse = currentTruck && currentTruck.id !== d.default_truck_id
                return (
                  <li key={d.id} className="bg-surface border rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-ink font-medium text-sm">{d.name}</p>
                      <p className="text-ink-muted text-xs">{d.role}</p>
                      {inUse && (
                        <p className="text-amber-700 text-xs mt-0.5">
                          ⚠️ Actuellement sur {currentTruck.name} ({currentTruck.plate})
                        </p>
                      )}
                    </div>
                    <select
                      value={d.default_truck_id || ''}
                      onChange={e => assignDriverTruck(d.id, e.target.value || null)}
                      disabled={savingAssign === d.id || d.truck_confirm_disabled}
                      className="bg-surface-2 border rounded-lg px-2 py-1.5 text-ink text-xs min-w-[180px] disabled:opacity-50"
                    >
                      <option value="">— Aucune par défaut —</option>
                      {activeTrucks.map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.plate})</option>
                      ))}
                    </select>
                    {/* Toggle "Désactiver le modal" — Olivier 2026-06-01 */}
                    <label
                      title="Si coché, le modal de confirmation truck n'apparaîtra jamais pour cet user (ex: admin qui ne conduit pas)."
                      className="flex items-center gap-1.5 text-xs text-ink-secondary cursor-pointer flex-shrink-0 whitespace-nowrap"
                    >
                      <input
                        type="checkbox"
                        checked={!!d.truck_confirm_disabled}
                        onChange={e => toggleConfirmDisabled(d.id, e.target.checked)}
                        disabled={savingAssign === d.id}
                      />
                      Pas de modal
                    </label>
                    {savingAssign === d.id && <span className="text-ink-faint text-xs">⏳</span>}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      {/* Modal édition */}
      {editing && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4">
          <div className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-bold text-base">{editing.id ? '✏️ Modifier la dépanneuse' : '+ Nouvelle dépanneuse'}</h3>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Nom court *</label>
              <input type="text" value={editing.name || ''}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="Ex: Vanette 3, Plateau Iveco, ..."
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Plaque *</label>
              <input type="text" value={editing.plate || ''}
                onChange={e => setEditing({ ...editing, plate: e.target.value.toUpperCase() })}
                placeholder="Ex: 1ABC234"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm font-mono uppercase" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Marque</label>
                <input type="text" value={editing.brand || ''}
                  onChange={e => setEditing({ ...editing, brand: e.target.value })}
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
              </div>
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Modèle</label>
                <input type="text" value={editing.model || ''}
                  onChange={e => setEditing({ ...editing, model: e.target.value })}
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
              </div>
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Année</label>
                <input type="number" value={editing.year || ''}
                  onChange={e => setEditing({ ...editing, year: e.target.value ? parseInt(e.target.value, 10) : null })}
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Ordre (tri)</label>
              <input type="number" value={editing.sort_order ?? 100}
                onChange={e => setEditing({ ...editing, sort_order: parseInt(e.target.value, 10) || 100 })}
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Notes</label>
              <textarea rows={2} value={editing.notes || ''}
                onChange={e => setEditing({ ...editing, notes: e.target.value })}
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm resize-none" />
            </div>

            <label className="flex items-center gap-2 text-ink-secondary text-sm cursor-pointer">
              <input type="checkbox" checked={editing.active !== false}
                onChange={e => setEditing({ ...editing, active: e.target.checked })} />
              Active (visible dans les sélecteurs)
            </label>

            {error && <p className="text-critical text-xs">⚠ {error}</p>}

            <div className="flex gap-2">
              <button onClick={() => setEditing(null)} disabled={busy}
                className="flex-1 py-2.5 bg-surface-2 border text-ink-secondary rounded-xl text-sm">Annuler</button>
              <button onClick={save} disabled={busy || !editing.name || !editing.plate}
                className="flex-1 py-2.5 bg-brand text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {busy ? '⏳ ...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
