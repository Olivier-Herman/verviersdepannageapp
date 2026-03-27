'use client'
// src/app/dispatch/DispatchClient.tsx
// P6 — toggle liste/carte + panel statut chauffeurs + cartes colorées par urgence

import { useState, useEffect, useCallback } from 'react'
import Link        from 'next/link'
import { useRouter }   from 'next/navigation'
import { signOut }     from 'next-auth/react'
import { usePathname } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mission {
  id: string
  external_id: string
  dossier_number: string | null
  source: string
  mission_type: string | null
  incident_type: string | null
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
  assigned_to: string | null
  parse_confidence: number | null
  assigned_user: { id: string; name: string } | null
  warnings?: string[] | null
}

interface Driver {
  id: string
  name: string
  avatar_url: string | null
}

interface DriverStatus {
  id: string
  name: string
  status: 'libre' | 'en_mission'
  mission_id?: string
  client_name?: string
  mission_type?: string
}

interface Counters {
  new: number
  dispatching: number
  assigned: number
  in_progress: number
  parked: number
  completed: number
  errors: number
}

type ViewMode = 'list' | 'card'

// ── Helpers & Constantes ──────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  touring:  { label: 'TOURING',  color: 'bg-blue-600'   },
  ethias:   { label: 'ETHIAS',   color: 'bg-green-600'  },
  vivium:   { label: 'VIVIUM',   color: 'bg-purple-600' },
  axa:      { label: 'IPA',      color: 'bg-red-600'    },
  ardenne:  { label: 'ARDENNE',  color: 'bg-orange-600' },
  mondial:  { label: 'MONDIAL',  color: 'bg-teal-600'   },
  vab:      { label: 'VAB',      color: 'bg-yellow-600' },
  police:   { label: 'POLICE',   color: 'bg-blue-900'   },
  prive:    { label: 'PRIVÉ',    color: 'bg-zinc-700'   },
  garage:   { label: 'GARAGE',   color: 'bg-amber-700'  },
  unknown:  { label: '?',        color: 'bg-zinc-600'   },
}

const TYPE_LABELS: Record<string, string> = {
  remorquage:       '🚛 REM',
  depannage:        '🔧 DSP',
  transport:        '🚐 Transport',
  trajet_vide:      '📍 TVD',
  reparation_place: '🔩 RPL',
  DSP:              '🔧 DSP',
  REM:              '🚛 REM',
  Transport:        '🚐 Transport',
  DPR:              '📍 DPR',
  VR:               '🚗 VR',
  autre:            '📋 Autre',
}

const TABS = [
  { key: 'new',         label: 'En commande', countKey: 'new'         as const },
  { key: 'dispatching', label: 'En attente',  countKey: 'dispatching' as const },
  { key: 'assigned',    label: 'Assignées',   countKey: 'assigned'    as const },
  { key: 'in_progress', label: 'En cours',    countKey: 'in_progress' as const },
  { key: 'parked',      label: 'En Parc',     countKey: 'parked'      as const },
  { key: 'completed',   label: 'Terminées',   countKey: 'completed'   as const },
  { key: 'all',         label: 'Toutes',      countKey: null },
]

const SOURCES = ['touring','ethias','vivium','axa','ardenne','mondial','vab','police','prive','garage']

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/dispatch',  label: 'Dispatch',  icon: '📡' },
  { href: '/admin',     label: 'Admin',     icon: '⚙️' },
  { href: '/profil',    label: 'Mon Profil',icon: '👤' },
]

function getDelai(received_at: string): { label: string; color: string; urgency: 'ok'|'warn'|'alert'|'critical' } {
  const mins  = Math.floor((Date.now() - new Date(received_at).getTime()) / 60000)
  const label = mins < 60
    ? `${mins}min`
    : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`
  if (mins < 15) return { label, color: 'text-green-400',  urgency: 'ok'       }
  if (mins < 30) return { label, color: 'text-yellow-400', urgency: 'warn'     }
  if (mins < 60) return { label, color: 'text-orange-400', urgency: 'alert'    }
  return             { label, color: 'text-red-400',    urgency: 'critical' }
}

const URGENCY_BORDER: Record<string, string> = {
  ok:       'border-[#2a2a2a]',
  warn:     'border-yellow-500/30',
  alert:    'border-orange-500/40',
  critical: 'border-red-500/50 animate-pulse',
}

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
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active ? 'bg-brand/10 text-white border border-brand/20' : 'text-zinc-400 hover:text-white hover:bg-[#2a2a2a]'
              }`}>
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="px-3 py-4 border-t border-[#2a2a2a]">
        <div className="flex items-center gap-3 px-3 py-2.5 mb-1">
          <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{userName}</p>
            <p className="text-zinc-500 text-xs capitalize">{userRole}</p>
          </div>
        </div>
        <button onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all w-full">
          <span className="text-base">🚪</span>
          Déconnexion
        </button>
      </div>
    </aside>
  )
}

// ── Panel statut chauffeurs ───────────────────────────────────────────────────

function DriverStatusPanel({ statuses }: { statuses: DriverStatus[] }) {
  if (statuses.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2 px-8 py-3 bg-[#111] border-b border-[#2a2a2a]">
      {statuses.map(d => (
        <div key={d.id}
          title={d.status === 'en_mission' ? `${d.client_name || '?'} · ${d.mission_type || ''}` : 'Disponible'}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium ${
            d.status === 'en_mission'
              ? 'bg-orange-500/10 border-orange-500/30 text-orange-300'
              : 'bg-green-500/10  border-green-500/20  text-green-400'
          }`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            d.status === 'en_mission' ? 'bg-orange-400' : 'bg-green-400'
          }`} />
          {d.name}
          {d.status === 'en_mission' && (
            <span className="text-orange-500/70 font-normal">· En mission</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Assign Dropdown inline ────────────────────────────────────────────────────

function AssignDropdown({ mission, drivers, driverStatuses, onAssigned }: {
  mission:        Mission
  drivers:        Driver[]
  driverStatuses: DriverStatus[]
  onAssigned:     () => void
}) {
  const [loading, setLoading] = useState(false)
  const statusMap = new Map(driverStatuses.map(d => [d.id, d]))

  const assign = async (driverId: string) => {
    setLoading(true)
    try {
      await fetch('/api/missions/assign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: mission.id, driver_id: driverId }),
      })
      onAssigned()
    } finally { setLoading(false) }
  }

  return (
    <select
      defaultValue=""
      disabled={loading}
      onChange={e => e.target.value && assign(e.target.value)}
      onClick={e => e.stopPropagation()}
      className="bg-[#111] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-zinc-300 text-xs focus:outline-none focus:border-brand cursor-pointer disabled:opacity-50"
    >
      <option value="" disabled>
        {loading ? 'Assignation…' : (mission.assigned_user ? mission.assigned_user.name : '— Assigner —')}
      </option>
      {drivers.map(d => {
        const ds = statusMap.get(d.id)
        return (
          <option key={d.id} value={d.id}>
            {d.name}{ds?.status === 'en_mission' ? ' 🟠' : ' 🟢'}
          </option>
        )
      })}
    </select>
  )
}

// ── Vue CARTE — MissionCard ───────────────────────────────────────────────────

function MissionCard({ mission, drivers, driverStatuses, onRefresh }: {
  mission:        Mission
  drivers:        Driver[]
  driverStatuses: DriverStatus[]
  onRefresh:      () => void
}) {
  const router  = useRouter()
  const delai   = getDelai(mission.received_at)
  const srcInfo = SOURCE_LABELS[mission.source] || { label: '?', color: 'bg-zinc-600' }

  return (
    <div
      onClick={() => router.push(`/dispatch/${mission.id}`)}
      className={`bg-[#1A1A1A] border-2 rounded-2xl p-4 cursor-pointer hover:bg-[#222] transition-all ${URGENCY_BORDER[delai.urgency]}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${srcInfo.color}`}>{srcInfo.label}</span>
          {mission.mission_type && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#2a2a2a] text-zinc-300">
              {TYPE_LABELS[mission.mission_type] || mission.mission_type}
            </span>
          )}
        </div>
        <span className={`text-xs font-bold ${delai.color} flex-shrink-0`}>⏱ {delai.label}</span>
      </div>

      {/* Client */}
      <p className="text-white font-semibold text-sm mb-1 leading-tight">
        {mission.client_name || <span className="text-zinc-500">Client inconnu</span>}
      </p>
      {mission.client_phone && (
        <a href={`tel:${mission.client_phone}`} onClick={e => e.stopPropagation()}
          className="text-brand text-xs hover:underline block mb-2">
          📞 {mission.client_phone}
        </a>
      )}

      {/* Véhicule */}
      {(mission.vehicle_plate || mission.vehicle_brand) && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-zinc-500 text-xs">🚘</span>
          {mission.vehicle_plate && <span className="text-white font-bold font-mono text-xs">{mission.vehicle_plate}</span>}
          {(mission.vehicle_brand || mission.vehicle_model) && (
            <span className="text-zinc-400 text-xs">{[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')}</span>
          )}
        </div>
      )}

      {/* Lieu */}
      {(mission.incident_address || mission.incident_city) && (
        <p className="text-zinc-400 text-xs mb-1 truncate">
          📍 {mission.incident_address}{mission.incident_city ? `, ${mission.incident_city}` : ''}
        </p>
      )}

      {/* Destination */}
      {(mission.destination_address || mission.destination_name) && (
        <p className="text-zinc-500 text-xs mb-2 truncate">
          🏁 {mission.destination_name || mission.destination_address}
        </p>
      )}

      {/* Warnings */}
      {mission.warnings && mission.warnings.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {mission.warnings.map((w, i) => (
            <span key={i} className="px-2 py-0.5 bg-orange-500/20 border border-orange-500/30 rounded text-orange-300 text-xs">
              ⚠️ {w}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-[#2a2a2a]">
        <div onClick={e => e.stopPropagation()} className="flex items-center gap-2 flex-1 min-w-0">
          {mission.status !== 'completed' && (
            <AssignDropdown mission={mission} drivers={drivers} driverStatuses={driverStatuses} onAssigned={onRefresh} />
          )}
          {mission.assigned_user && (
            <span className="text-green-400 text-xs font-medium">✓ {mission.assigned_user.name}</span>
          )}
        </div>
        <Link href={`/dispatch/${mission.id}`} onClick={e => e.stopPropagation()}
          className="px-3 py-1.5 bg-brand hover:bg-brand-dark text-white rounded-lg text-xs font-medium transition flex-shrink-0">
          VOIR →
        </Link>
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
  drivers:  Driver[]
  userName: string
  userRole: string
}) {
  const router = useRouter()

  const [activeTab,      setActiveTab]      = useState('new')
  const [sourceFilter,   setSourceFilter]   = useState('')
  const [missions,       setMissions]       = useState<Mission[]>([])
  const [counters,       setCounters]       = useState<Counters>({ new: 0, dispatching: 0, assigned: 0, in_progress: 0, completed: 0, errors: 0 })
  const [loading,        setLoading]        = useState(true)
  const [search,         setSearch]         = useState('')
  const [dispatchMode,   setDispatchMode]   = useState<'manual'|'auto'>('manual')
  const [modeLoading,    setModeLoading]    = useState(false)
  const [viewMode,       setViewMode]       = useState<ViewMode>('list')
  const [driverStatuses, setDriverStatuses] = useState<DriverStatus[]>([])

  // Charge la préférence de vue sauvegardée
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vd_dispatch_view') as ViewMode | null
      if (saved === 'list' || saved === 'card') setViewMode(saved)
    } catch { /* SSR / private browsing */ }
  }, [])

  const switchView = (v: ViewMode) => {
    setViewMode(v)
    try { localStorage.setItem('vd_dispatch_view', v) } catch { /* ignore */ }
  }

  // ── Chargement missions + statuts chauffeurs ──────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status: activeTab })
      if (sourceFilter) params.set('source', sourceFilter)
      if (search)       params.set('q', search)

      const [mRes, sRes] = await Promise.all([
        fetch(`/api/missions/list?${params}`),
        fetch('/api/users/driver-status'),
      ])
      const mData = await mRes.json()
      const sData = await sRes.json()
      setMissions(mData.missions  || [])
      setCounters(mData.counters  || { new: 0, dispatching: 0, assigned: 0, in_progress: 0, parked: 0, completed: 0, errors: 0 })
      setDriverStatuses(sData.drivers || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [activeTab, sourceFilter, search])

  useEffect(() => { load() }, [load])

  // Charge le dispatch mode
  useEffect(() => {
    fetch('/api/missions/dispatch-mode')
      .then(r => r.json())
      .then(d => { if (d.mode) setDispatchMode(d.mode) })
      .catch(() => {})
  }, [])

  const toggleMode = async () => {
    const newMode = dispatchMode === 'manual' ? 'auto' : 'manual'
    setModeLoading(true)
    try {
      await fetch('/api/missions/dispatch-mode', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      })
      setDispatchMode(newMode)
    } finally { setModeLoading(false) }
  }

  // ── Filtrage client-side ──────────────────────────────────────────────────

  const filtered = missions.filter(m => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      m.client_name?.toLowerCase().includes(q) ||
      m.external_id?.toLowerCase().includes(q)  ||
      m.vehicle_plate?.toLowerCase().includes(q) ||
      m.incident_address?.toLowerCase().includes(q)
    )
  })

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex">
      <Sidebar userName={userName} userRole={userRole} />

      <div className="flex-1 flex flex-col lg:ml-64 min-h-screen">

        {/* ── Barre de contrôle ────────────────────────────────────────── */}
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-6 py-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-white font-bold text-xl mr-2">Dispatch</h1>

            <input
              type="text"
              placeholder="Recherche client, plaque, dossier…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-[180px] max-w-xs bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600"
            />

            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand"
            >
              <option value="">Toutes sources</option>
              {SOURCES.map(s => (
                <option key={s} value={s}>{SOURCE_LABELS[s]?.label || s.toUpperCase()}</option>
              ))}
            </select>

            <button onClick={load}
              className="p-2 bg-[#111] border border-[#2a2a2a] rounded-xl text-zinc-400 hover:text-white transition"
              title="Actualiser">
              ↻
            </button>

            {/* Toggle vue liste / cartes */}
            <div className="flex items-center bg-[#111] border border-[#2a2a2a] rounded-xl overflow-hidden">
              <button
                onClick={() => switchView('list')}
                className={`px-3 py-2 text-sm font-medium transition ${
                  viewMode === 'list' ? 'bg-brand text-white' : 'text-zinc-400 hover:text-white'
                }`}>
                ≡ Liste
              </button>
              <button
                onClick={() => switchView('card')}
                className={`px-3 py-2 text-sm font-medium transition ${
                  viewMode === 'card' ? 'bg-brand text-white' : 'text-zinc-400 hover:text-white'
                }`}>
                ⊞ Cartes
              </button>
            </div>

            <Link href="/dispatch/new"
              className="flex items-center gap-2 px-4 py-2 bg-brand hover:bg-brand-dark text-white rounded-xl text-sm font-medium transition">
              + Nouvelle mission
            </Link>

            {/* Switch Manuel / Auto */}
            <div className="flex items-center gap-2 bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2">
              <span className="text-zinc-500 text-xs">Dispatch</span>
              <button
                onClick={toggleMode}
                disabled={modeLoading}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                  dispatchMode === 'auto' ? 'bg-brand' : 'bg-zinc-700'
                }`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  dispatchMode === 'auto' ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
              <span className={`text-xs font-medium ${dispatchMode === 'auto' ? 'text-brand' : 'text-zinc-400'}`}>
                {dispatchMode === 'auto' ? 'Auto' : 'Manuel'}
              </span>
            </div>
          </div>

          {/* Onglets */}
          <div className="flex gap-1 mt-4 overflow-x-auto">
            {TABS.map(tab => {
              const count  = tab.countKey ? counters[tab.countKey] : null
              const active = activeTab === tab.key
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                    active ? 'bg-brand text-white' : 'text-zinc-400 hover:text-white hover:bg-[#2a2a2a]'
                  }`}>
                  {tab.label}
                  {count !== null && count > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                      active ? 'bg-white/20 text-white' : 'bg-[#2a2a2a] text-zinc-300'
                    }`}>{count}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Panel statut chauffeurs ──────────────────────────────────── */}
        <DriverStatusPanel statuses={driverStatuses} />

        {/* ── Contenu ─────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-auto px-6 py-6">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-zinc-500">Chargement…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
              <p className="text-4xl mb-4">📋</p>
              <p>Aucune mission dans cette catégorie</p>
            </div>
          ) : viewMode === 'card' ? (

            /* ── VUE CARTES ─────────────────────────────────────── */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {filtered.map(m => (
                <MissionCard
                  key={m.id}
                  mission={m}
                  drivers={drivers}
                  driverStatuses={driverStatuses}
                  onRefresh={load}
                />
              ))}
            </div>

          ) : (

            /* ── VUE LISTE ──────────────────────────────────────── */
            <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#2a2a2a] text-zinc-400 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-medium">Source</th>
                    <th className="px-4 py-3 text-left font-medium">Dossier</th>
                    <th className="px-4 py-3 text-left font-medium">Client</th>
                    <th className="px-4 py-3 text-left font-medium">Délai</th>
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Véhicule</th>
                    <th className="px-4 py-3 text-left font-medium">Lieu incident</th>
                    <th className="px-4 py-3 text-left font-medium">Destination</th>
                    <th className="px-4 py-3 text-left font-medium">Chauffeur</th>
                    <th className="px-4 py-3 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222]">
                  {filtered.map(m => {
                    const delai   = getDelai(m.received_at)
                    const srcInfo = SOURCE_LABELS[m.source] || { label: '?', color: 'bg-zinc-600' }
                    return (
                      <tr key={m.id}
                        className={`transition hover:bg-[#222] cursor-pointer ${
                          delai.urgency === 'critical' ? 'bg-red-500/5' : ''
                        }`}
                        onClick={() => router.push(`/dispatch/${m.id}`)}>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${srcInfo.color}`}>
                            {srcInfo.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white font-mono text-xs">{m.external_id}</p>
                          {m.dossier_number && <p className="text-zinc-500 text-xs">{m.dossier_number}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white">{m.client_name || '—'}</p>
                          {m.client_phone && (
                            <a href={`tel:${m.client_phone}`} onClick={e => e.stopPropagation()}
                              className="text-zinc-400 text-xs hover:text-brand">{m.client_phone}</a>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold ${delai.color}`}>{delai.label}</span>
                        </td>
                        <td className="px-4 py-3 text-zinc-300 text-xs">
                          {m.mission_type ? (TYPE_LABELS[m.mission_type] || m.mission_type) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {m.vehicle_plate && <p className="text-white font-bold font-mono text-xs">{m.vehicle_plate}</p>}
                          <p className="text-zinc-400 text-xs">
                            {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white text-xs">{m.incident_address || '—'}</p>
                          {m.incident_city && <p className="text-zinc-500 text-xs">{m.incident_city}</p>}
                        </td>
                        <td className="px-4 py-3 text-zinc-400 text-xs">
                          {m.destination_name || m.destination_address || '—'}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          {m.status !== 'completed' ? (
                            <AssignDropdown mission={m} drivers={drivers} driverStatuses={driverStatuses} onAssigned={load} />
                          ) : (
                            <span className="text-green-400 text-xs font-medium">{m.assigned_user?.name || '—'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <Link href={`/dispatch/${m.id}`}
                            className="px-3 py-1.5 bg-brand hover:bg-brand-dark text-white rounded-lg text-xs font-medium transition inline-block">
                            VOIR
                          </Link>
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
    </div>
  )
}
