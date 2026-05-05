'use client'

import { useState, useEffect, useRef }    from 'react'
import { useRouter }   from 'next/navigation'
import Link            from 'next/link'
import { signOut }     from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { DriverTimeline } from '@/components/missions/DriverTimeline'
import AddressField, { verifyAddressViaPlaces } from '@/components/AddressField'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mission {
  id: string
  external_id: string
  dossier_number: string | null
  source: string
  source_format: string
  mission_type: string | null
  incident_type: string | null
  incident_description: string | null
  client_name: string | null
  client_phone: string | null
  client_address: string | null
  vehicle_plate: string | null
  vehicle_brand: string | null
  vehicle_model: string | null
  vehicle_vin: string | null
  vehicle_fuel: string | null
  vehicle_gearbox: string | null
  incident_address: string | null
  incident_city: string | null
  incident_country: string
  incident_lat: number | null
  incident_lng: number | null
  destination_name: string | null
  destination_address: string | null
  incident_borne_km: string | null
  incident_sens: string | null
  destination_borne_km: string | null
  destination_sens: string | null
  odoo_vehicle_id: number | null
  depot_depart_id: string | null
  amount_guaranteed: number | null
  amount_currency: string
  amount_to_collect: number | null
  vehicle_mileage: number | null
  driver_photos: string[] | null
  discharge_data: { motif: string; name: string; sig: string }[] | null
  discharge_motif: string | null
  discharge_name: string | null
  discharge_sig: string | null
  client_signature: string | null
  client_signature_name: string | null
  closing_notes: string | null
  payment_method: string | null
  odoo_helpdesk_id: number | null
  odoo_task_id: number | null
  odoo_ticket_url: string | null
  odoo_task_url: string | null
  amount_collected: number | null
  incident_at: string | null
  received_at: string
  status: string
  dispatch_mode: string
  assigned_to: string | null
  assigned_at: string | null
  assigned_user: { id: string; name: string; phone?: string } | null
  accepted_at: string | null
  on_way_at: string | null
  on_site_at: string | null
  completed_at: string | null
  parse_confidence: number | null
  raw_content: string | null
  billed_to_name: string | null
  billed_to_id: number | null
  assisted_name: string | null
  assisted_phone: string | null
}

interface MissionLog {
  id: string
  action: string
  notes: string | null
  created_at: string
  actor: { name: string } | null
}

interface Driver {
  id: string
  name: string
  avatar_url: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  touring:  { label: 'TOURING',  color: 'bg-blue-600' },
  ethias:   { label: 'ETHIAS',   color: 'bg-green-600' },
  vivium:   { label: 'VIVIUM',   color: 'bg-purple-600' },
  axa:      { label: 'IPA',      color: 'bg-red-600' },
  ardenne:  { label: 'ARDENNE (IPA)', color: 'bg-orange-600' },
  mondial:  { label: 'MONDIAL',  color: 'bg-teal-600' },
  vab:      { label: 'VAB',      color: 'bg-yellow-600' },
  police:   { label: 'POLICE',   color: 'bg-blue-900' },
  prive:    { label: 'PRIVÉ',    color: 'bg-zinc-700' },
  garage:   { label: 'GARAGE',   color: 'bg-amber-700' },
  unknown:  { label: '?',        color: 'bg-zinc-600' },
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new:         { label: 'Nouvelle',     color: 'text-yellow-400' },
  dispatching: { label: 'En attente',   color: 'text-blue-400' },
  assigned:    { label: 'Assignée',     color: 'text-purple-400' },
  accepted:    { label: 'Acceptée',     color: 'text-green-400' },
  in_progress: { label: 'En cours',     color: 'text-orange-400' },
  completed:   { label: 'Terminée',     color: 'text-zinc-400' },
  cancelled:   { label: 'Annulée',      color: 'text-red-400' },
  ignored:     { label: 'Refusée',      color: 'text-red-500' },
  parse_error: { label: 'Erreur',       color: 'text-red-400' },
}

const MISSION_TYPES = ['remorquage', 'depannage', 'transport', 'trajet_vide', 'reparation_place', 'autre']
const FUEL_TYPES    = ['Diesel', 'Essence', 'Hybride', 'Électrique', 'GPL', 'Autre']
const GEARBOX_TYPES = ['Manuelle', 'Automatique', 'Semi-automatique']

const LOG_ICONS: Record<string, string> = {
  received:   '📥',
  parsed:     '🔍',
  dispatched: '✅',
  accepted:   '👍',
  refused:    '❌',
  reassigned: '🔄',
  completed:  '🏁',
  cancelled:  '🚫',
  error:      '⚠️',
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/dispatch',  label: 'Dispatch',  icon: '📡' },
  { href: '/admin',     label: 'Admin',     icon: '⚙️' },
  { href: '/profil',    label: 'Mon Profil',icon: '👤' },
]

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

// ── Input helpers ─────────────────────────────────────────────────────────────

interface DriverEta {
  id: string
  name: string
  avatar_url: string | null
  has_position: boolean
  location_age_seconds: number | null
  is_fresh: boolean
  status: 'free' | 'on_mission'
  eta_to_incident_min: number | null
  current_mission: null | {
    id: string
    dossier_number: string | null
    mission_type: string | null
    destination_address: string
    eta_to_destination_min: number | null
    eta_destination_to_incident_min: number | null
    status: string
  }
}

function DriverPickerModal({ missionId, incidentLat, incidentLng, onPick, onClose }: {
  missionId:   string
  incidentLat: number | null
  incidentLng: number | null
  onPick:      (driverId: string) => void
  onClose:     () => void
}) {
  const [drivers, setDrivers] = useState<DriverEta[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const qs = incidentLat != null && incidentLng != null
          ? `?lat=${incidentLat}&lng=${incidentLng}`
          : ''
        const res  = await fetch(`/api/missions/${missionId}/driver-eta${qs}`)
        const data = await res.json()
        if (data.error) setError(data.error)
        else setDrivers(data.drivers || [])
      } catch (e: any) {
        setError(e.message || 'Erreur de chargement')
      } finally {
        setLoading(false)
      }
    })()
  }, [missionId, incidentLat, incidentLng])

  const fmtAge = (sec: number | null) => {
    if (sec == null) return ''
    if (sec < 60)    return `il y a ${sec}s`
    const min = Math.floor(sec / 60)
    if (min < 60)    return `il y a ${min} min`
    return `il y a ${Math.floor(min / 60)}h`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6 border-b border-[#2a2a2a] flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-lg">🚛 Choisir un chauffeur</h2>
            <p className="text-zinc-400 text-xs mt-1">ETA camion (90 km/h max sur autoroute)</p>
          </div>
          <button type="button" onClick={onClose}
            className="text-zinc-500 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-2">
          {loading && <p className="text-zinc-500 text-sm text-center py-8">⏳ Calcul des temps de trajet…</p>}
          {error && <p className="text-red-400 text-sm text-center py-8">❌ {error}</p>}
          {!loading && !error && drivers.length === 0 && (
            <p className="text-zinc-500 text-sm text-center py-8">Aucun chauffeur en service actuellement.</p>
          )}
          {drivers.map(d => {
            const free = d.status === 'free'
            const cm = d.current_mission
            const totalEta = !free && cm
              ? (cm.eta_to_destination_min || 0) + (cm.eta_destination_to_incident_min || 0)
              : d.eta_to_incident_min

            return (
              <button key={d.id} type="button" onClick={() => onPick(d.id)}
                className={`w-full text-left p-4 rounded-xl border transition ${
                  free
                    ? 'bg-green-500/5 hover:bg-green-500/10 border-green-500/30'
                    : 'bg-amber-500/5 hover:bg-amber-500/10 border-amber-500/30'
                }`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${free ? 'bg-green-400' : 'bg-amber-400'}`}></span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold">{d.name}</p>
                      {free ? (
                        <p className="text-green-300 text-xs">
                          Libre {d.has_position && d.location_age_seconds != null && `· position ${fmtAge(d.location_age_seconds)}`}
                        </p>
                      ) : (
                        <p className="text-amber-300 text-xs truncate">
                          En mission → {cm?.destination_address || '(destination inconnue)'}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {totalEta != null ? (
                      <p className="text-white text-lg font-bold tabular-nums">{totalEta} min</p>
                    ) : (
                      <p className="text-zinc-500 text-xs">ETA indispo</p>
                    )}
                    <p className="text-zinc-500 text-xs">vers incident</p>
                  </div>
                </div>
                {!free && cm && (
                  <div className="mt-3 pt-3 border-t border-amber-500/20 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-zinc-500">Arrive à destination dans</p>
                      <p className="text-white font-semibold">
                        {cm.eta_to_destination_min != null ? `${cm.eta_to_destination_min} min` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Puis trajet vers incident</p>
                      <p className="text-white font-semibold">
                        {cm.eta_destination_to_incident_min != null ? `${cm.eta_destination_to_incident_min} min` : '—'}
                      </p>
                    </div>
                  </div>
                )}
                {!d.has_position && (
                  <p className="text-zinc-500 text-xs mt-2">⚠ Position non disponible</p>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AddressReviewModal({
  which, parsedAddress, currentAddress, googleSuggestion, gmKey, onPick, onSkip,
}: {
  which:            'incident' | 'destination'
  parsedAddress:    string
  currentAddress:   string
  googleSuggestion?: { addr: string; lat: number; lng: number }
  gmKey:            string
  onPick:           (addr: string, lat: number | null, lng: number | null) => void
  onSkip:           () => void
}) {
  const [manualAddr, setManualAddr] = useState('')
  const [manualPick, setManualPick] = useState<{ lat: number; lng: number } | null>(null)
  const title = which === 'incident' ? "Lieu d'incident" : 'Destination'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6 border-b border-[#2a2a2a]">
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            🛰️ Vérifier l'adresse — {title}
          </h2>
          <p className="text-zinc-400 text-xs mt-1">
            Choisis une adresse géolocalisée pour permettre le calcul des kilomètres.
          </p>
        </div>

        <div className="p-6 space-y-3">
          {/* Adresse parsée originale */}
          <button type="button" onClick={() => onPick(parsedAddress, null, null)}
            className="w-full text-left p-4 bg-[#111] hover:bg-[#222] border border-[#2a2a2a] hover:border-zinc-600 rounded-xl transition">
            <p className="text-zinc-500 text-xs font-medium uppercase mb-1">📥 Adresse reçue (parser)</p>
            <p className="text-white text-sm">{parsedAddress || <span className="text-zinc-600">(vide)</span>}</p>
            <p className="text-amber-500/80 text-xs mt-2">⚠ Sera envoyée sans coordonnées GPS — pas de calcul KM</p>
          </button>

          {/* Suggestion Google */}
          {googleSuggestion && (
            <button type="button" onClick={() => onPick(googleSuggestion.addr, googleSuggestion.lat, googleSuggestion.lng)}
              className="w-full text-left p-4 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 hover:border-green-400 rounded-xl transition">
              <p className="text-green-400 text-xs font-medium uppercase mb-1">🌐 Suggestion Google</p>
              <p className="text-white text-sm">{googleSuggestion.addr}</p>
              <p className="text-green-300/80 text-xs mt-2">✓ Géolocalisée ({googleSuggestion.lat.toFixed(5)}, {googleSuggestion.lng.toFixed(5)})</p>
            </button>
          )}

          {/* Saisie manuelle avec autocomplete */}
          <div className="p-4 bg-[#111] border border-[#2a2a2a] rounded-xl">
            <p className="text-brand text-xs font-medium uppercase mb-2">🔍 Saisie manuelle</p>
            <AddressField
              value={manualAddr}
              onChange={v => { setManualAddr(v); setManualPick(null) }}
              onSelect={(addr, lat, lng) => { setManualAddr(addr); setManualPick({ lat, lng }) }}
              gmKey={gmKey}
              placeholder="Tape une adresse précise…"
            />
            {manualPick && (
              <button type="button"
                onClick={() => onPick(manualAddr, manualPick.lat, manualPick.lng)}
                className="mt-3 w-full px-4 py-2.5 bg-brand hover:bg-brand/80 text-white text-sm font-semibold rounded-xl transition">
                Utiliser cette adresse
              </button>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-[#2a2a2a] flex justify-between">
          <p className="text-zinc-500 text-xs self-center">
            Adresse actuelle dans le form : <span className="text-zinc-300">{currentAddress || '(vide)'}</span>
          </p>
          <button type="button" onClick={onSkip}
            className="px-4 py-2 text-zinc-400 hover:text-white text-xs transition">
            Plus tard
          </button>
        </div>
      </div>
    </div>
  )
}

function MissionKmInfo({ missionId, refreshKey }: { missionId: string; refreshKey: string }) {
  const [data, setData]   = useState<{ total_km: number; segments: Array<{ label: string; km: number | null }>; error: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    fetch(`/api/missions/${missionId}/km`).then(r => r.json()).then(d => {
      if (d.error && !d.segments) setData({ total_km: 0, segments: [], error: d.error })
      else setData(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [missionId, refreshKey])

  return (
    <div className="mt-4 pt-4 border-t border-[#2a2a2a]">
      <div className="flex items-center justify-between mb-2">
        <p className="text-zinc-500 text-xs uppercase tracking-wide font-medium">📏 Kilométrage</p>
        {data?.total_km != null && data.segments.length > 0 && (
          <span className="text-white font-semibold text-sm">{data.total_km} km</span>
        )}
      </div>
      {loading && <p className="text-zinc-600 text-xs">Calcul…</p>}
      {!loading && data?.error && data.segments.length === 0 && (
        <p className="text-zinc-600 text-xs">⚠ {data.error}</p>
      )}
      {!loading && data?.segments && data.segments.length > 0 && (
        <ul className="space-y-1">
          {data.segments.map((s, i) => (
            <li key={i} className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 truncate flex-1 min-w-0">{s.label}</span>
              <span className={`flex-shrink-0 ml-2 ${s.km == null ? 'text-zinc-600' : 'text-zinc-300'}`}>
                {s.km != null ? `${s.km} km` : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GeoStatusBanner({ status, onReview }: {
  status:   { state: 'idle'|'checking'|'confirmed'|'different'|'not_found'; suggestion?: { addr: string; lat: number; lng: number } }
  onReview: () => void
}) {
  if (status.state === 'idle')      return null
  if (status.state === 'checking')  return <p className="text-zinc-500 text-xs">⏳ Vérification Google…</p>
  if (status.state === 'confirmed') return <p className="text-green-400 text-xs">✅ Adresse confirmée par Google</p>
  if (status.state === 'different') return (
    <div className="px-3 py-2 bg-green-500/5 border border-green-500/20 rounded-xl flex items-center justify-between gap-2">
      <p className="text-green-300 text-xs">✅ Normalisée par Google (lat/lng appliqués)</p>
      <button type="button" onClick={onReview}
        className="flex-shrink-0 px-2.5 py-1 bg-[#2a2a2a] hover:bg-[#3a3a3a] text-zinc-400 rounded-lg text-xs transition">
        Pas la bonne ?
      </button>
    </div>
  )
  // not_found
  return (
    <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between gap-2">
      <p className="text-red-400 text-xs">❌ Adresse non trouvée par Google — pas de calcul KM possible</p>
      <button type="button" onClick={onReview}
        className="flex-shrink-0 px-2.5 py-1 bg-red-500/30 hover:bg-red-500/50 text-white rounded-lg text-xs font-semibold transition">
        Corriger
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-zinc-500 text-xs mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600"
    />
  )
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand"
    >
      <option value="">— Sélectionner —</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function MissionDetailClient({
  mission: initialMission,
  logs,
  drivers,
  userName,
  userRole,
  googleMapsKey,
}: {
  mission:       Mission
  logs:          MissionLog[]
  drivers:       Driver[]
  userName:      string
  userRole:      string
  googleMapsKey: string
}) {
  const router = useRouter()

  // Combiner rue + ville/CP en une seule adresse complète si la ville n'y est pas déjà.
  // Le parser email écrit incident_address (rue) et incident_city séparément. L'UI a un seul
  // champ unifié, donc on les concatène à l'init.
  const combineAddress = (street: string | null, city: string | null) => {
    const s = (street || '').trim()
    const c = (city   || '').trim()
    if (!s) return c
    if (!c) return s
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
    return norm(s).includes(norm(c)) ? s : `${s}, ${c}`
  }

  // Formulaire éditable
  const [form, setForm] = useState({
    mission_type:         initialMission.mission_type         || '',
    incident_type:        initialMission.incident_type        || '',
    incident_description: initialMission.incident_description || '',
    billed_to_name:       initialMission.billed_to_name       || '',
    client_name:          initialMission.client_name          || '',
    client_phone:         initialMission.client_phone         || '',
    client_address:       initialMission.client_address       || '',
    vehicle_plate:        initialMission.vehicle_plate        || '',
    vehicle_brand:        initialMission.vehicle_brand        || '',
    vehicle_model:        initialMission.vehicle_model        || '',
    vehicle_vin:          initialMission.vehicle_vin          || '',
    vehicle_fuel:         initialMission.vehicle_fuel         || '',
    vehicle_gearbox:      initialMission.vehicle_gearbox      || '',
    incident_address:     combineAddress(initialMission.incident_address, initialMission.incident_city),
    incident_lat:         initialMission.incident_lat         != null ? String(initialMission.incident_lat)  : '',
    incident_lng:         initialMission.incident_lng         != null ? String(initialMission.incident_lng)  : '',
    incident_city:        initialMission.incident_city        || '',
    destination_name:     initialMission.destination_name     || '',
    // Destination : nom du lieu (garage, hôtel) en PRÉFIXE de l'adresse → "Garage X, Rue Y"
    destination_address:  initialMission.destination_name && initialMission.destination_address
                            && !initialMission.destination_address.toLowerCase().includes(initialMission.destination_name.toLowerCase())
                            ? `${initialMission.destination_name}, ${initialMission.destination_address}`
                            : (initialMission.destination_address || ''),
    destination_lat:      '',
    destination_lng:      '',
    incident_borne_km:    initialMission.incident_borne_km    || '',
    incident_sens:        initialMission.incident_sens        || '',
    destination_borne_km: initialMission.destination_borne_km || '',
    destination_sens:     initialMission.destination_sens     || '',
    amount_guaranteed:    initialMission.amount_guaranteed != null ? String(initialMission.amount_guaranteed) : '',
    amount_to_collect:    initialMission.amount_to_collect != null  ? String(initialMission.amount_to_collect)  : '',
  })

  // Détection autoroute belge/française : "A" suivi de 1-3 chiffres en début d'adresse,
  // ou mot-clé "autoroute" / "highway".
  const isHighway = (addr: string) =>
    /(^|[\s,])A\d{1,3}\b/.test(addr) || /\b(autoroute|highway)\b/i.test(addr)

  // ── Auto-vérification Google sur chargement ─────────────────────────────────
  // État par adresse : 'idle' | 'checking' | 'confirmed' | 'different' | 'not_found'
  type GeoStatus = { state: 'idle'|'checking'|'confirmed'|'different'|'not_found'; suggestion?: { addr: string; lat: number; lng: number } }
  const [incidentGeo,    setIncidentGeo]    = useState<GeoStatus>({ state: 'idle' })
  const [destinationGeo, setDestinationGeo] = useState<GeoStatus>({ state: 'idle' })

  // Vérification d'adresse via Places API client-side (même moteur que l'autocomplete,
  // bien plus tolérant que Geocoding API pour les adresses abrégées/approximatives).
  const verifyAddress = async (addr: string): Promise<GeoStatus> => {
    if (!addr.trim()) return { state: 'idle' }
    try {
      const r = await verifyAddressViaPlaces(addr, googleMapsKey)
      if (!r) return { state: 'not_found' }
      return {
        state: r.same ? 'confirmed' : 'different',
        suggestion: { addr: r.formatted, lat: r.lat, lng: r.lng },
      }
    } catch {
      return { state: 'not_found' }
    }
  }

  // Persistance silencieuse partielle — pour que d'autres opérations (driver-eta,
  // calcul KM…) puissent lire les champs depuis la DB sans attendre un save manuel.
  const silentPatch = (fields: Record<string, any>) => {
    fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(fields),
    }).catch(() => {})
  }

  // Au chargement : vérifier les 2 adresses et appliquer silencieusement la version
  // canonique Google (confirmed OU different — on fait confiance à Places, comme si
  // le dispatcher avait tapé l'adresse et choisi la 1re suggestion). La bannière
  // signale le statut. Le dispatcher peut toujours rouvrir le modal pour corriger.
  useEffect(() => {
    (async () => {
      if (form.incident_address && !initialMission.incident_lat) {
        setIncidentGeo({ state: 'checking' })
        const r = await verifyAddress(form.incident_address)
        setIncidentGeo(r)
        if (r.suggestion && (r.state === 'confirmed' || r.state === 'different')) {
          setForm(prev => ({
            ...prev,
            incident_address: r.suggestion!.addr,
            incident_lat:     String(r.suggestion!.lat),
            incident_lng:     String(r.suggestion!.lng),
          }))
          silentPatch({
            incident_address: r.suggestion!.addr,
            incident_lat:     r.suggestion!.lat,
            incident_lng:     r.suggestion!.lng,
          })
        }
      }
      if (form.destination_address) {
        setDestinationGeo({ state: 'checking' })
        const r = await verifyAddress(form.destination_address)
        setDestinationGeo(r)
        if (r.suggestion && (r.state === 'confirmed' || r.state === 'different')) {
          setForm(prev => ({
            ...prev,
            destination_address: r.suggestion!.addr,
            destination_lat:     String(r.suggestion!.lat),
            destination_lng:     String(r.suggestion!.lng),
          }))
          silentPatch({
            destination_address: r.suggestion!.addr,
            destination_lat:     r.suggestion!.lat,
            destination_lng:     r.suggestion!.lng,
          })
        }
      }
    })()
  }, [])

  // ── Modal de vérification d'adresse ─────────────────────────────────────────
  // Ouverte automatiquement quand le geocoding renvoie "different" ou "not_found".
  // Le dispatcher choisit entre adresse originale, suggestion Google, ou saisie manuelle.
  // Indispensable pour le calcul des kilométrages (sans lat/lng, pas de KM).
  const [activeReview,  setActiveReview]  = useState<'incident'|'destination'|null>(null)

  // Plus d'auto-ouverture : le modal est strictement à la demande du dispatcher
  // (clic "Corriger" sur la bannière "❌ non trouvée"). Pour les cas confirmed/different,
  // l'application est silencieuse et le dispatcher juge sur pièce.
  const closeReview = () => setActiveReview(null)
  const reopenReview = (which: 'incident'|'destination') => setActiveReview(which)

  const [selectedDriver, setSelectedDriver]   = useState(initialMission.assigned_to || '')
  const [showDriverModal, setShowDriverModal] = useState(false)
  const [depots, setDepots]                   = useState<Array<{id:string;name:string;address:string;is_default:boolean}>>([])
  const [depotId, setDepotId]                 = useState<string>(initialMission.depot_depart_id || '')

  // Charger la liste des dépôts pour le sélecteur "Dépôt de départ"
  useEffect(() => {
    fetch('/api/depots').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : []
      setDepots(list)
      // Si rien de pré-saisi, défaut = depot is_default
      if (!initialMission.depot_depart_id) {
        const def = list.find((x: any) => x.is_default)
        if (def) setDepotId(def.id)
      }
    }).catch(() => {})
  }, [])
  const [showRawContent, setShowRawContent]   = useState(false)
  const [loadingConfirm, setLoadingConfirm]   = useState(false)
  const [loadingRefuse,  setLoadingRefuse]    = useState(false)
  const [loadingSave,    setLoadingSave]      = useState(false)
  const [brands,         setBrands]           = useState<{id:number;name:string}[]>([])
  const [models,         setModels]           = useState<{id:number;name:string}[]>([])
  const [loadingBrands,  setLoadingBrands]    = useState(false)
  const [loadingIMA,     setLoadingIMA]       = useState(false)
  const [imaSuccess,     setImaSuccess]       = useState(false)
  const [status,         setStatus]           = useState(initialMission.status)
  const [odooTicketUrl,  setOdooTicketUrl]    = useState<string | null>(initialMission.odoo_ticket_url || null)
  const [odooTaskUrl,    setOdooTaskUrl]      = useState<string | null>(initialMission.odoo_task_url || null)
  const [loadingOdoo,    setLoadingOdoo]      = useState(false)
  const [odooError,      setOdooError]        = useState<string | null>(null)

  // ── Recherche/lien client Odoo (facturé) ────────────────────────────────────
  const [billedPartnerId, setBilledPartnerId] = useState<number | null>(initialMission.billed_to_id || null)
  const [clientQuery,     setClientQuery]     = useState('')
  const [clientResults,   setClientResults]   = useState<Array<{id:number;name:string;phone?:string;mobile?:string;city?:string}>>([])
  const [showClientDrop,  setShowClientDrop]  = useState(false)
  const clientTimer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    if (clientQuery.length < 3) { setClientResults([]); return }
    clearTimeout(clientTimer.current)
    clientTimer.current = setTimeout(async () => {
      try {
        const data = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(clientQuery)}`).then(r => r.json())
        setClientResults(data.clients || [])
      } catch {}
    }, 300)
  }, [clientQuery])

  const selectBilledClient = (c: {id:number;name:string}) => {
    setBilledPartnerId(c.id)
    setForm(prev => ({ ...prev, billed_to_name: c.name }))
    setClientQuery('')
    setClientResults([])
    setShowClientDrop(false)
  }
  const clearBilledClient = () => {
    setBilledPartnerId(null)
    setForm(prev => ({ ...prev, billed_to_name: '' }))
  }

  // ── Recherche/lien véhicule Odoo (par plaque ou VIN) ────────────────────────
  // Si la mission a déjà un odoo_vehicle_id persisté, on initialise l'état avec
  // pour skipper la recherche de suggestions au chargement.
  const [odooVehicleId,    setOdooVehicleId]    = useState<number | null>(initialMission.odoo_vehicle_id || null)
  const [vehicleResults,   setVehicleResults]   = useState<Array<{id:number;plate:string;vin:string;brand:string;model:string;fuel:string;gearbox:string}>>([])
  const [showVehicleDrop,  setShowVehicleDrop]  = useState(false)
  const [vehicleSearched,  setVehicleSearched]  = useState(false)
  const vehicleTimer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    const q = (form.vehicle_plate || '').trim()
    if (q.length < 3) { setVehicleResults([]); setVehicleSearched(false); return }
    if (odooVehicleId) return  // déjà lié (état session ou persisté DB) → on n'écrase pas
    clearTimeout(vehicleTimer.current)
    vehicleTimer.current = setTimeout(async () => {
      try {
        const data = await fetch(`/api/odoo/search-vehicle?q=${encodeURIComponent(q)}`).then(r => r.json())
        setVehicleResults(data.vehicles || [])
        setVehicleSearched(true)
        if ((data.vehicles || []).length > 0) setShowVehicleDrop(true)
      } catch {}
    }, 400)
  }, [form.vehicle_plate, odooVehicleId])

  const selectOdooVehicle = async (v: {id:number;plate:string;vin:string;brand:string;model:string;fuel:string;gearbox:string}) => {
    setOdooVehicleId(v.id)
    // Préserve les valeurs Odoo (source de vérité) sauf si vides → fallback sur le form
    setForm(prev => ({
      ...prev,
      vehicle_plate:   v.plate || prev.vehicle_plate,
      vehicle_brand:   v.brand || prev.vehicle_brand,
      vehicle_model:   v.model || prev.vehicle_model,
      vehicle_vin:     v.vin   || prev.vehicle_vin,
      vehicle_fuel:    v.fuel  || prev.vehicle_fuel,
      vehicle_gearbox: v.gearbox || prev.vehicle_gearbox,
    }))
    setVehicleResults([])
    setShowVehicleDrop(false)

    // Persistance immédiate du lien — le dispatcher n'aura plus à reconfirmer à chaque ouverture
    fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ odoo_vehicle_id: v.id }),
    }).catch(() => {})

    // Charger la liste des modèles pour la marque liée, sinon le <select> Modèle
    // n'a pas l'option correspondante et le champ apparaît vide.
    if (v.brand) {
      const allBrands = brands.length > 0 ? brands : await loadBrands()
      const matched = allBrands.find(b => b.name === v.brand)
                   ?? allBrands.find(b => normalizeBrand(b.name) === normalizeBrand(v.brand))
      if (matched) await loadModels(matched.id)
    }

    // Si le form a un VIN/fuel/boîte que le véhicule Odoo n'a pas → on complète Odoo
    const needsUpdate =
      (form.vehicle_vin     && !v.vin) ||
      (form.vehicle_fuel    && !v.fuel) ||
      (form.vehicle_gearbox && !v.gearbox)
    if (needsUpdate) {
      try {
        await fetch('/api/odoo/update-vehicle', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicle_id: v.id,
            vin:        !v.vin     ? form.vehicle_vin     : undefined,
            fuel:       !v.fuel    ? form.vehicle_fuel    : undefined,
            gearbox:    !v.gearbox ? form.vehicle_gearbox : undefined,
          }),
        })
      } catch {}
    }
  }
  const clearOdooVehicle = () => {
    setOdooVehicleId(null)
    setVehicleSearched(false)
    fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ odoo_vehicle_id: null }),
    }).catch(() => {})
  }

  // Le dispatcher doit choisir explicitement entre un véhicule existant ou créer
  // un nouveau dès lors qu'il y a des matches potentiels en attente.
  // Évite de créer des doublons par inadvertance dans Odoo.
  const vehicleDecisionPending = !odooVehicleId
    && vehicleResults.length > 0
    && (form.vehicle_plate || '').trim().length >= 3

  // Comparaison fuzzy brand/model d'un véhicule Odoo vs ce qui est saisi dans le form
  const vehicleSimilarity = (v: {brand:string;model:string}): 'match' | 'mismatch' | 'unknown' => {
    if (!form.vehicle_brand && !form.vehicle_model) return 'unknown'
    const norm = (s: string) => (s || '').toLowerCase().replace(/[-.\s]/g, '').trim()
    const fuzzy = (a: string, b: string) => {
      const na = norm(a), nb = norm(b)
      if (!na || !nb) return false
      return na.includes(nb) || nb.includes(na)
    }
    const brandOk = !form.vehicle_brand || fuzzy(v.brand, form.vehicle_brand)
    const modelOk = !form.vehicle_model || fuzzy(v.model, form.vehicle_model)
    return brandOk && modelOk ? 'match' : 'mismatch'
  }

  const [M, setM] = useState<Mission>(initialMission)
  const [saveOk, setSaveOk] = useState(false)
  const [kmRefresh, setKmRefresh] = useState(0)  // incrémenté à chaque save → force le re-calcul des KM

  // Realtime — mise à jour automatique depuis le chauffeur
  useEffect(() => {
    const ch = sb.channel(`dispatch-mission-${initialMission.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'incoming_missions',
        filter: `id=eq.${initialMission.id}`,
      }, payload => {
        const updated = payload.new as any
        setM(prev => ({ ...prev, ...updated }))
        if (updated.status) setStatus(updated.status)
        // Mettre à jour uniquement les champs chauffeur (pas les champs du formulaire dispatch)
        const driverFields = ['driver_photos', 'discharge_data', 'client_signature',
          'closing_notes', 'on_way_at', 'on_site_at', 'completed_at',
          'accepted_at', 'assigned_at', 'parked_at', 'extra_addresses']
        const formUpdates: Partial<typeof form> = {}
        if (updated.vehicle_plate && updated.vehicle_plate !== form.vehicle_plate) formUpdates.vehicle_plate = updated.vehicle_plate
        if (updated.vehicle_brand && updated.vehicle_brand !== form.vehicle_brand) formUpdates.vehicle_brand = updated.vehicle_brand
        if (updated.vehicle_model && updated.vehicle_model !== form.vehicle_model) formUpdates.vehicle_model = updated.vehicle_model
        if (Object.keys(formUpdates).length > 0) setForm(prev => ({ ...prev, ...formUpdates }))
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [initialMission.id])

  const f = (k: keyof typeof form) => (v: string) => setForm(prev => ({ ...prev, [k]: v }))

  // Détecter lien IMA dans raw_content
  const imaLink = initialMission.raw_content?.match(/https:\/\/imamobile\.ima\.eu\/[^\s"<>]+/)?.[0] || null

  // Enrichir depuis le portail IMA
  const handleFetchIMA = async () => {
    setLoadingIMA(true)
    setImaSuccess(false)
    try {
      const res  = await fetch('/api/missions/fetch-ima', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: initialMission.id })
      })
      const data = await res.json()
      if (data.ok) {
        setImaSuccess(true)
        setTimeout(() => window.location.reload(), 1500)
      }
    } finally {
      setLoadingIMA(false)
    }
  }

  // Normalisation pour fuzzy match marque/modèle (case + tirets/espaces ignorés)
  const normalizeBrand = (s: string) => (s || '').toLowerCase().replace(/[-.\s]/g, '').trim()

  // Charger les marques depuis l'API véhicules + auto-match insensible à la casse
  const loadBrands = async () => {
    if (brands.length > 0) return brands
    setLoadingBrands(true)
    try {
      const res  = await fetch('/api/vehicles?type=brands')
      const data: {id:number;name:string}[] = await res.json()
      setBrands(data || [])
      return data || []
    } finally { setLoadingBrands(false) }
  }

  const loadModels = async (brandId: number) => {
    const res  = await fetch(`/api/vehicles?type=models&brandId=${brandId}`)
    const data = await res.json()
    setModels(data || [])
    return data || []
  }

  useEffect(() => {
    (async () => {
      if (!form.vehicle_brand || brands.length > 0) return
      const list = await loadBrands()
      // Si le parser a retourné une marque qui matche un brand Odoo (insensible à la casse),
      // on réécrit la valeur du form avec la casse exacte d'Odoo pour que le <select> match.
      const target = normalizeBrand(form.vehicle_brand)
      const matched = list.find(b => normalizeBrand(b.name) === target)
                   ?? list.find(b => normalizeBrand(b.name).includes(target) || target.includes(normalizeBrand(b.name)))
      if (matched) {
        if (matched.name !== form.vehicle_brand) f('vehicle_brand')(matched.name)
        const modelList = await loadModels(matched.id)
        if (form.vehicle_model) {
          const targetModel = normalizeBrand(form.vehicle_model)
          const matchedModel = modelList.find((m: any) => normalizeBrand(m.name) === targetModel)
                            ?? modelList.find((m: any) => normalizeBrand(m.name).includes(targetModel) || targetModel.includes(normalizeBrand(m.name)))
          if (matchedModel && matchedModel.name !== form.vehicle_model) f('vehicle_model')(matchedModel.name)
        }
      }
    })()
  }, [])

  // Sauvegarder les modifications du formulaire
  const handleSave = async () => {
    setLoadingSave(true)
    setSaveOk(false)
    const payload = { ...form, billed_to_id: billedPartnerId, depot_depart_id: depotId || null, _notify_driver: true }
    const res = await fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    })
    if (res.ok) {
      setSaveOk(true)
      setKmRefresh(k => k + 1)  // force le recalcul des KM avec les nouvelles données DB
      setTimeout(() => setSaveOk(false), 3000)
    }
    setLoadingSave(false)
  }

  // Confirmer la mission
  const handleConfirm = async () => {
    setLoadingConfirm(true)
    const payload = { ...form, billed_to_id: billedPartnerId, odoo_vehicle_id: odooVehicleId, depot_depart_id: depotId || null }
    await fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    })

    // Si un véhicule Odoo est lié, propage les champs saisis (VIN/carburant/boîte)
    // qui auraient pu être ajoutés après le clic initial sur la suggestion.
    if (odooVehicleId) {
      fetch('/api/odoo/update-vehicle', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: odooVehicleId,
          vin:        form.vehicle_vin || undefined,
          fuel:       form.vehicle_fuel || undefined,
          gearbox:    form.vehicle_gearbox || undefined,
        }),
      }).catch(() => {})
    }
    if (selectedDriver) {
      await fetch('/api/missions/assign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: initialMission.id, driver_id: selectedDriver })
      })
    }
    await fetch('/api/missions/confirm', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mission_id: initialMission.id, action: 'confirm' })
    })
    setStatus('dispatching')
    setLoadingConfirm(false)
    // Créer le dossier dans Odoo FSM (en arrière-plan, sans bloquer)
    createOdooFsmDossier().catch(console.error)
    window.location.href = '/dispatch'
  }

  // Créer Helpdesk ticket + FSM Task dans Odoo
  const createOdooFsmDossier = async () => {
    setLoadingOdoo(true)
    setOdooError(null)
    try {
      const res = await fetch('/api/fsm/create-mission', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mission_id:          initialMission.id,
          supabase_id:         initialMission.id,
          dossier_number:      initialMission.dossier_number || initialMission.external_id || '',
          source:              initialMission.source?.toUpperCase() || 'PRIVÉ',
          client_name:         form.client_name || 'Client inconnu',
          client_phone:        form.client_phone || '',
          vehicle_plate:       form.vehicle_plate || '',
          vehicle_brand:       form.vehicle_brand || '',
          vehicle_model:       form.vehicle_model || '',
          incident_address:    form.incident_address || '',
          incident_city:       form.incident_city || '',
          destination_address: form.destination_address || '',
          destination_name:    form.destination_name || '',
          description:         form.incident_description || '',
          chauffeur_id:        selectedDriver || '',
        })
      })
      const data = await res.json()
      if (data.ticketUrl) setOdooTicketUrl(data.ticketUrl)
      if (data.taskUrl)   setOdooTaskUrl(data.taskUrl)
    } catch (e: any) {
      setOdooError(e.message)
    } finally {
      setLoadingOdoo(false)
    }
  }

  // Refuser la mission
  const handleRefuse = async () => {
    if (!confirm('Confirmer le refus de cette mission ?')) return
    setLoadingRefuse(true)
    await fetch('/api/missions/confirm', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mission_id: initialMission.id, action: 'refuse' })
    })
    setStatus('ignored')
    setLoadingRefuse(false)
    router.push('/dispatch')
  }


  const srcInfo    = SOURCE_LABELS[initialMission.source] || { label: '?', color: 'bg-zinc-600' }
  const statusInfo = STATUS_LABELS[status] || { label: status, color: 'text-zinc-400' }
  const canEdit    = ['new', 'dispatching'].includes(status)

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex">
      <Sidebar userName={userName} userRole={userRole} />

      <div className="flex-1 lg:ml-64 flex flex-col">
        {/* Header */}
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-8 py-5 sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <Link href="/dispatch" className="text-zinc-400 hover:text-white transition text-lg">←</Link>
            <div className="flex items-center gap-3 flex-1">
              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold text-white ${srcInfo.color}`}>
                {srcInfo.label}
              </span>
              <h1 className="text-white font-bold text-xl">
                Mission {initialMission.external_id}
              </h1>
              {initialMission.dossier_number && (
                <span className="text-zinc-500 text-sm font-mono">{initialMission.dossier_number}</span>
              )}
              <span className={`text-sm font-medium ${statusInfo.color}`}>• {statusInfo.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 text-xs">
                Reçu le {new Date(initialMission.received_at).toLocaleString('fr-BE')}
              </span>
              {initialMission.parse_confidence !== null && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  initialMission.parse_confidence >= 0.8 ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                }`}>
                  IA {Math.round(initialMission.parse_confidence * 100)}%
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 px-8 py-6">
          <div className="grid grid-cols-3 gap-6">

            {/* ── Colonne gauche : formulaire ───────────────────────── */}
            <div className="col-span-2 space-y-5">

              {/* Intervention */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>📋</span> Intervention
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Type de mission">
                    <Select value={form.mission_type} onChange={f('mission_type')} options={MISSION_TYPES} />
                  </Field>
                  <Field label="Type d'incident">
                    <Input value={form.incident_type} onChange={f('incident_type')} placeholder="Ex: pneu crevé, batterie..." />
                  </Field>
                  <div className="col-span-2">
                    <Field label="Description de l'incident">
                      <textarea
                        value={form.incident_description}
                        onChange={e => f('incident_description')(e.target.value)}
                        rows={3}
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand resize-none placeholder:text-zinc-600"
                        placeholder="Description complète..."
                      />
                    </Field>
                  </div>
                </div>
              </div>

              {/* Client facturé */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>🧾</span> Client facturé
                </h2>

                {/* Recherche Odoo */}
                <div className="relative mb-3">
                  <label className="block text-zinc-500 text-xs mb-1.5">Rechercher dans Odoo</label>
                  <input
                    value={clientQuery}
                    onChange={e => { setClientQuery(e.target.value); setShowClientDrop(true) }}
                    onFocus={() => setShowClientDrop(true)}
                    onBlur={() => setTimeout(() => setShowClientDrop(false), 150)}
                    placeholder="Min. 3 caractères — nom ou téléphone..."
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600"
                  />
                  {showClientDrop && clientResults.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl shadow-xl overflow-hidden max-h-64 overflow-y-auto">
                      {clientResults.map(c => (
                        <button key={c.id} type="button" onMouseDown={() => selectBilledClient(c)}
                          className="w-full text-left px-4 py-3 hover:bg-[#2a2a2a] transition border-b border-[#222] last:border-0">
                          <p className="text-white text-sm font-medium">{c.name}</p>
                          <p className="text-zinc-500 text-xs">{[c.phone || c.mobile, c.city].filter(Boolean).join(' · ')}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Badge lien Odoo */}
                {billedPartnerId && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-xl mb-3">
                    <span className="text-green-400 text-xs">✓ Lié Odoo #{billedPartnerId}</span>
                    <span className="text-green-300 text-xs font-medium">{form.billed_to_name}</span>
                    <button type="button" onClick={clearBilledClient}
                      className="ml-auto text-zinc-500 hover:text-red-400 text-xs">✕</button>
                  </div>
                )}

                <Field label="Nom / Raison sociale">
                  <Input value={form.billed_to_name} onChange={f('billed_to_name')} placeholder="Ex: Touring SA, Police Zone Vesdre..." />
                </Field>
                {!billedPartnerId && form.billed_to_name && (
                  <p className="text-amber-400/80 text-xs mt-1.5">⚠ Pas de contact Odoo lié — un nouveau sera créé à la confirmation.</p>
                )}
              </div>

              {/* Client assisté */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>👤</span> Client assisté (personne en panne)
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Nom complet">
                    <Input value={form.client_name} onChange={f('client_name')} placeholder="Prénom Nom" />
                  </Field>
                  <Field label="Téléphone">
                    <Input value={form.client_phone} onChange={f('client_phone')} placeholder="+32..." />
                  </Field>
                  <div className="col-span-2">
                    <AddressField
                      label="Adresse domicile"
                      value={form.client_address}
                      onChange={f('client_address')}
                      gmKey={googleMapsKey}
                      placeholder="Rue, numéro, ville..."
                    />
                  </div>
                </div>
              </div>

              {/* Véhicule */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>🚗</span> Véhicule
                </h2>

                {/* Badge lien véhicule Odoo + lookup automatique par plaque */}
                {odooVehicleId && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-xl mb-4">
                    <span className="text-green-400 text-xs">✓ Lié Odoo véhicule #{odooVehicleId}</span>
                    <button type="button" onClick={clearOdooVehicle}
                      className="ml-auto text-zinc-500 hover:text-red-400 text-xs">Délier ✕</button>
                  </div>
                )}
                {!odooVehicleId && vehicleSearched && vehicleResults.length === 0 && form.vehicle_plate.trim().length >= 3 && (
                  <p className="text-amber-400/80 text-xs mb-3">⚠ Aucun véhicule Odoo avec cette plaque — un nouveau sera créé à la confirmation.</p>
                )}
                {!odooVehicleId && vehicleResults.length > 0 && (
                  <div className="mb-4 bg-[#111] border border-brand/30 rounded-xl p-3">
                    <p className="text-zinc-400 text-xs mb-2">{vehicleResults.length} véhicule(s) trouvé(s) dans Odoo — clique pour lier (évite le doublon) :</p>
                    <div className="space-y-1">
                      {vehicleResults.map(v => {
                        const sim = vehicleSimilarity(v)
                        return (
                          <button key={v.id} type="button" onClick={() => selectOdooVehicle(v)}
                            className={`w-full text-left px-3 py-2 border rounded-lg transition ${
                              sim === 'match'    ? 'bg-green-500/10 hover:bg-green-500/20 border-green-500/30'    :
                              sim === 'mismatch' ? 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30'    :
                                                    'bg-[#1A1A1A] hover:bg-[#222] border-[#2a2a2a]'
                            }`}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-white text-sm">
                                <span className="font-mono font-semibold">{v.plate}</span>
                                <span className="text-zinc-400 ml-2">{[v.brand, v.model].filter(Boolean).join(' ')}</span>
                              </p>
                              {sim === 'match'    && <span className="text-green-400 text-xs">✓ correspond</span>}
                              {sim === 'mismatch' && <span className="text-amber-400 text-xs">⚠ marque/modèle ≠</span>}
                            </div>
                            {v.vin && <p className="text-zinc-500 text-xs">VIN: {v.vin}</p>}
                          </button>
                        )
                      })}
                    </div>
                    {/* Forcer la création d'un nouveau si l'utilisateur juge qu'aucun résultat ne correspond */}
                    {form.vehicle_plate.trim().length >= 3 && (
                      <button type="button" onClick={() => { setVehicleResults([]); setVehicleSearched(true) }}
                        className="mt-2 w-full text-center px-3 py-2 bg-[#0a0a0a] hover:bg-[#222] border border-dashed border-[#3a3a3a] rounded-lg text-zinc-400 hover:text-white text-xs transition">
                        ➕ Aucun ne correspond — créer un nouveau véhicule
                      </button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  <Field label="Plaque">
                    <Input value={form.vehicle_plate} onChange={f('vehicle_plate')} placeholder="1ABC234" />
                  </Field>
                  <Field label="Marque">
                    <select
                      value={form.vehicle_brand}
                      onFocus={loadBrands}
                      onChange={e => {
                        const b = brands.find(b => b.name === e.target.value)
                        f('vehicle_brand')(e.target.value)
                        f('vehicle_model')('')
                        setModels([])
                        if (b) loadModels(b.id)
                      }}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand"
                    >
                      <option value="">{loadingBrands ? 'Chargement...' : '— Sélectionner —'}</option>
                      {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Modèle">
                    {models.length > 0 ? (
                      <select value={form.vehicle_model} onChange={e => f('vehicle_model')(e.target.value)}
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand">
                        <option value="">— Sélectionner —</option>
                        {models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                        <option value="_custom">Autre (saisie libre)</option>
                      </select>
                    ) : (
                      <Input value={form.vehicle_model} onChange={f('vehicle_model')} placeholder={form.vehicle_brand ? 'Saisie libre...' : "Choisir une marque d'abord"} />
                    )}
                  </Field>
                  <Field label="Carburant">
                    <Select value={form.vehicle_fuel} onChange={f('vehicle_fuel')} options={FUEL_TYPES} />
                  </Field>
                  <Field label="Boîte de vitesses">
                    <Select value={form.vehicle_gearbox} onChange={f('vehicle_gearbox')} options={GEARBOX_TYPES} />
                  </Field>
                  <Field label="N° Châssis (VIN)">
                    <Input value={form.vehicle_vin} onChange={f('vehicle_vin')} placeholder="VIN..." />
                  </Field>
                </div>
              </div>

              {/* Lieu d'intervention / Destination */}
              {(() => {
                // Pas de destination pour :
                //  - DSP / Réparation sur place : pas de remorquage
                //  - Trajet vide / DPR (déplacement) : la destination est le prochain point
                //    d'intervention, géré séparément
                const noDestination = ['depannage', 'reparation_place', 'trajet_vide'].includes(form.mission_type)
                return (
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>📍</span> {noDestination ? 'Lieu d\'intervention' : 'Lieu d\'intervention / Destination'}
                </h2>
                <div className={noDestination ? '' : 'grid grid-cols-2 gap-6'}>
                  <div className="space-y-3">
                    {!noDestination && <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide">Lieu d'incident</p>}
                    <AddressField
                      label="Adresse complète"
                      value={form.incident_address}
                      onChange={v => { f('incident_address')(v); setIncidentGeo({ state: 'idle' }) }}
                      onSelect={(addr, lat, lng, city) => {
                        setForm(prev => ({
                          ...prev,
                          incident_address: addr,
                          incident_lat:     String(lat),
                          incident_lng:     String(lng),
                          ...(city ? { incident_city: city } : {}),
                        }))
                        setIncidentGeo({ state: 'confirmed', suggestion: { addr, lat, lng } })
                        silentPatch({ incident_address: addr, incident_lat: lat, incident_lng: lng, ...(city ? { incident_city: city } : {}) })
                      }}
                      gmKey={googleMapsKey}
                      placeholder="Tapez et choisissez une suggestion Google..."
                    />
                    <GeoStatusBanner status={incidentGeo} onReview={() => reopenReview('incident')} />
                    {initialMission.incident_address && initialMission.incident_address !== form.incident_address && (
                      <p className="text-zinc-600 text-xs">📥 Reçu : <span className="text-zinc-500">{initialMission.incident_address}</span></p>
                    )}
                    {isHighway(form.incident_address) && (
                      <div className="grid grid-cols-2 gap-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                        <div className="col-span-2 flex items-center gap-2 text-amber-400 text-xs font-medium">
                          🛣️ Autoroute détectée
                        </div>
                        <Field label="Borne kilométrique">
                          <Input value={form.incident_borne_km} onChange={f('incident_borne_km')} placeholder="Ex: 132.5 ou 132+200" />
                        </Field>
                        <Field label="Sens de circulation">
                          <Input value={form.incident_sens} onChange={f('incident_sens')} placeholder="Ex: vers Liège" />
                        </Field>
                      </div>
                    )}
                  </div>
                  {!noDestination && (
                  <div className="space-y-3">
                    <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide">Destination</p>
                    <AddressField
                      label="Adresse complète (nom de lieu inclus si garage, hôtel…)"
                      value={form.destination_address}
                      onChange={v => { f('destination_address')(v); setDestinationGeo({ state: 'idle' }) }}
                      onSelect={(addr, lat, lng, _city, name) => {
                        setForm(prev => ({
                          ...prev,
                          destination_address: addr,
                          destination_lat:     String(lat),
                          destination_lng:     String(lng),
                          ...(name ? { destination_name: name } : {}),
                        }))
                        setDestinationGeo({ state: 'confirmed', suggestion: { addr, lat, lng } })
                        silentPatch({ destination_address: addr, destination_lat: lat, destination_lng: lng, ...(name ? { destination_name: name } : {}) })
                      }}
                      gmKey={googleMapsKey}
                      placeholder="Ex: Garage Citroën Verviers, Rue..."
                    />
                    <GeoStatusBanner status={destinationGeo} onReview={() => reopenReview('destination')} />
                    {isHighway(form.destination_address) && (
                      <div className="grid grid-cols-2 gap-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                        <div className="col-span-2 flex items-center gap-2 text-amber-400 text-xs font-medium">
                          🛣️ Autoroute détectée
                        </div>
                        <Field label="Borne kilométrique">
                          <Input value={form.destination_borne_km} onChange={f('destination_borne_km')} placeholder="Ex: 132.5" />
                        </Field>
                        <Field label="Sens de circulation">
                          <Input value={form.destination_sens} onChange={f('destination_sens')} placeholder="Ex: vers Bruxelles" />
                        </Field>
                      </div>
                    )}
                  </div>
                  )}
                </div>
              </div>
                )
              })()}

              {/* Montant garanti + Paiement client */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>💶</span> Montants
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Montant garanti (EUR HTVA)">
                    <Input value={form.amount_guaranteed} onChange={f('amount_guaranteed')} placeholder="0.00" />
                  </Field>
                  <Field label="Paiement à réclamer au client (€)">
                    <Input value={form.amount_to_collect} onChange={f('amount_to_collect')} placeholder="0.00" />
                  </Field>
                </div>
              </div>

              {/* Compte rendu clôture */}
              {initialMission.status === 'completed' && (
                <div className="bg-[#1A1A1A] border border-green-500/20 rounded-2xl p-5">
                  <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                    <span>🏁</span> Compte rendu de mission
                  </h2>
                  <div className="space-y-3">
                    {initialMission.vehicle_mileage && (
                      <div><p className="text-zinc-500 text-xs">Kilométrage</p>
                        <p className="text-white text-sm font-semibold">{initialMission.vehicle_mileage.toLocaleString()} km</p></div>
                    )}
                    {initialMission.closing_notes && (
                      <div><p className="text-zinc-500 text-xs">Notes</p>
                        <p className="text-white text-sm whitespace-pre-wrap">{initialMission.closing_notes}</p></div>
                    )}
                    {initialMission.amount_collected && (
                      <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                        <p className="text-zinc-500 text-xs">Encaissement</p>
                        <p className="text-green-400 font-bold text-lg">{initialMission.amount_collected} €</p>
                        {initialMission.payment_method && <p className="text-zinc-400 text-xs capitalize">{initialMission.payment_method}</p>}
                      </div>
                    )}
                    {initialMission.client_signature && (
                      <div>
                        <p className="text-zinc-500 text-xs mb-1">Signature — {initialMission.client_signature_name}</p>
                        <div className="border border-[#2a2a2a] rounded-xl overflow-hidden bg-[#111]">
                          <img src={initialMission.client_signature} alt="Signature" className="w-full max-h-24 object-contain" />
                        </div>
                      </div>
                    )}
                    {initialMission.driver_photos && initialMission.driver_photos.length > 0 && (
                      <div>
                        <p className="text-zinc-500 text-xs mb-2">Photos ({initialMission.driver_photos.length})</p>
                        <div className="grid grid-cols-3 gap-2">
                          {initialMission.driver_photos.map((url: string, i: number) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt={`Photo ${i+1}`} className="w-full aspect-square object-cover rounded-xl" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Décharges */}
                    {(() => {
                      const discharges = initialMission.discharge_data?.length
                        ? initialMission.discharge_data
                        : initialMission.discharge_motif
                          ? [{ motif: initialMission.discharge_motif, name: initialMission.discharge_name || '', sig: initialMission.discharge_sig || '' }]
                          : []
                      if (!discharges.length) return null
                      return (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-zinc-500 text-xs">Décharge{discharges.length > 1 ? 's' : ''} ({discharges.length})</p>
                            <a
                              href={`/api/missions/${initialMission.id}/discharge-pdf`}
                              target="_blank" rel="noreferrer"
                              className="text-xs px-3 py-1 bg-blue-600/20 border border-blue-600/40 text-blue-400 rounded-lg hover:bg-blue-600/30 transition"
                            >
                              📄 Télécharger PDF
                            </a>
                          </div>
                          <div className="space-y-2">
                            {discharges.map((d, i) => (
                              <div key={i} className="bg-[#111] border border-amber-600/20 rounded-xl p-3 space-y-2">
                                <p className="text-amber-400 text-xs font-medium">Décharge {discharges.length > 1 ? i + 1 : ''}</p>
                                <p className="text-zinc-300 text-xs whitespace-pre-wrap">{d.motif}</p>
                                {d.name && <p className="text-zinc-500 text-xs">Signataire : <span className="text-zinc-300">{d.name}</span></p>}
                                {d.sig && (
                                  <div className="border border-[#2a2a2a] rounded-lg overflow-hidden bg-[#0F0F0F]">
                                    <img src={d.sig} alt="Signature" className="w-full max-h-16 object-contain" />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* Contenu brut */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl overflow-hidden">
                <button
                  onClick={() => setShowRawContent(!showRawContent)}
                  className="w-full flex items-center justify-between px-5 py-3 text-zinc-400 hover:text-white text-sm transition"
                >
                  <span className="flex items-center gap-2">
                    <span>📄</span>
                    Contenu brut ({initialMission.source_format?.toUpperCase()})
                  </span>
                  <span>{showRawContent ? '▲' : '▼'}</span>
                </button>
                {showRawContent && initialMission.raw_content && (
                  <pre className="px-5 pb-4 text-xs text-zinc-400 font-mono overflow-x-auto whitespace-pre-wrap border-t border-[#2a2a2a] pt-3 max-h-96 overflow-y-auto">
                    {initialMission.raw_content}
                  </pre>
                )}
              </div>
            </div>

            {/* ── Colonne droite : actions + chauffeur + logs ───────── */}
            <div className="space-y-5">

              {/* Actions */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5 space-y-3">

                {/* Avertissement véhicule en attente de décision — bloque save/confirm */}
                {vehicleDecisionPending && (
                  <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl px-3 py-2.5">
                    <p className="text-amber-400 text-xs font-semibold mb-1">⚠ Véhicule à valider</p>
                    <p className="text-amber-200/80 text-xs">
                      Choisis « Lier » sur un véhicule existant ou clique « Aucun ne correspond — créer un nouveau véhicule » pour pouvoir sauvegarder.
                    </p>
                  </div>
                )}

                {/* Statut new → Confirmer / Refuser */}
                {status === 'new' && (
                  <>
                    <button
                      onClick={handleConfirm}
                      disabled={loadingConfirm || vehicleDecisionPending}
                      className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-sm transition disabled:opacity-50"
                    >
                      {loadingConfirm ? 'Confirmation...' : '✅ Confirmer la mission'}
                    </button>
                    <button
                      onClick={handleRefuse}
                      disabled={loadingRefuse}
                      className="w-full py-3 bg-[#111] hover:bg-red-600/20 border border-[#2a2a2a] hover:border-red-600/50 text-zinc-400 hover:text-red-400 rounded-xl font-medium text-sm transition disabled:opacity-50"
                    >
                      {loadingRefuse ? 'Refus...' : '❌ Refuser'}
                    </button>
                    <div className="border-t border-[#2a2a2a] pt-3">
                      <button
                        onClick={handleSave}
                        disabled={loadingSave || vehicleDecisionPending}
                        className="w-full py-2.5 bg-[#111] hover:bg-[#2a2a2a] border border-[#2a2a2a] text-zinc-400 hover:text-white rounded-xl text-sm transition disabled:opacity-50"
                      >
                        {loadingSave ? 'Sauvegarde...' : saveOk ? '✅ Sauvegardé !' : '💾 Sauvegarder'}
                      </button>
                    </div>
                  </>
                )}

                {/* Statut dispatching → save (modif possible) + indication + Annuler */}
                {status === 'dispatching' && (
                  <>
                    <div className="text-center py-2">
                      <span className="text-blue-400 font-semibold text-sm">📡 En attente d'assignation</span>
                      <p className="text-zinc-500 text-xs mt-1">Clique « Choisir un chauffeur » plus haut pour assigner</p>
                    </div>
                    <button
                      onClick={handleSave}
                      disabled={loadingSave || vehicleDecisionPending}
                      className="w-full py-3 bg-brand hover:bg-brand/80 text-white rounded-xl font-semibold text-sm transition disabled:opacity-50"
                    >
                      {loadingSave ? 'Sauvegarde...' : saveOk ? '✅ Sauvegardé !' : '💾 Sauvegarder les modifications'}
                    </button>
                    <button
                      onClick={handleRefuse}
                      disabled={loadingRefuse}
                      className="w-full py-2.5 bg-[#111] hover:bg-red-600/20 border border-[#2a2a2a] hover:border-red-600/50 text-zinc-400 hover:text-red-400 rounded-xl font-medium text-sm transition disabled:opacity-50"
                    >
                      {loadingRefuse ? 'Annulation...' : '🚫 Annuler la mission'}
                    </button>
                  </>
                )}

                {/* Autres statuts — statut + sauvegarder */}
                {!['new', 'dispatching'].includes(status) && (
                  <>
                    <div className={`text-center py-2 font-semibold text-sm ${statusInfo.color}`}>
                      {statusInfo.label}
                    </div>
                    {!['completed', 'ignored'].includes(status) && (
                      <button
                        onClick={handleSave}
                        disabled={loadingSave || vehicleDecisionPending}
                        className="w-full py-3 bg-brand hover:bg-brand/80 text-white rounded-xl font-semibold text-sm transition disabled:opacity-50"
                      >
                        {loadingSave ? 'Sauvegarde...' : saveOk ? '✅ Sauvegardé — chauffeur notifié' : '💾 Sauvegarder les modifications'}
                      </button>
                    )}
                  </>
                )}

                {/* Dépôt de départ — sert au calcul KM aller/retour */}
                <div className="border-t border-[#2a2a2a] pt-4">
                  <label className="block text-zinc-500 text-xs mb-2">Dépôt de départ</label>
                  <select value={depotId} onChange={e => setDepotId(e.target.value)}
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand">
                    <option value="">— Choisir —</option>
                    {depots.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.is_default ? '(défaut)' : ''} — {d.address}
                      </option>
                    ))}
                  </select>
                  {depots.length === 0 && (
                    <p className="text-zinc-600 text-xs mt-1.5">Aucun dépôt configuré — <Link href="/admin/depots" className="text-brand underline">configurer dans /admin/depots</Link></p>
                  )}
                </div>

                {/* Assignation chauffeur */}
                <div className="border-t border-[#2a2a2a] pt-4">
                  <p className="text-zinc-500 text-xs mb-2">Assigner à un chauffeur</p>
                  {['completed', 'ignored', 'cancelled'].includes(status) ? (
                    <div className="bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-zinc-400 text-sm">
                      {initialMission.assigned_user?.name || '— Non assigné —'}
                    </div>
                  ) : (
                    <>
                      {/* Chauffeur déjà sélectionné */}
                      {selectedDriver ? (
                        <div className="flex items-center justify-between gap-2 bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 mb-2">
                          <span className="text-white text-sm">
                            {drivers.find(d => d.id === selectedDriver)?.name || '— inconnu —'}
                          </span>
                          <button type="button" onClick={() => setSelectedDriver('')}
                            className="text-zinc-500 hover:text-red-400 text-xs">Délier ✕</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setShowDriverModal(true)}
                          className="w-full px-4 py-2.5 bg-brand hover:bg-brand/80 text-white text-sm font-semibold rounded-xl transition mb-2">
                          🚛 Choisir un chauffeur (avec ETA temps réel)
                        </button>
                      )}
                    </>
                  )}
                  {initialMission.assigned_user && (
                    <p className="text-xs text-zinc-500 mt-1">
                      Assigné à <span className="text-green-400 font-medium">{initialMission.assigned_user.name}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* ── Suivi chauffeur (P6) ─────────────────────────────── */}
              {['assigned', 'accepted', 'in_progress', 'completed'].includes(status) && (
                <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                  <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-4">
                    🚗 Suivi chauffeur
                  </h3>
                  <DriverTimeline mission={{
                    status,
                    assigned_at:     M.assigned_at,
                    accepted_at:     M.accepted_at,
                    on_way_at:       M.on_way_at,
                    on_site_at:      M.on_site_at,
                    completed_at:    M.completed_at,
                    parked_at:       (M as any).parked_at,
                    delivering_at:   (M as any).delivering_at,
                    extra_addresses: (M as any).extra_addresses,
                    assigned_user:   M.assigned_user || initialMission.assigned_user,
                  }} />
                  <MissionKmInfo missionId={initialMission.id} refreshKey={`save-${kmRefresh}`} />
                </div>
              )}

              {/* Photos chauffeur */}
              {M.driver_photos && M.driver_photos.length > 0 && (
                <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                  <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-3">
                    📷 Photos chauffeur ({M.driver_photos.length})
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {M.driver_photos.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="aspect-square rounded-xl overflow-hidden block">
                        <img src={url} className="w-full h-full object-cover hover:opacity-80 transition" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Récap numéros */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-3">Référence</h3>
                <div className="space-y-2">
                  <div>
                    <p className="text-zinc-500 text-xs">N° Mission</p>
                    <p className="text-white font-mono text-sm">{initialMission.external_id}</p>
                  </div>
                  {initialMission.dossier_number && (
                    <div>
                      <p className="text-zinc-500 text-xs">N° Dossier</p>
                      <p className="text-white font-mono text-sm">{initialMission.dossier_number}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-zinc-500 text-xs">Source</p>
                    <span className={`inline-block mt-0.5 px-2 py-0.5 rounded text-xs font-bold text-white ${srcInfo.color}`}>
                      {srcInfo.label}
                    </span>
                  </div>
                  <div>
                    <p className="text-zinc-500 text-xs">Reçu</p>
                    <p className="text-zinc-300 text-xs">{new Date(initialMission.received_at).toLocaleString('fr-BE')}</p>
                  </div>
                  {initialMission.incident_at && (
                    <div>
                      <p className="text-zinc-500 text-xs">Incident</p>
                      <p className="text-zinc-300 text-xs">{new Date(initialMission.incident_at).toLocaleString('fr-BE')}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Bouton dossier Odoo FSM */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-3">Dossier Odoo</h3>
                {odooTicketUrl ? (
                  <a href={odooTicketUrl} target="_blank" rel="noopener noreferrer"
                    className="block w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium text-center transition">
                    🔗 Ouvrir le dossier Odoo ↗
                  </a>
                ) : loadingOdoo ? (
                  <div className="text-zinc-500 text-sm text-center py-2">⏳ Création dossier Odoo...</div>
                ) : odooError ? (
                  <div className="space-y-2">
                    <p className="text-red-400 text-xs">{odooError}</p>
                    <button onClick={createOdooFsmDossier}
                      className="w-full py-2 bg-purple-600/20 border border-purple-600/30 text-purple-400 rounded-xl text-xs">
                      🔄 Réessayer
                    </button>
                  </div>
                ) : (
                  <button onClick={createOdooFsmDossier}
                    className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium transition">
                    📋 Créer dossier Odoo
                  </button>
                )}
              </div>

              {/* Bouton enrichissement IMA */}
              {imaLink && (
                <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                  <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-3">Portail IMA</h3>
                  {imaSuccess ? (
                    <div className="text-green-400 text-sm text-center py-2">✅ Données enrichies !</div>
                  ) : (
                    <>
                      <button
                        onClick={handleFetchIMA}
                        disabled={loadingIMA}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition disabled:opacity-50 mb-2"
                      >
                        {loadingIMA ? 'Récupération...' : '🔗 Enrichir depuis IMA'}
                      </button>
                      <a href={imaLink} target="_blank" rel="noopener noreferrer"
                        className="block w-full py-2 bg-[#111] border border-[#2a2a2a] text-zinc-400 hover:text-white rounded-xl text-xs text-center transition">
                        Ouvrir le portail IMA ↗
                      </a>
                    </>
                  )}
                </div>
              )}

              {/* Historique */}
              {logs.length > 0 && (
                <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                  <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-3">Historique</h3>
                  <div className="space-y-3">
                    {logs.slice(0, 8).map(log => (
                      <div key={log.id} className="flex gap-2">
                        <span className="text-base leading-none mt-0.5">{LOG_ICONS[log.action] || '•'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-zinc-300 text-xs">{log.notes || log.action}</p>
                          <p className="text-zinc-600 text-xs">
                            {log.actor?.name && `${log.actor.name} · `}
                            {new Date(log.created_at).toLocaleString('fr-BE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal de sélection chauffeur avec ETA temps réel + cap 90 km/h camion */}
      {showDriverModal && (
        <DriverPickerModal
          missionId={initialMission.id}
          incidentLat={form.incident_lat ? Number(form.incident_lat) : null}
          incidentLng={form.incident_lng ? Number(form.incident_lng) : null}
          onPick={async (driverId) => {
            setSelectedDriver(driverId)
            setShowDriverModal(false)
            // Si la mission est déjà confirmée, on assigne directement (pas besoin de cliquer "Assigner")
            if (status === 'dispatching') {
              await fetch('/api/missions/assign', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ mission_id: initialMission.id, driver_id: driverId }),
              })
              setStatus('assigned')
              router.push('/dispatch')
            }
          }}
          onClose={() => setShowDriverModal(false)}
        />
      )}

      {/* Modal de vérification d'adresse — bloque tant que le dispatcher n'a pas choisi */}
      {activeReview && (
        <AddressReviewModal
          which={activeReview}
          parsedAddress={
            activeReview === 'incident'
              ? (initialMission.incident_address || form.incident_address)
              : (initialMission.destination_address || form.destination_address)
          }
          currentAddress={
            activeReview === 'incident' ? form.incident_address : form.destination_address
          }
          googleSuggestion={
            activeReview === 'incident' ? incidentGeo.suggestion : destinationGeo.suggestion
          }
          gmKey={googleMapsKey}
          onPick={(addr, lat, lng) => {
            if (activeReview === 'incident') {
              setForm(prev => ({
                ...prev,
                incident_address: addr,
                incident_lat:     lat != null ? String(lat) : prev.incident_lat,
                incident_lng:     lng != null ? String(lng) : prev.incident_lng,
              }))
              setIncidentGeo(lat != null
                ? { state: 'confirmed', suggestion: { addr, lat, lng: lng! } }
                : { state: 'not_found' })
              silentPatch({ incident_address: addr, ...(lat != null ? { incident_lat: lat, incident_lng: lng } : {}) })
            } else {
              setForm(prev => ({
                ...prev,
                destination_address: addr,
                destination_lat:     lat != null ? String(lat) : prev.destination_lat,
                destination_lng:     lng != null ? String(lng) : prev.destination_lng,
              }))
              setDestinationGeo(lat != null
                ? { state: 'confirmed', suggestion: { addr, lat, lng: lng! } }
                : { state: 'not_found' })
              silentPatch({ destination_address: addr, ...(lat != null ? { destination_lat: lat, destination_lng: lng } : {}) })
            }
            closeReview()
          }}
          onSkip={closeReview}
        />
      )}
    </div>
  )
}
