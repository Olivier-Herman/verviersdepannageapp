'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter }   from 'next/navigation'
import Link            from 'next/link'
import { signOut }     from 'next-auth/react'
import { usePathname } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OdooClient {
  id:     number
  name:   string
  phone:  string | false
  mobile: string | false
  street: string | false
  city:   string | false
  zip:    string | false
  email:  string | false
}

interface OdooVehicle {
  id:           number
  plate:        string
  vin:          string | false
  brand:        string
  model:        string
  partner_id:   number | null
  partner_name: string | null
  fuel:         string
  gearbox:      string
}

interface Driver { id: string; name: string }

// ── Constantes ────────────────────────────────────────────────────────────────

const ALL_SOURCES = [
  { value: 'touring',  label: 'TOURING' },
  { value: 'ethias',   label: 'ETHIAS' },
  { value: 'vivium',   label: 'VIVIUM' },
  { value: 'ipa',      label: 'IPA (AXA)' },
  { value: 'ardenne',  label: 'ARDENNE (IPA)' },
  { value: 'mondial',  label: 'MONDIAL' },
  { value: 'vab',      label: 'VAB' },
  { value: 'police',   label: 'POLICE' },
  { value: 'prive',    label: 'PRIVÉ' },
  { value: 'garage',   label: 'GARAGE' },
]

const MISSION_TYPES = [
  { value: 'remorquage',       label: '🚛 Remorquage' },
  { value: 'depannage',        label: '🔧 Dépannage' },
  { value: 'transport',        label: '🚐 Transport' },
  { value: 'trajet_vide',      label: '📍 Trajet vide' },
  { value: 'reparation_place', label: '🔩 Réparation sur place' },
  { value: 'autre',            label: '📋 Autre' },
]

const FUEL_TYPES    = ['Diesel', 'Essence', 'Hybride', 'Électrique', 'GPL', 'Autre']
const GEARBOX_TYPES = ['Manuelle', 'Automatique', 'Semi-automatique']

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/dispatch',  label: 'Dispatch',  icon: '📡' },
  { href: '/admin',     label: 'Admin',     icon: '⚙️' },
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
              }`}>
              <span>{item.icon}</span>{item.label}
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

// ── Hook autocomplete client Odoo ─────────────────────────────────────────────

function useClientSearch() {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<OdooClient[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<NodeJS.Timeout>()

  useEffect(() => {
    if (query.length < 3) { setResults([]); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res  = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data.clients || [])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [query])

  return { query, setQuery, results, loading, setResults }
}

// ── Hook autocomplete véhicule Odoo ───────────────────────────────────────────

function useVehicleSearch() {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<OdooVehicle[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<NodeJS.Timeout>()

  useEffect(() => {
    if (query.length < 3) { setResults([]); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res  = await fetch(`/api/odoo/search-vehicle?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data.vehicles || [])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [query])

  return { query, setQuery, results, loading, setResults }
}

// ── Hook Google Maps Autocomplete ─────────────────────────────────────────────

function usePlacesAutocomplete(
  inputRef: React.RefObject<HTMLInputElement>,
  onSelect: (address: string, lat: number, lng: number) => void,
  googleMapsKey: string
) {
  useEffect(() => {
    if (!inputRef.current || !googleMapsKey || typeof window === 'undefined') return

    const loadScript = () => {
      if ((window as any).google?.maps?.places) {
        initAutocomplete()
        return
      }
      if (document.getElementById('gmaps-script')) return
      const script = document.createElement('script')
      script.id  = 'gmaps-script'
      script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsKey}&libraries=places&language=fr`
      script.onload = initAutocomplete
      document.head.appendChild(script)
    }

    const initAutocomplete = () => {
      if (!inputRef.current) return
      const autocomplete = new (window as any).google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: ['be', 'lu', 'fr', 'nl', 'de'] },
        fields: ['formatted_address', 'geometry'],
      })
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        if (place.geometry) {
          onSelect(
            place.formatted_address || '',
            place.geometry.location.lat(),
            place.geometry.location.lng()
          )
        }
      })
    }

    loadScript()
  }, [inputRef, googleMapsKey, onSelect])
}

// ── Composant champ adresse Google Maps ──────────────────────────────────────

function AddressInput({
  label, value, onChange, onSelect, googleMapsKey, placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onSelect: (address: string, lat: number, lng: number) => void
  googleMapsKey: string
  placeholder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const handleSelect = useCallback(onSelect, [])
  usePlacesAutocomplete(inputRef, handleSelect, googleMapsKey)

  return (
    <div>
      <label className="block text-zinc-500 text-xs mb-1.5">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600 pr-8"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 text-sm">📍</span>
      </div>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function NewMissionClient({
  drivers, userName, userRole, googleMapsKey
}: {
  drivers: Driver[]
  userName: string
  userRole: string
  googleMapsKey: string
}) {
  const router = useRouter()

  // Sources
  const [source, setSource] = useState('prive')

  // Client
  const clientSearch = useClientSearch()
  const [selectedClient,   setSelectedClient]   = useState<OdooClient | null>(null)
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const [clientName,   setClientName]   = useState('')
  const [clientPhone,  setClientPhone]  = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const [clientLat,    setClientLat]    = useState<number|null>(null)
  const [clientLng,    setClientLng]    = useState<number|null>(null)
  const [odooPartnerId, setOdooPartnerId] = useState<number|null>(null)
  const clientAddressRef = useRef<HTMLInputElement>(null)

  // Véhicule
  const vehicleSearch = useVehicleSearch()
  const [selectedVehicle, setSelectedVehicle]  = useState<OdooVehicle | null>(null)
  const [showVehicleDropdown, setShowVehicleDropdown] = useState(false)
  const [plate,    setPlate]    = useState('')
  const [brand,    setBrand]    = useState('')
  const [model,    setModel]    = useState('')
  const [vin,      setVin]      = useState('')
  const [fuel,     setFuel]     = useState('')
  const [gearbox,  setGearbox]  = useState('')
  const [odooVehicleId, setOdooVehicleId] = useState<number|null>(null)

  // Mission
  const [missionType,   setMissionType]   = useState('depannage')
  const [incidentType,  setIncidentType]  = useState('')
  const [description,   setDescription]   = useState('')

  // Lieux
  const [incidentAddress, setIncidentAddress] = useState('')
  const [incidentCity,    setIncidentCity]    = useState('')
  const [incidentLat,     setIncidentLat]     = useState<number|null>(null)
  const [incidentLng,     setIncidentLng]     = useState<number|null>(null)
  const [destName,        setDestName]        = useState('')
  const [destAddress,     setDestAddress]     = useState('')
  const [destLat,         setDestLat]         = useState<number|null>(null)
  const [destLng,         setDestLng]         = useState<number|null>(null)

  // Distance
  const [distanceKm,   setDistanceKm]   = useState<number|null>(null)
  const [durationMin,  setDurationMin]  = useState<number|null>(null)
  const [calcLoading,  setCalcLoading]  = useState(false)

  // Soumission
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  // Calculer distance quand incident + destination sont définis
  useEffect(() => {
    if (!incidentLat || !incidentLng || !destLat || !destLng) return
    if (!googleMapsKey) return
    setCalcLoading(true)

    const service = new (window as any).google.maps.DistanceMatrixService()
    service.getDistanceMatrix({
      origins:      [{ lat: incidentLat, lng: incidentLng }],
      destinations: [{ lat: destLat,     lng: destLng }],
      travelMode:   'DRIVING',
      unitSystem:   0, // METRIC
    }, (response: any, status: string) => {
      setCalcLoading(false)
      if (status === 'OK') {
        const element = response.rows[0].elements[0]
        if (element.status === 'OK') {
          setDistanceKm(Math.round(element.distance.value / 1000))
          setDurationMin(Math.round(element.duration.value / 60))
        }
      }
    })
  }, [incidentLat, incidentLng, destLat, destLng])

  // Sélection client Odoo
  const selectClient = (c: OdooClient) => {
    setSelectedClient(c)
    setClientName(c.name)
    setClientPhone(String(c.phone || c.mobile || ''))
    if (c.street && c.city) setClientAddress(`${c.street}, ${c.zip || ''} ${c.city}`.trim())
    setOdooPartnerId(c.id)
    setShowClientDropdown(false)
    clientSearch.setQuery(c.name)
    clientSearch.setResults([])
  }

  // Sélection véhicule Odoo
  const selectVehicle = (v: OdooVehicle) => {
    setSelectedVehicle(v)
    setPlate(v.plate)
    setBrand(v.brand)
    setModel(v.model)
    setVin(String(v.vin || ''))
    setFuel(v.fuel)
    setGearbox(v.gearbox)
    setOdooVehicleId(v.id)
    // Si le véhicule a un propriétaire et pas encore de client sélectionné
    if (v.partner_name && !selectedClient) {
      setClientName(v.partner_name)
      setOdooPartnerId(v.partner_id)
    }
    setShowVehicleDropdown(false)
    vehicleSearch.setQuery(v.plate)
    vehicleSearch.setResults([])
  }

  const handleSubmit = async () => {
    if (!missionType)     return setError('Type de mission requis')
    if (!plate && !clientName) return setError('Client ou véhicule requis')

    setSaving(true)
    setError('')

    try {
      // Créer client Odoo si pas lié
      let finalPartnerId = odooPartnerId
      if (!finalPartnerId && clientName.trim()) {
        const res = await fetch('/api/odoo/create-client', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            name:   clientName,
            phone:  clientPhone,
            street: clientAddress,
          })
        })
        const data = await res.json()
        if (data.partner) finalPartnerId = data.partner.id
      }

      // Créer véhicule Odoo si pas lié
      let finalVehicleId = odooVehicleId
      if (!finalVehicleId && plate.trim()) {
        const res = await fetch('/api/odoo/create-vehicle', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            plate, vin, brand, model, fuel, gearbox,
            partner_id: finalPartnerId,
          })
        })
        const data = await res.json()
        if (data.vehicle_id) finalVehicleId = data.vehicle_id
      }

      // Créer la mission
      const res = await fetch('/api/missions/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          source,
          mission_type:         missionType,
          incident_type:        incidentType,
          incident_description: description,
          client_name:          clientName,
          client_phone:         clientPhone,
          client_address:       clientAddress,
          client_lat:           clientLat,
          client_lng:           clientLng,
          vehicle_plate:        plate,
          vehicle_brand:        brand,
          vehicle_model:        model,
          vehicle_vin:          vin,
          vehicle_fuel:         fuel,
          vehicle_gearbox:      gearbox,
          incident_address:     incidentAddress,
          incident_city:        incidentCity,
          incident_lat:         incidentLat,
          incident_lng:         incidentLng,
          destination_name:     destName,
          destination_address:  destAddress,
          destination_lat:      destLat,
          destination_lng:      destLng,
          distance_km:          distanceKm,
          duration_min:         durationMin,
          odoo_partner_id:      finalPartnerId,
          odoo_vehicle_id:      finalVehicleId,
          incident_at:          new Date().toISOString(),
        })
      })

      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Erreur création')
      router.push(`/dispatch/${data.mission_id}`)

    } catch (err: any) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex">
      <Sidebar userName={userName} userRole={userRole} />

      <div className="flex-1 lg:ml-64 flex flex-col">
        {/* Header */}
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 lg:px-8 py-5 sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <Link href="/dispatch" className="text-zinc-400 hover:text-white text-lg">←</Link>
            <h1 className="text-white font-bold text-xl">Nouvelle mission manuelle</h1>
          </div>
        </div>

        <div className="flex-1 px-4 lg:px-8 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl">

            {/* ── Colonne principale ───────────────────────────── */}
            <div className="lg:col-span-2 space-y-5">

              {/* Source + Type mission */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4">📋 Intervention</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Source</label>
                    <select value={source} onChange={e => setSource(e.target.value)}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand">
                      {ALL_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Type de mission</label>
                    <select value={missionType} onChange={e => setMissionType(e.target.value)}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand">
                      {MISSION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Type d'incident</label>
                    <input value={incidentType} onChange={e => setIncidentType(e.target.value)}
                      placeholder="Ex: pneu crevé, batterie..."
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-zinc-500 text-xs mb-1.5">Description</label>
                    <textarea value={description} onChange={e => setDescription(e.target.value)}
                      rows={2} placeholder="Détails de l'incident..."
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand resize-none placeholder:text-zinc-600" />
                  </div>
                </div>
              </div>

              {/* Client */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4">👤 Client / Assuré</h2>

                {/* Recherche Odoo */}
                <div className="relative mb-4">
                  <label className="block text-zinc-500 text-xs mb-1.5">Rechercher dans Odoo (nom ou téléphone)</label>
                  <input
                    value={clientSearch.query}
                    onChange={e => { clientSearch.setQuery(e.target.value); setShowClientDropdown(true) }}
                    onFocus={() => setShowClientDropdown(true)}
                    placeholder="Min. 3 caractères..."
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600"
                  />
                  {clientSearch.loading && (
                    <div className="absolute right-3 top-8 text-zinc-500 text-xs">...</div>
                  )}
                  {showClientDropdown && clientSearch.results.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl shadow-xl overflow-hidden">
                      {clientSearch.results.map(c => (
                        <button key={c.id} onClick={() => selectClient(c)}
                          className="w-full text-left px-4 py-3 hover:bg-[#2a2a2a] transition border-b border-[#222] last:border-0">
                          <p className="text-white text-sm font-medium">{c.name}</p>
                          <p className="text-zinc-500 text-xs">
                            {[c.phone || c.mobile, c.city].filter(Boolean).join(' · ')}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedClient && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-xl mb-4">
                    <span className="text-green-400 text-xs">✓ Client Odoo lié</span>
                    <span className="text-green-300 text-xs font-medium">{selectedClient.name}</span>
                    <button onClick={() => { setSelectedClient(null); setOdooPartnerId(null); clientSearch.setQuery('') }}
                      className="ml-auto text-zinc-500 hover:text-red-400 text-xs">✕</button>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Nom complet</label>
                    <input value={clientName} onChange={e => setClientName(e.target.value)}
                      placeholder="Prénom Nom"
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Téléphone</label>
                    <input value={clientPhone} onChange={e => setClientPhone(e.target.value)}
                      placeholder="+32..."
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                  </div>
                  <div className="sm:col-span-2">
                    <AddressInput
                      label="Adresse domicile"
                      value={clientAddress}
                      onChange={setClientAddress}
                      onSelect={(addr, lat, lng) => { setClientAddress(addr); setClientLat(lat); setClientLng(lng) }}
                      googleMapsKey={googleMapsKey}
                      placeholder="Rue, numéro, ville"
                    />
                  </div>
                </div>
              </div>

              {/* Véhicule */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4">🚗 Véhicule</h2>

                {/* Recherche véhicule Odoo */}
                <div className="relative mb-4">
                  <label className="block text-zinc-500 text-xs mb-1.5">Rechercher dans le parc (plaque ou VIN)</label>
                  <input
                    value={vehicleSearch.query}
                    onChange={e => { vehicleSearch.setQuery(e.target.value); setShowVehicleDropdown(true) }}
                    onFocus={() => setShowVehicleDropdown(true)}
                    placeholder="Min. 3 caractères..."
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600 uppercase"
                  />
                  {vehicleSearch.loading && (
                    <div className="absolute right-3 top-8 text-zinc-500 text-xs">...</div>
                  )}
                  {showVehicleDropdown && vehicleSearch.results.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl shadow-xl overflow-hidden">
                      {vehicleSearch.results.map(v => (
                        <button key={v.id} onClick={() => selectVehicle(v)}
                          className="w-full text-left px-4 py-3 hover:bg-[#2a2a2a] transition border-b border-[#222] last:border-0">
                          <p className="text-white text-sm font-bold font-mono">{v.plate}</p>
                          <p className="text-zinc-400 text-xs">{[v.brand, v.model].filter(Boolean).join(' ')} {v.partner_name ? `· ${v.partner_name}` : ''}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedVehicle && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-xl mb-4">
                    <span className="text-green-400 text-xs">✓ Véhicule Odoo lié</span>
                    <span className="text-green-300 text-xs font-medium font-mono">{selectedVehicle.plate}</span>
                    <button onClick={() => { setSelectedVehicle(null); setOdooVehicleId(null); vehicleSearch.setQuery('') }}
                      className="ml-auto text-zinc-500 hover:text-red-400 text-xs">✕</button>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Plaque</label>
                    <input value={plate} onChange={e => setPlate(e.target.value.toUpperCase())}
                      placeholder="1ABC234"
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm font-mono uppercase focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Marque</label>
                    <input value={brand} onChange={e => setBrand(e.target.value)}
                      placeholder="BMW"
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Modèle</label>
                    <input value={model} onChange={e => setModel(e.target.value)}
                      placeholder="Série 3"
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Carburant</label>
                    <select value={fuel} onChange={e => setFuel(e.target.value)}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand">
                      <option value="">—</option>
                      {FUEL_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Boîte</label>
                    <select value={gearbox} onChange={e => setGearbox(e.target.value)}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand">
                      <option value="">—</option>
                      {GEARBOX_TYPES.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">VIN / Châssis</label>
                    <input value={vin} onChange={e => setVin(e.target.value.toUpperCase())}
                      placeholder="VIN..."
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm font-mono uppercase focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                  </div>
                </div>
              </div>

              {/* Lieux */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4">📍 Lieu d'intervention / Destination</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide">Lieu d'incident</p>
                    <AddressInput
                      label="Adresse"
                      value={incidentAddress}
                      onChange={v => { setIncidentAddress(v); setIncidentLat(null); setIncidentLng(null) }}
                      onSelect={(addr, lat, lng) => {
                        setIncidentAddress(addr)
                        setIncidentLat(lat)
                        setIncidentLng(lng)
                        // Extraire la ville
                        const parts = addr.split(',')
                        if (parts.length > 1) setIncidentCity(parts[parts.length - 2]?.trim() || '')
                      }}
                      googleMapsKey={googleMapsKey}
                      placeholder="Rue, autoroute..."
                    />
                    <div>
                      <label className="block text-zinc-500 text-xs mb-1.5">Ville</label>
                      <input value={incidentCity} onChange={e => setIncidentCity(e.target.value)}
                        placeholder="4800 Verviers"
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide">Destination</p>
                    <div>
                      <label className="block text-zinc-500 text-xs mb-1.5">Nom du lieu</label>
                      <input value={destName} onChange={e => setDestName(e.target.value)}
                        placeholder="Garage, domicile..."
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                    </div>
                    <AddressInput
                      label="Adresse"
                      value={destAddress}
                      onChange={v => { setDestAddress(v); setDestLat(null); setDestLng(null) }}
                      onSelect={(addr, lat, lng) => { setDestAddress(addr); setDestLat(lat); setDestLng(lng) }}
                      googleMapsKey={googleMapsKey}
                      placeholder="Rue, numéro, ville"
                    />
                  </div>
                </div>

                {/* Distance calculée */}
                {(distanceKm !== null || calcLoading) && (
                  <div className="mt-4 flex items-center gap-3 px-4 py-3 bg-[#111] border border-[#2a2a2a] rounded-xl">
                    {calcLoading ? (
                      <span className="text-zinc-500 text-sm">Calcul de la distance...</span>
                    ) : (
                      <>
                        <span className="text-zinc-400 text-sm">🛣️ Distance estimée :</span>
                        <span className="text-white font-semibold">{distanceKm} km</span>
                        <span className="text-zinc-500">·</span>
                        <span className="text-white font-semibold">~{durationMin} min</span>
                        <span className="text-zinc-500 text-xs">(voiture — camion +15-20%)</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Colonne droite : actions ──────────────────────── */}
            <div className="space-y-4">
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5 sticky top-[89px] space-y-3">
                {error && (
                  <div className="px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <button onClick={handleSubmit} disabled={saving}
                  className="w-full py-3 bg-brand hover:bg-brand-dark text-white rounded-xl font-semibold text-sm transition disabled:opacity-50">
                  {saving ? 'Création en cours...' : '✅ Créer la mission'}
                </button>

                <Link href="/dispatch"
                  className="block w-full py-2.5 bg-[#111] border border-[#2a2a2a] text-zinc-400 hover:text-white rounded-xl text-sm text-center transition">
                  Annuler
                </Link>

                {/* Résumé */}
                <div className="border-t border-[#2a2a2a] pt-4 space-y-2">
                  <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide">Résumé</p>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Source</span>
                      <span className="text-white uppercase">{source}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Type</span>
                      <span className="text-white">{MISSION_TYPES.find(t => t.value === missionType)?.label || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Client</span>
                      <span className="text-white truncate max-w-[140px]">{clientName || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Véhicule</span>
                      <span className="text-white font-mono">{plate || '—'}</span>
                    </div>
                    {odooPartnerId && (
                      <div className="flex items-center gap-1.5 text-green-400">
                        <span>✓</span><span>Client Odoo lié</span>
                      </div>
                    )}
                    {odooVehicleId && (
                      <div className="flex items-center gap-1.5 text-green-400">
                        <span>✓</span><span>Véhicule Odoo lié</span>
                      </div>
                    )}
                    {distanceKm !== null && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Distance</span>
                        <span className="text-white">{distanceKm} km · ~{durationMin} min</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
