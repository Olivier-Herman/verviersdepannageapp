'use client'

import { useState, useEffect, useCallback } from 'react'
import Link       from 'next/link'
import { useRouter } from 'next/navigation'
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
  remorquage:       '🚛 Remorquage',
  depannage:        '🔧 Dépannage',
  transport:        '🚐 Transport',
  trajet_vide:      '📍 Trajet vide',
  reparation_place: '🔩 Réparation',
  autre:            '📋 Autre',
}

function getDelai(received_at: string): { label: string; color: string } {
  const mins  = Math.floor((Date.now() - new Date(received_at).getTime()) / 60000)
  const label = mins < 60
    ? `${mins}min`
    : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`
  // Vert < 15min · Jaune 15-30min · Orange 30-60min · Rouge > 1h
  const color = mins < 15 ? 'text-green-400'
              : mins < 30 ? 'text-yellow-400'
              : mins < 60 ? 'text-orange-400'
              : 'text-red-400'
  return { label, color }
}

const TABS = [
  { key: 'new',         label: 'En attente',  countKey: 'new'         as const },
  { key: 'assigned',    label: 'Assignées',   countKey: 'assigned'    as const },
  { key: 'in_progress', label: 'En cours',    countKey: 'in_progress' as const },
  { key: 'completed',   label: 'Terminées',   countKey: 'completed'   as const },
  { key: 'all',         label: 'Toutes',      countKey: null },
]

const SOURCES = ['touring', 'ethias', 'vivium', 'axa', 'ardenne', 'mondial', 'vab']

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/dispatch',  label: 'Dispatch',  icon: '📡' },
  { href: '/admin',     label: 'Admin',     icon: '⚙️' },
  { href: '/profil',    label: 'Mon Profil',icon: '👤' },
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
          const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
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
          <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-bold text-xs">{initials}</div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{userName}</p>
            <p className="text-zinc-500 text-xs capitalize">{userRole}</p>
          </div>
        </div>
        <button onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all w-full">
          <span>🚪</span> Déconnexion
        </button>
      </div>
    </aside>
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

  const [activeTab,    setActiveTab]    = useState('new')
  const [sourceFilter, setSourceFilter] = useState('')
  const [missions,     setMissions]     = useState<Mission[]>([])
  const [counters,     setCounters]     = useState<Counters>({ new: 0, assigned: 0, in_progress: 0, completed: 0, errors: 0 })
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status: activeTab })
      if (sourceFilter) params.set('source', sourceFilter)
      const res  = await fetch(`/api/missions/list?${params}`)
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
  useEffect(() => {
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [load])

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
                {counters.new} en attente · actualisation auto 30s
              </p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Rechercher..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm w-48 focus:outline-none focus:border-brand placeholder:text-zinc-600"
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
                  }`}
                >
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

        {/* Contenu */}
        <main className="flex-1 overflow-auto px-8 py-6">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-zinc-500">Chargement...</div>
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
                        className="transition hover:bg-[#222] cursor-pointer"
                        onClick={() => router.push(`/dispatch/${m.id}`)}
                      >
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
                            <a href={`tel:${m.client_phone}`}
                              onClick={e => e.stopPropagation()}
                              className="text-zinc-400 text-xs hover:text-brand"
                            >{m.client_phone}</a>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-400 text-xs whitespace-nowrap">
                          {new Date(m.received_at).toLocaleDateString('fr-BE')}
                          <br />
                          {new Date(m.received_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold ${delai.color}`}>
                            {delai.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-300 text-xs">
                          {m.mission_type ? TYPE_LABELS[m.mission_type] || m.mission_type : '—'}
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
                        <td className="px-4 py-3">
                          {m.assigned_user
                            ? <span className="text-green-400 text-xs font-medium">{m.assigned_user.name}</span>
                            : <span className="text-zinc-600 text-xs">—</span>
                          }
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <Link href={`/dispatch/${m.id}`}
                            className="px-3 py-1.5 bg-brand hover:bg-brand-dark text-white rounded-lg text-xs font-medium transition inline-block"
                          >
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
