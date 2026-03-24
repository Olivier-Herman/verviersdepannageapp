'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Loader2, Save, ChevronLeft, Truck, ClipboardList, Users } from 'lucide-react'
import AdminNav from '../../AdminNav'
import type { CheckVehicle, CheckTemplateItem } from '@/types'

type TabKey = 'vehicles' | 'checklist' | 'responsables'
const CATEGORIES = ['Documents', 'Matériel', 'Carrosserie', 'Mécanique'] as const

export default function CheckVehiculeSettingsClient() {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('vehicles')

  const [vehicles, setVehicles]         = useState<CheckVehicle[]>([])
  const [newVehicle, setNewVehicle]     = useState({ name: '', plate: '', usual_driver_id: '' })
  const [savingVehicle, setSavingVehicle] = useState(false)

  const [items, setItems]         = useState<CheckTemplateItem[]>([])
  const [newItem, setNewItem]     = useState({ label: '', category: 'Documents' })
  const [savingItem, setSavingItem] = useState(false)

  const [allUsers, setAllUsers]           = useState<any[]>([])
  const [responsibleIds, setResponsibleIds] = useState<string[]>([])
  const [savingResp, setSavingResp]       = useState(false)

  const [loading, setLoading] = useState(true)
  const [msg, setMsg]         = useState('')

  useEffect(() => {
    fetch('/api/admin/check-vehicule/settings')
      .then(r => r.json())
      .then(data => {
        setVehicles(data.vehicles || [])
        setItems(data.items || [])
        setAllUsers(data.users || [])
        setResponsibleIds(data.responsibleIds || [])
      })
      .finally(() => setLoading(false))
  }, [])

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  // ── Véhicules ──
  const addVehicle = async () => {
    if (!newVehicle.name || !newVehicle.plate) return
    setSavingVehicle(true)
    const res  = await fetch('/api/admin/check-vehicule/settings/vehicles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newVehicle),
    })
    const data = await res.json()
    if (res.ok) {
      setVehicles(v => [...v, data.vehicle])
      setNewVehicle({ name: '', plate: '', usual_driver_id: '' })
      showMsg('Véhicule ajouté')
    }
    setSavingVehicle(false)
  }

  const toggleVehicle = async (id: string, active: boolean) => {
    await fetch(`/api/admin/check-vehicule/settings/vehicles/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    })
    setVehicles(v => v.map(x => x.id === id ? { ...x, active: !active } : x))
  }

  const deleteVehicle = async (id: string) => {
    if (!confirm('Supprimer ce véhicule ?')) return
    await fetch(`/api/admin/check-vehicule/settings/vehicles/${id}`, { method: 'DELETE' })
    setVehicles(v => v.filter(x => x.id !== id))
    showMsg('Véhicule supprimé')
  }

  // ── Checklist ──
  const addItem = async () => {
    if (!newItem.label) return
    setSavingItem(true)
    const res  = await fetch('/api/admin/check-vehicule/settings/items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newItem, order_index: items.length + 1 }),
    })
    const data = await res.json()
    if (res.ok) {
      setItems(i => [...i, data.item])
      setNewItem({ label: '', category: 'Documents' })
      showMsg('Point de contrôle ajouté')
    }
    setSavingItem(false)
  }

  const toggleItem = async (id: string, active: boolean) => {
    await fetch(`/api/admin/check-vehicule/settings/items/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    })
    setItems(i => i.map(x => x.id === id ? { ...x, active: !active } : x))
  }

  const deleteItem = async (id: string) => {
    if (!confirm('Supprimer ce point de contrôle ?')) return
    await fetch(`/api/admin/check-vehicule/settings/items/${id}`, { method: 'DELETE' })
    setItems(i => i.filter(x => x.id !== id))
    showMsg('Point supprimé')
  }

  // ── Responsables ──
  const saveResponsables = async () => {
    setSavingResp(true)
    await fetch('/api/admin/check-vehicule/settings/responsables', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: responsibleIds }),
    })
    showMsg('Responsables enregistrés')
    setSavingResp(false)
  }

  if (loading) {
    return (
      <div>
        <AdminNav />
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-brand" size={28} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <AdminNav />
      <div className="max-w-2xl mx-auto p-4 space-y-5">

        <div className="flex items-center gap-3 mt-2">
          <button onClick={() => router.back()} className="text-zinc-400 hover:text-white transition">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-xl font-bold text-white">Paramètres — Check Véhicule</h1>
        </div>

        {msg && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 text-green-300 text-sm text-center">
            {msg}
          </div>
        )}

        {/* Onglets */}
        <div className="flex bg-surface border border-border rounded-xl p-1 gap-1">
          {([
            { key: 'vehicles',     label: 'Flotte',        icon: Truck        },
            { key: 'checklist',    label: 'Checklist',     icon: ClipboardList},
            { key: 'responsables', label: 'Responsables',  icon: Users        },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition ${
                tab === key ? 'bg-brand text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {/* ── FLOTTE ── */}
        {tab === 'vehicles' && (
          <div className="space-y-2">
            {vehicles.map(v => (
              <div key={v.id}
                className={`flex items-center gap-3 bg-surface border rounded-xl p-3 ${v.active ? 'border-border' : 'border-zinc-700 opacity-50'}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm">{v.name}</p>
                  <p className="text-zinc-400 text-xs">
                    {v.plate}
                    {v.driver && ` · ${v.driver.name}`}
                  </p>
                </div>
                <button onClick={() => toggleVehicle(v.id, v.active)}
                  className={`text-xs px-2 py-1 rounded transition ${v.active ? 'bg-green-900/40 text-green-400' : 'bg-zinc-800 text-zinc-500'}`}
                >
                  {v.active ? 'Actif' : 'Inactif'}
                </button>
                <button onClick={() => deleteVehicle(v.id)} className="text-zinc-600 hover:text-red-400 transition p-1">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}

            <div className="bg-surface border border-zinc-700 border-dashed rounded-xl p-4 space-y-3 mt-3">
              <p className="text-zinc-400 text-sm font-medium">Ajouter un véhicule</p>
              <input value={newVehicle.name}
                onChange={e => setNewVehicle(p => ({ ...p, name: e.target.value }))}
                placeholder="Nom (ex : Camion 1)"
                className="w-full bg-zinc-800 text-white rounded-lg px-3 py-2.5 text-sm border border-border focus:outline-none focus:border-brand"
              />
              <input value={newVehicle.plate}
                onChange={e => setNewVehicle(p => ({ ...p, plate: e.target.value.toUpperCase() }))}
                placeholder="Immatriculation (ex : 1-ABC-123)"
                className="w-full bg-zinc-800 text-white rounded-lg px-3 py-2.5 text-sm border border-border focus:outline-none focus:border-brand"
              />
              <select value={newVehicle.usual_driver_id}
                onChange={e => setNewVehicle(p => ({ ...p, usual_driver_id: e.target.value }))}
                className="w-full bg-zinc-800 text-white rounded-lg px-3 py-2.5 text-sm border border-border focus:outline-none focus:border-brand"
              >
                <option value="">— Conducteur habituel (optionnel)</option>
                {allUsers
                  .filter(u => ['driver', 'dispatcher'].includes(u.role))
                  .map(u => <option key={u.id} value={u.id}>{u.name}</option>)
                }
              </select>
              <button onClick={addVehicle}
                disabled={savingVehicle || !newVehicle.name || !newVehicle.plate}
                className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
              >
                {savingVehicle ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
                Ajouter
              </button>
            </div>
          </div>
        )}

        {/* ── CHECKLIST ── */}
        {tab === 'checklist' && (
          <div className="space-y-4">
            {CATEGORIES.map(cat => {
              const catItems = items.filter(i => i.category === cat)
              if (catItems.length === 0) return null
              return (
                <div key={cat}>
                  <p className="text-brand text-xs font-semibold uppercase tracking-wider mb-2">{cat}</p>
                  <div className="space-y-1.5">
                    {catItems.map(item => (
                      <div key={item.id}
                        className={`flex items-center gap-3 bg-surface border rounded-xl p-3 ${item.active ? 'border-border' : 'border-zinc-700 opacity-50'}`}
                      >
                        <span className="flex-1 text-sm text-white">{item.label}</span>
                        <button onClick={() => toggleItem(item.id, item.active)}
                          className={`text-xs px-2 py-1 rounded transition ${item.active ? 'bg-green-900/40 text-green-400' : 'bg-zinc-800 text-zinc-500'}`}
                        >
                          {item.active ? 'Actif' : 'Inactif'}
                        </button>
                        <button onClick={() => deleteItem(item.id)} className="text-zinc-600 hover:text-red-400 transition p-1">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            <div className="bg-surface border border-zinc-700 border-dashed rounded-xl p-4 space-y-3 mt-2">
              <p className="text-zinc-400 text-sm font-medium">Ajouter un point de contrôle</p>
              <input value={newItem.label}
                onChange={e => setNewItem(p => ({ ...p, label: e.target.value }))}
                placeholder="Libellé du point de contrôle"
                className="w-full bg-zinc-800 text-white rounded-lg px-3 py-2.5 text-sm border border-border focus:outline-none focus:border-brand"
              />
              <select value={newItem.category}
                onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))}
                className="w-full bg-zinc-800 text-white rounded-lg px-3 py-2.5 text-sm border border-border focus:outline-none focus:border-brand"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={addItem}
                disabled={savingItem || !newItem.label}
                className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
              >
                {savingItem ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
                Ajouter
              </button>
            </div>
          </div>
        )}

        {/* ── RESPONSABLES ── */}
        {tab === 'responsables' && (
          <div className="space-y-3">
            <p className="text-zinc-400 text-sm">
              Ces personnes recevront les notifications push lors du déclenchement d'un contrôle.
            </p>
            {allUsers
              .filter(u => ['admin', 'superadmin', 'dispatcher'].includes(u.role))
              .map(u => (
                <label key={u.id}
                  className="flex items-center gap-3 bg-surface border border-border rounded-xl p-3 cursor-pointer hover:border-zinc-600 transition"
                >
                  <input type="checkbox"
                    checked={responsibleIds.includes(u.id)}
                    onChange={e => setResponsibleIds(prev =>
                      e.target.checked ? [...prev, u.id] : prev.filter(id => id !== u.id)
                    )}
                    className="w-4 h-4 accent-brand"
                  />
                  <div className="flex-1">
                    <p className="text-white text-sm font-medium">{u.name}</p>
                    <p className="text-zinc-500 text-xs">{u.email} · {u.role}</p>
                  </div>
                </label>
              ))
            }
            <button onClick={saveResponsables} disabled={savingResp}
              className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white font-semibold px-6 py-3 rounded-xl transition disabled:opacity-50 mt-2"
            >
              {savingResp ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
              Enregistrer
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
