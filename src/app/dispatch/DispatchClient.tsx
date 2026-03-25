'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { usePathname } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mission {
  id: string
  external_id: string
  dossier_number: string | null
  source: string
  mission_type: string | null
  incident_type: string | null
  incident_description: string | null
  client_name: string | null
  client_phone: string | null
  vehicle_plate: string | null
  vehicle_brand: string | null
  vehicle_model: string | null
  incident_address: string | null
  incident_city: string | null
  destination_name: string | null
  destination_address: string | null
  received_at: string
  incident_at: string | null
  status: string
  dispatch_mode: string
  assigned_to: string | null
  assigned_at: string | null
  parse_confidence: number | null
  assigned_user: { id: string; name: string; avatar_url: string | null } | null
}

interface Driver {
  id: string
  name: string
  avatar_url: string | null
}

interface Counters {
  new: number
  assigned: number
  in_progress: number
  completed: number
  errors: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  touring:  { label: 'TOURING',  color: 'bg-blue-600' },
  ethias:   { label: 'ETHIAS',   color: 'bg-green-600' },
  vivium:   { label: 'VIVIUM',   color: 'bg-purple-600' },
  axa:      { label: 'AXA',      color: 'bg-red-600' },
  ardenne:  { label: 'ARDENNE',  color: 'bg-orange-600' },
  mondial:  { label: 'MONDIAL',  color: 'bg-teal-600' },
  vab:      { label: 'VAB',      color: 'bg-yellow-600' },
  unknown:  { label: '?',        color: 'bg-zinc-600' },
}

const TYPE_LABELS: Record<string, string> = {
  remorquage:      '🚛 Remorquage',
  depannage:       '🔧 Dépannage',
  transport:       '🚐 Transport',
  trajet_vide:     '📍 Trajet vide',
  reparation_place:'🔩 Réparation',
  autre:           '📋 Autre',
}

function getDelai(received_at: string): { label: string; urgent: boolean } {
  const diff = Date.now() - new Date(received_at).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return { label: `${mins}min`, urgent: mins > 20 }
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return { label: `${h}h${m.toString().padStart(2,'0')}`, urgent: h > 1 }
}

const TABS = [
  { key: 'new',         label: 'En attente',  countKey: 'new' as const },
  { key: 'assigned',    label: 'Assignées',   countKey: 'assigned' as const },
  { key: 'in_progress', label: 'En cours',    countKey: 'in_progress' as const },
  { key: 'completed',   label: 'Terminées',   countKey: 'completed' as const },
  { key: 'all',         label: 'Toutes',      countKey: null },
]

const SOURCES = ['', 'touring', 'ethias', 'vivium', 'axa', 'ardenne', 'mondial', 'vab']

const NAV_ITEMS = [
  { href: '/dashboard',  label: 'Dashboard',  icon: '🏠' },
  { href: '/dispatch',   label: 'Dispatch',   icon: '📡' },
  { href: '/admin',      label: 'Admin',      icon: '⚙️' },
  { href: '/profil',     label: 'Mon Profil', icon: '👤' },
]

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ userName, userRole }: { userName: string; userRole: string }) {
  const pathname = usePathname()
  const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'

  return (
    <aside className="hidden lg:flex flex-col w-64 min-h-screen bg-[#1A1A1A] border-r border-[#2a2a2a] fixed top-0 left-0 h-full z-30">
      <div className="px-6 py-5 border-b border-[#2a2a2a]">
        <Link href="/dashboard">
          <img src="/logo.jpg" alt="Verviers Dépannage" className="h-10 w-auto object-contain" />
        </Link>
      </div>
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {NAV_ITEMS.map(item => {
          const active = pathname.startsWith(item.href) && (item.href !== '/dashboard' || pathname === '/dashboard')
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active ? 'bg-brand/10 text-white border border-brand/20' : 'text-zinc-400 hover:text-white hover:bg-[#2a2a2a]'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="px-3 py-4 border-t border-[#2a2a2a]">
        <div className="flex items-center gap-3 px-3 py-2.5 mb-1">
          <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-bold text-xs">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{userName}</p>
            <p className="text-zinc-500 text-xs capitalize">{userRole}</p>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all w-full"
        >
          <span>🚪</span> Déconnexion
        </button>
      </div>
    </aside>
  )
}

// ── Modal détail / assignation ────────────────────────────────────────────────

function MissionModal({
  mission,
  drivers,
  onClose,
  onAssign,
}: {
  mission: Mission
  drivers: Driver[]
  onClose: () => void
  onAssign: (driverId: string | null) => Promise<void>
}) {
  const [selectedDriver, setSelectedDriver] = useState(mission.assigned_to || '')
  const [loading, setLoading] = useState(false)

  const handleAssign = async () => {
    setLoading(true)
    await onAssign(selectedDriver || null)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
          <div className="flex items-center gap-3">
            <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${SOURCE_LABELS[mission.source]?.color || 'bg-zinc-600'}`}>
              {SOURCE_LABELS[mission.source]?.label || mission.source.toUpperCase()}
            </span>
            <span className="text-white font-mono text-sm">{mission.external_id}</span>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Type + incident */}
          <div>
            <p className="text-zinc-500 text-xs mb-1">Mission</p>
            <p className="text-white font-semibold">
              {mission.mission_type ? TYPE_LABELS[mission.mission_type] || mission.mission_type : '—'}
            </p>
            {mission.incident_type && (
              <p className="text-zinc-400 text-sm mt-1">{mission.incident_type}</p>
            )}
            {mission.incident_description && (
              <p className="text-zinc-500 text-xs mt-2 italic">{mission.incident_description}</p>
            )}
          </div>

          {/* Client */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-zinc-500 text-xs mb-1">Client</p>
              <p className="text-white text-sm">{mission.client_name || '—'}</p>
              {mission.client_phone && (
                <a href={`tel:${mission.client_phone}`} className="text-brand text-sm hover:underline">
                  {mission.client_phone}
                </a>
              )}
            </div>
            <div>
              <p className="text-zinc-500 text-xs mb-1">Véhicule</p>
              <p className="text-white text-sm font-mono">
                {[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ') || '—'}
              </p>
              {mission.vehicle_plate && (
                <p className="text-zinc-300 text-sm font-bold">{mission.vehicle_plate}</p>
              )}
            </div>
          </div>

          {/* Localisation */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-zinc-500 text-xs mb-1">📍 Lieu d'incident</p>
              <p className="text-white text-sm">{mission.incident_address || '—'}</p>
              {mission.incident_city && (
                <p className="text-zinc-400 text-xs">{mission.incident_city}</p>
              )}
            </div>
            <div>
              <p className="text-zinc-500 text-xs mb-1">🏁 Destination</p>
              <p className="text-white text-sm">
                {mission.destination_name || mission.destination_address || '—'}
              </p>
            </div>
          </div>

          {/* Dossier */}
          <div className="bg-[#111] rounded-xl px-4 py-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-zinc-500 text-xs">N° Commande</span>
                <p className="text-zinc-200 font-mono">{mission.external_id}</p>
              </div>
              <div>
                <span className="text-zinc-500 text-xs">N° Dossier</span>
                <p className="text-zinc-200 font-mono">{mission.dossier_number || '—'}</p>
              </div>
              <div>
                <span className="text-zinc-500 text-xs">Reçu le</span>
                <p className="text-zinc-200">{new Date(mission.received_at).toLocaleString('fr-BE')}</p>
              </div>
              <div>
                <span className="text-zinc-500 text-xs">Incident</span>
                <p className="text-zinc-200">
                  {mission.incident_at ? new Date(mission.incident_at).toLocaleString('fr-BE') : '—'}
                </p>
              </div>
            </div>
          </div>

          {/* Assignation */}
          <div>
            <p className="text-zinc-500 text-xs mb-2">Assigner à un chauffeur</p>
            <div className="flex gap-2">
              <select
                value={selectedDriver}
                onChange={e => setSelectedDriver(e.target.value)}
                className="flex-1 bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand"
              >
                <option value="">— Non assigné —</option>
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <button
                onClick={handleAssign}
                disabled={loading}
                className="px-4 py-2.5 bg-brand hover:bg-brand-dark text-white rounded-xl text-sm font-medium transition disabled:opacity-50"
              >
                {loading ? '...' : 'Assigner'}
              </button>
            </div>
            {mission.assigned_user && (
              <p className="text-zinc-500 text-xs mt-2">
                Actuellement assigné à <span className="text-white">{mission.assigned_user.name}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function DispatchClient({
  drivers,
  userName,
  userRole,
}: {
  drivers: Driver[]
  userName: string
  userRole: string
}) {
  const [activeTab,   setActiveTab]   = useState('new')
  const [sourceFilter, setSourceFilter] = useState('')
  const [missions,    setMissions]    = useState<Mission[]>([])
  const [counters,    setCounters]    = useState<Counters>({ new: 0, assigned: 0, in_progress: 0, completed: 0, errors: 0 })
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState<Mission | null>(null)
  const [search,      setSearch]      = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status: activeTab })
      if (sourceFilter) params.set('source', sourceFilter)
      const res = await fetch(`/api/missions/list?${params}`)
      const data = await res.json()
      setMissions(data.missions || [])
      setCounters(data.counters || { new: 0, assigned: 0, in_progress: 0, completed: 0, errors: 0 })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [activeTab, sourceFilter])

  useEffect(() => { load() }, [load])

  // Actualisation auto toutes les 30s
  useEffect(() => {
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [load])

  const handleAssign = async (driverId: string | null) => {
    if (!selected) return
    await fetch('/api/missions/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission_id: selected.id, driver_id: driverId })
    })
    setSelected(null)
    await load()
  }

  // Filtrage local par recherche
  const filtered = missions.filter(m => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      m.external_id?.toLowerCase().includes(s) ||
      m.dossier_number?.toLowerCase().includes(s) ||
      m.client_name?.toLowerCase().includes(s) ||
      m.vehicle_plate?.toLowerCase().includes(s) ||
      m.incident_city?.toLowerCase().includes(s) ||
      m.vehicle_brand?.toLowerCase().includes(s)
    )
  })

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex">
      <Sidebar userName={userName} userRole={userRole} />

      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        {/* Header */}
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-8 py-5 sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-white font-bold text-2xl">Dispatch missions</h1>
              <p className="text-zinc-500 text-sm mt-0.5">
                {counters.new} en attente · Actualisation auto toutes les 30s
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Recherche */}
              <input
                type="text"
                placeholder="Rechercher..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm w-48 focus:outline-none focus:border-brand placeholder:text-zinc-600"
              />
              {/* Filtre source */}
              <select
                value={sourceFilter}
                onChange={e => setSourceFilter(e.target.value)}
                className="bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand"
              >
                <option value="">Toutes sources</option>
                {SOURCES.filter(Boolean).map(s => (
                  <option key={s} value={s}>{SOURCE_LABELS[s]?.label || s.toUpperCase()}</option>
                ))}
              </select>
              {/* Refresh */}
              <button
                onClick={load}
                className="p-2 bg-[#111] border border-[#2a2a2a] rounded-xl text-zinc-400 hover:text-white transition"
                title="Actualiser"
              >
                ↻
              </button>
            </div>
          </div>

          {/* Onglets statut */}
          <div className="flex gap-1 mt-4 overflow-x-auto">
            {TABS.map(tab => {
              const count = tab.countKey ? counters[tab.countKey] : null
              const active = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                    active
                      ? 'bg-brand text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-[#2a2a2a]'
                  }`}
                >
                  {tab.label}
                  {count !== null && count > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                      active ? 'bg-white/20 text-white' : 'bg-[#2a2a2a] text-zinc-300'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tableau */}
        <main className="flex-1 overflow-auto px-8 py-6">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              Chargement...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
              <p className="text-4xl mb-4">📋</p>
              <p>Aucune mission dans cette catégorie</p>
            </div>
          ) : (
            <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#2a2a2a] text-zinc-400 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-medium">Source</th>
                    <th className="px-4 py-3 text-left font-medium">Dossier</th>
                    <th className="px-4 py-3 text-left font-medium">Client</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Délai</th>
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Véhicule</th>
                    <th className="px-4 py-3 text-left font-medium">Lieu d'incident</th>
                    <th className="px-4 py-3 text-left font-medium">Destination</th>
                    <th className="px-4 py-3 text-left font-medium">Chauffeur</th>
                    <th className="px-4 py-3 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222]">
                  {filtered.map(m => {
                    const delai   = getDelai(m.received_at)
                    const srcInfo = SOURCE_LABELS[m.source] || { label: m.source.toUpperCase(), color: 'bg-zinc-600' }
                    const urgent  = delai.urgent && m.status === 'new'

                    return (
                      <tr
                        key={m.id}
                        className={`transition hover:bg-[#222] ${urgent ? 'bg-yellow-500/5' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${srcInfo.color}`}>
                            {srcInfo.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white font-mono text-xs">{m.external_id}</p>
                          {m.dossier_number && (
                            <p className="text-zinc-500 text-xs">{m.dossier_number}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white">{m.client_name || '—'}</p>
                          {m.client_phone && (
                            <a href={`tel:${m.client_phone}`} className="text-zinc-400 text-xs hover:text-brand">
                              {m.client_phone}
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-400 text-xs whitespace-nowrap">
                          {new Date(m.received_at).toLocaleDateString('fr-BE')}
                          <br />
                          {new Date(m.received_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold ${delai.urgent ? 'text-red-400' : 'text-green-400'}`}>
                            {delai.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-300 text-xs">
                          {m.mission_type ? TYPE_LABELS[m.mission_type] || m.mission_type : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {m.vehicle_plate && (
                            <p className="text-white font-bold font-mono text-xs">{m.vehicle_plate}</p>
                          )}
                          <p className="text-zinc-400 text-xs">
                            {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white text-xs">{m.incident_address || '—'}</p>
                          {m.incident_city && (
                            <p className="text-zinc-500 text-xs">{m.incident_city}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-400 text-xs">
                          {m.destination_name || m.destination_address || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {m.assigned_user ? (
                            <span className="text-green-400 text-xs font-medium">
                              {m.assigned_user.name}
                            </span>
                          ) : (
                            <span className="text-zinc-600 text-xs">Non assigné</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setSelected(m)}
                            className="px-3 py-1.5 bg-brand hover:bg-brand-dark text-white rounded-lg text-xs font-medium transition"
                          >
                            VOIR
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      {/* Modal */}
      {selected && (
        <MissionModal
          mission={selected}
          drivers={drivers}
          onClose={() => setSelected(null)}
          onAssign={handleAssign}
        />
      )}
    </div>
  )
}
