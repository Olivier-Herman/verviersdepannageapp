'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter }   from 'next/navigation'
import Link            from 'next/link'
import { signOut }     from 'next-auth/react'
import { usePathname } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OdooClient {
  id: number; name: string; phone: string|false; mobile: string|false
  street: string|false; city: string|false; zip: string|false; email: string|false
}
interface OdooVehicle {
  id: number; plate: string; vin: string|false; brand: string; model: string
  partner_id: number|null; partner_name: string|null; fuel: string; gearbox: string
}
interface Warning { id: string; label: string; icon: string; color: string }
interface Driver  { id: string; name: string }
interface Brand   { id: number; name: string }
interface Model   { id: number; name: string; brand_id: number }
interface Destination { id: string; label: string; address: string; lat: number|null; lng: number|null; city: string }

// ── Constantes ────────────────────────────────────────────────────────────────

const ALL_SOURCES = [
  { value: 'touring', label: 'TOURING' }, { value: 'ethias', label: 'ETHIAS' },
  { value: 'vivium',  label: 'VIVIUM'  }, { value: 'ipa',    label: 'IPA (AXA)' },
  { value: 'ardenne', label: 'ARDENNE (IPA)' }, { value: 'mondial', label: 'MONDIAL' },
  { value: 'vab',     label: 'VAB'     }, { value: 'police', label: 'POLICE' },
  { value: 'prive',   label: 'PRIVÉ'   }, { value: 'garage', label: 'GARAGE' },
]
const MISSION_TYPES = [
  { value: 'DSP',       label: '🔧 DSP — Dépannage sur place' },
  { value: 'REM',       label: '🚛 REM — Remorquage' },
  { value: 'Transport', label: '🚐 Transport / Rapatriement' },
  { value: 'DPR',       label: '📍 DPR — Déplacement pour rien' },
  { value: 'VR',        label: '🚗 VR — Véhicule de remplacement' },
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
  const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2) || '?'
  return (
    <aside className="hidden lg:flex flex-col w-64 min-h-screen bg-[#1A1A1A] border-r border-[#2a2a2a] fixed top-0 left-0 h-full z-30">
      <div className="px-6 py-5 border-b border-[#2a2a2a]">
        <Link href="/dashboard"><img src="/logo.jpg" alt="VD" className="h-10 w-auto object-contain" /></Link>
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

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useClientSearch() {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<OdooClient[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    if (query.length < 3) { setResults([]); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(query)}`).then(r => r.json())
        setResults(data.clients || [])
      } finally { setLoading(false) }
    }, 300)
  }, [query])
  return { query, setQuery, results, setResults, loading }
}

function useVehicleSearch() {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<OdooVehicle[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    if (query.length < 3) { setResults([]); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await fetch(`/api/odoo/search-vehicle?q=${encodeURIComponent(query)}`).then(r => r.json())
        setResults(data.vehicles || [])
      } finally { setLoading(false) }
    }, 300)
  }, [query])
  return { query, setQuery, results, setResults, loading }
}

// ── Autocomplete Google Maps ──────────────────────────────────────────────────

function AddressField({ label, value, onChange, onSelect, gmKey, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  onSelect: (addr: string, lat: number, lng: number) => void
  gmKey: string; placeholder?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const cb  = useCallback(onSelect, [])

  useEffect(() => {
    if (!ref.current || !gmKey) return
    const init = () => {
      if (!(window as any).google?.maps?.places) return
      const ac = new (window as any).google.maps.places.Autocomplete(ref.current!, {
        componentRestrictions: { country: ['be','lu','fr','nl','de'] },
        fields: ['formatted_address','geometry'],
      })
      ac.addListener('place_changed', () => {
        const p = ac.getPlace()
        if (p.geometry) cb(p.formatted_address || '', p.geometry.location.lat(), p.geometry.location.lng())
      })
    }
    if ((window as any).google?.maps?.places) { init(); return }
    if (!document.getElementById('gm-script')) {
      const s = document.createElement('script')
      s.id = 'gm-script'
      s.src = `https://maps.googleapis.com/maps/api/js?key=${gmKey}&libraries=places&language=fr`
      s.onload = init
      document.head.appendChild(s)
    }
  }, [gmKey, cb])

  return (
    <div>
      <label className="block text-zinc-500 text-xs mb-1.5">{label}</label>
      <div className="relative">
        <input ref={ref} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600 pr-8" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 text-xs">📍</span>
      </div>
    </div>
  )
}

// ── Composant destinations multiples ──────────────────────────────────────────

function DestinationsBlock({ destinations, onChange, gmKey }: {
  destinations: Destination[]; onChange: (d: Destination[]) => void; gmKey: string
}) {
  const addDest = () => {
    onChange([...destinations, { id: crypto.randomUUID(), label: '', address: '', lat: null, lng: null, city: '' }])
  }
  const removeDest = (id: string) => onChange(destinations.filter(d => d.id !== id))
  const updateDest = (id: string, key: keyof Destination, val: any) =>
    onChange(destinations.map(d => d.id === id ? { ...d, [key]: val } : d))

  return (
    <div className="space-y-4">
      {destinations.map((dest, i) => (
        <div key={dest.id} className="bg-[#111] border border-[#2a2a2a] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400 text-xs font-medium uppercase tracking-wide">
              {i === 0 ? '📍 Lieu d\'incident' : `🏁 Destination ${i}`}
            </span>
            {i > 0 && (
              <button onClick={() => removeDest(dest.id)}
                className="text-zinc-600 hover:text-red-400 text-xs transition">✕ Supprimer</button>
            )}
          </div>
          {i > 0 && (
            <div>
              <label className="block text-zinc-500 text-xs mb-1.5">Libellé (ex: Garage Dupont)</label>
              <input value={dest.label} onChange={e => updateDest(dest.id, 'label', e.target.value)}
                placeholder="Nom du lieu..."
                className="w-full bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
            </div>
          )}
          <AddressField
            label="Adresse"
            value={dest.address}
            onChange={v => updateDest(dest.id, 'address', v)}
            onSelect={(addr, lat, lng) => {
              updateDest(dest.id, 'address', addr)
              updateDest(dest.id, 'lat', lat)
              updateDest(dest.id, 'lng', lng)
              const parts = addr.split(',')
              if (parts.length > 1) updateDest(dest.id, 'city', parts[parts.length - 2]?.trim() || '')
            }}
            gmKey={gmKey}
            placeholder="Rue, numéro, ville..."
          />
        </div>
      ))}
      <button onClick={addDest}
        className="w-full py-2.5 border border-dashed border-[#2a2a2a] rounded-xl text-zinc-500 hover:text-white hover:border-zinc-500 text-sm transition">
        + Ajouter une destination
      </button>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function NewMissionClient({
  drivers, warnings, userName, userRole, googleMapsKey
}: {
  drivers: Driver[]; warnings: Warning[]; userName: string; userRole: string; googleMapsKey: string
}) {
  const router = useRouter()

  // ── RDV ───────────────────────────────────────────────────────────────────
  const now    = new Date()
  const pad    = (n: number) => String(n).padStart(2, '0')
  const today  = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
  const curTime= `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const [rdvDate, setRdvDate] = useState(today)
  const [rdvTime, setRdvTime] = useState(curTime)

  // ── Source ────────────────────────────────────────────────────────────────
  const [source,        setSource]        = useState('prive')
  const [sourceFromOdoo, setSourceFromOdoo] = useState(false)
  const [savingSource,  setSavingSource]  = useState(false)
  const [showSaveSource, setShowSaveSource] = useState(false)

  // ── Client facturé ────────────────────────────────────────────────────────
  const clientSearch = useClientSearch()
  const [showClientDrop,  setShowClientDrop]  = useState(false)
  const [selectedClient,  setSelectedClient]  = useState<OdooClient|null>(null)
  const [billedName,      setBilledName]      = useState('')
  const [odooPartnerId,   setOdooPartnerId]   = useState<number|null>(null)

  // ── Client assisté ────────────────────────────────────────────────────────
  const [assistedName,  setAssistedName]  = useState('')
  const [assistedPhone, setAssistedPhone] = useState('')
  const [assistedAddr,  setAssistedAddr]  = useState('')

  // ── Type + mission ────────────────────────────────────────────────────────
  const [missionType,  setMissionType]  = useState('DSP')
  const [description,  setDescription]  = useState('')

  // ── Véhicule ──────────────────────────────────────────────────────────────
  const vehicleSearch = useVehicleSearch()
  const [showVehicleDrop,  setShowVehicleDrop]  = useState(false)
  const [selectedVehicle,  setSelectedVehicle]  = useState<OdooVehicle|null>(null)
  const [plate,   setPlate]   = useState('')
  const [brand,   setBrand]   = useState('')
  const [model,   setModel]   = useState('')
  const [vin,     setVin]     = useState('')
  const [fuel,    setFuel]    = useState('')
  const [gearbox, setGearbox] = useState('')
  const [odooVehicleId, setOdooVehicleId] = useState<number|null>(null)
  const [brands,        setBrands]        = useState<Brand[]>([])
  const [models,        setModels]        = useState<Model[]>([])
  const [loadingBrands, setLoadingBrands] = useState(false)

  // ── Destinations ──────────────────────────────────────────────────────────
  const [destinations, setDestinations] = useState<Destination[]>([
    { id: 'incident', label: 'Incident', address: '', lat: null, lng: null, city: '' }
  ])

  // ── Distance ──────────────────────────────────────────────────────────────
  const [distanceKm,  setDistanceKm]  = useState<number|null>(null)
  const [durationMin, setDurationMin] = useState<number|null>(null)

  // ── Avertissements ────────────────────────────────────────────────────────
  const [selectedWarnings, setSelectedWarnings] = useState<string[]>([])

  // ── Remarques ─────────────────────────────────────────────────────────────
  const [remarksGeneral, setRemarksGeneral] = useState('')
  const [remarksBilling, setRemarksBilling] = useState('')

  // ── Soumission ────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Calcul distance dès que incident + destination 2 sont remplies
  useEffect(() => {
    const inc  = destinations[0]
    const dest = destinations[1]
    if (!inc?.lat || !inc?.lng || !dest?.lat || !dest?.lng) return
    if (!(window as any).google?.maps) return
    const svc = new (window as any).google.maps.DistanceMatrixService()
    svc.getDistanceMatrix({
      origins:      [{ lat: inc.lat,  lng: inc.lng }],
      destinations: [{ lat: dest.lat, lng: dest.lng }],
      travelMode:   'DRIVING',
    }, (res: any, status: string) => {
      if (status === 'OK') {
        const el = res.rows[0].elements[0]
        if (el.status === 'OK') {
          setDistanceKm(Math.round(el.distance.value / 1000))
          setDurationMin(Math.round(el.duration.value / 60))
        }
      }
    })
  }, [destinations])

  // Sélection client facturé → lookup source
  const selectClient = async (c: OdooClient) => {
    setSelectedClient(c)
    setBilledName(c.name)
    setOdooPartnerId(c.id)
    setShowClientDrop(false)
    clientSearch.setQuery(c.name)
    clientSearch.setResults([])

    // Lookup source depuis notre DB
    const res  = await fetch(`/api/missions/source-lookup?partner_id=${c.id}`)
    const data = await res.json()
    setSource(data.source)
    setSourceFromOdoo(data.found)
    setShowSaveSource(!data.found && data.source === 'prive')
  }

  // Copier client facturé → assisté
  const copyBilledToAssisted = () => {
    if (!selectedClient) return
    setAssistedName(selectedClient.name)
    setAssistedPhone(String(selectedClient.phone || selectedClient.mobile || ''))
    if (selectedClient.street && selectedClient.city) {
      setAssistedAddr(`${selectedClient.street}, ${selectedClient.zip || ''} ${selectedClient.city}`.trim())
    }
  }

  // Sélection véhicule
  const selectVehicle = (v: OdooVehicle) => {
    setSelectedVehicle(v)
    setPlate(v.plate)
    setBrand(v.brand)
    setModel(v.model)
    setVin(String(v.vin || ''))
    setFuel(v.fuel)
    setGearbox(v.gearbox)
    setOdooVehicleId(v.id)
    if (v.partner_name && !selectedClient) setBilledName(v.partner_name)
    setShowVehicleDrop(false)
    vehicleSearch.setQuery(v.plate)
    vehicleSearch.setResults([])
  }

  // Sauvegarder source pour ce client
  const saveSource = async () => {
    if (!odooPartnerId) return
    setSavingSource(true)
    await fetch('/api/missions/source-lookup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ odoo_partner_id: odooPartnerId, source, label: billedName })
    })
    setShowSaveSource(false)
    setSourceFromOdoo(true)
    setSavingSource(false)
  }

  const toggleWarning = (id: string) =>
    setSelectedWarnings(prev => prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id])

  const loadBrands = async () => {
    if (brands.length > 0) return
    setLoadingBrands(true)
    try {
      const res  = await fetch('/api/vehicles?type=brands')
      const data = await res.json()
      setBrands(data || [])
    } finally { setLoadingBrands(false) }
  }

  const loadModels = async (brandId: number) => {
    const res  = await fetch(`/api/vehicles?type=models&brandId=${brandId}`)
    const data = await res.json()
    setModels(data || [])
  }

  const handleSubmit = async () => {
    if (!missionType)               return setError('Type de mission requis')
    if (!destinations[0]?.address)  return setError('Lieu d\'incident requis')

    setSaving(true); setError('')

    try {
      // Créer client Odoo si pas lié
      let finalPartnerId = odooPartnerId
      if (!finalPartnerId && billedName.trim()) {
        const res  = await fetch('/api/odoo/create-client', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: billedName })
        })
        const data = await res.json()
        if (data.partner) finalPartnerId = data.partner.id
      }

      // Créer véhicule Odoo si pas lié
      let finalVehicleId = odooVehicleId
      if (!finalVehicleId && plate.trim()) {
        const res  = await fetch('/api/odoo/create-vehicle', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plate, vin, brand, model, fuel, gearbox, partner_id: finalPartnerId })
        })
        const data = await res.json()
        if (data.vehicle_id) finalVehicleId = data.vehicle_id
      }

      // Libellés des warnings sélectionnés
      const warningLabels = warnings
        .filter(w => selectedWarnings.includes(w.id))
        .map(w => `${w.icon} ${w.label}`)

      const rdvAt = rdvDate && rdvTime ? `${rdvDate}T${rdvTime}:00` : null

      const res = await fetch('/api/missions/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          mission_type:    missionType,
          billed_to_name:  billedName,
          billed_to_id:    finalPartnerId,
          assisted_name:   assistedName || billedName,
          assisted_phone:  assistedPhone,
          vehicle_plate:   plate,
          vehicle_brand:   brand,
          vehicle_model:   model,
          vehicle_vin:     vin,
          vehicle_fuel:    fuel,
          vehicle_gearbox: gearbox,
          destinations,
          warnings:        warningLabels,
          remarks_general: remarksGeneral,
          remarks_billing: remarksBilling,
          rdv_at:          rdvAt,
          odoo_partner_id: finalPartnerId,
          odoo_vehicle_id: finalVehicleId,
          distance_km:     distanceKm,
          duration_min:    durationMin,
        })
      })

      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Erreur création')
      router.push(`/dispatch/${data.mission_id}`)
    } catch (err: any) {
      setError(err.message); setSaving(false)
    }
  }

  const warningColorMap: Record<string, string> = {
    red: 'border-red-500/50 bg-red-500/10 text-red-400',
    orange: 'border-orange-500/50 bg-orange-500/10 text-orange-400',
    yellow: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400',
    blue: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex">
      <Sidebar userName={userName} userRole={userRole} />

      <div className="flex-1 lg:ml-64 flex flex-col">
        {/* Header */}
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 lg:px-8 py-5 sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <Link href="/dispatch" className="text-zinc-400 hover:text-white text-lg">←</Link>
            <h1 className="text-white font-bold text-xl flex-1">Nouvelle mission</h1>
            <button onClick={handleSubmit} disabled={saving}
              className="hidden lg:block px-5 py-2.5 bg-brand hover:bg-brand-dark text-white rounded-xl font-medium text-sm transition disabled:opacity-50">
              {saving ? 'Création...' : '✅ Créer la mission'}
            </button>
          </div>
        </div>

        <div className="flex-1 px-4 lg:px-8 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl">

            {/* ── Colonne principale ───────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-5">

              {/* 1. Date / Heure RDV */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4">🕐 Date / Heure de rendez-vous</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Date</label>
                    <input type="date" value={rdvDate} onChange={e => setRdvDate(e.target.value)}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand" />
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Heure</label>
                    <input type="time" value={rdvTime} onChange={e => setRdvTime(e.target.value)}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand" />
                  </div>
                </div>
              </div>

              {/* 2. Client facturé */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4">🧾 Client facturé</h2>
                <div className="relative mb-3">
                  <label className="block text-zinc-500 text-xs mb-1.5">Rechercher dans Odoo</label>
                  <input value={clientSearch.query}
                    onChange={e => { clientSearch.setQuery(e.target.value); setShowClientDrop(true) }}
                    onFocus={() => setShowClientDrop(true)}
                    onBlur={() => setTimeout(() => setShowClientDrop(false), 150)}
                    placeholder="Min. 3 caractères — nom ou téléphone..."
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                  {showClientDrop && clientSearch.results.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl shadow-xl overflow-hidden">
                      {clientSearch.results.map(c => (
                        <button key={c.id} onMouseDown={() => selectClient(c)}
                          className="w-full text-left px-4 py-3 hover:bg-[#2a2a2a] transition border-b border-[#222] last:border-0">
                          <p className="text-white text-sm font-medium">{c.name}</p>
                          <p className="text-zinc-500 text-xs">{[c.phone || c.mobile, c.city].filter(Boolean).join(' · ')}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedClient && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-xl mb-3">
                    <span className="text-green-400 text-xs">✓ Lié Odoo #{selectedClient.id}</span>
                    <span className="text-green-300 text-xs font-medium">{selectedClient.name}</span>
                    <button onClick={() => { setSelectedClient(null); setOdooPartnerId(null); clientSearch.setQuery(''); setBilledName('') }}
                      className="ml-auto text-zinc-500 hover:text-red-400 text-xs">✕</button>
                  </div>
                )}

                <div>
                  <label className="block text-zinc-500 text-xs mb-1.5">Nom / Raison sociale</label>
                  <input value={billedName} onChange={e => setBilledName(e.target.value)}
                    placeholder="Ex: Touring SA, Police Zone Vesdre..."
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                </div>

                {/* Source déduite */}
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-zinc-500 text-xs mb-1.5">
                      Source {sourceFromOdoo ? '(depuis fiche client)' : ''}
                    </label>
                    <select value={source} onChange={e => { setSource(e.target.value); setShowSaveSource(true) }}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand">
                      {ALL_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  {showSaveSource && odooPartnerId && (
                    <div className="flex-shrink-0 mt-5">
                      <button onClick={saveSource} disabled={savingSource}
                        className="px-3 py-2.5 bg-[#111] border border-brand/50 rounded-xl text-brand text-xs hover:bg-brand/10 transition disabled:opacity-50">
                        {savingSource ? '...' : '💾 Mémoriser'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Client assisté */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-white font-semibold text-sm">👤 Client assisté (personne en panne)</h2>
                  <button onClick={copyBilledToAssisted}
                    className="text-xs text-brand hover:underline">
                    = Copier client facturé
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Nom complet</label>
                    <input value={assistedName} onChange={e => setAssistedName(e.target.value)}
                      placeholder="Prénom Nom"
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Téléphone</label>
                    <input value={assistedPhone} onChange={e => setAssistedPhone(e.target.value)}
                      placeholder="+32..."
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
                  </div>
                </div>
              </div>

              {/* 4. Type d'intervention */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4">📋 Type d'intervention</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {MISSION_TYPES.map(t => (
                    <button key={t.value} onClick={() => setMissionType(t.value)}
                      className={`px-3 py-3 rounded-xl text-sm font-medium border transition text-center ${
                        missionType === t.value
                          ? 'bg-brand border-brand text-white'
                          : 'bg-[#111] border-[#2a2a2a] text-zinc-400 hover:text-white hover:border-zinc-500'
                      }`}>
                      <div>{t.label.split(' ')[0]}</div>
                      <div className="text-xs font-bold mt-0.5">{t.value}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-4">
                  <label className="block text-zinc-500 text-xs mb-1.5">Description / Détails</label>
                  <textarea value={description} onChange={e => setDescription(e.target.value)}
                    rows={2} placeholder="Détails de l'intervention..."
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand resize-none placeholder:text-zinc-600" />
                </div>
              </div>

              {/* 5. Adresses multiples */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4">📍 Adresses</h2>
                <DestinationsBlock
                  destinations={destinations}
                  onChange={setDestinations}
                  gmKey={googleMapsKey}
                />
                {distanceKm !== null && (
                  <div className="mt-4 flex items-center gap-3 px-4 py-3 bg-[#111] border border-[#2a2a2a] rounded-xl">
                    <span className="text-zinc-400 text-sm">🛣️</span>
                    <span className="text-white font-semibold">{distanceKm} km</span>
                    <span className="text-zinc-500">·</span>
                    <span className="text-white font-semibold">~{durationMin} min</span>
                    <span className="text-zinc-500 text-xs">(voiture — camion +15-20%)</span>
                  </div>
                )}
              </div>

              {/* 6. Véhicule */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4">🚗 Véhicule</h2>
                <div className="relative mb-4">
                  <label className="block text-zinc-500 text-xs mb-1.5">Rechercher dans le parc (plaque ou VIN)</label>
                  <input value={vehicleSearch.query}
                    onChange={e => { vehicleSearch.setQuery(e.target.value.toUpperCase()); setShowVehicleDrop(true) }}
                    onFocus={() => setShowVehicleDrop(true)}
                    onBlur={() => setTimeout(() => setShowVehicleDrop(false), 150)}
                    placeholder="Min. 3 caractères..."
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm font-mono uppercase focus:outline-none focus:border-brand placeholder:normal-case placeholder:text-zinc-600" />
                  {showVehicleDrop && vehicleSearch.results.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl shadow-xl overflow-hidden">
                      {vehicleSearch.results.map(v => (
                        <button key={v.id} onMouseDown={() => selectVehicle(v)}
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
                    <span className="text-green-300 text-xs font-mono font-medium">{selectedVehicle.plate}</span>
                    <button onClick={() => { setSelectedVehicle(null); setOdooVehicleId(null); vehicleSearch.setQuery('') }}
                      className="ml-auto text-zinc-500 hover:text-red-400 text-xs">✕</button>
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {/* Plaque */}
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Plaque</label>
                    <input value={plate} onChange={e => setPlate(e.target.value.toUpperCase())}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm font-mono uppercase focus:outline-none focus:border-brand" />
                  </div>

                  {/* Marque */}
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Marque</label>
                    <select
                      value={brand}
                      onFocus={loadBrands}
                      onChange={e => {
                        const b = brands.find(b => b.name === e.target.value)
                        setBrand(e.target.value)
                        setModel('')
                        setModels([])
                        if (b) loadModels(b.id)
                      }}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand"
                    >
                      <option value="">{loadingBrands ? 'Chargement...' : '— Sélectionner —'}</option>
                      {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                    </select>
                  </div>

                  {/* Modèle */}
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Modèle</label>
                    {models.length > 0 ? (
                      <select value={model} onChange={e => setModel(e.target.value)}
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand">
                        <option value="">— Sélectionner —</option>
                        {models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                        <option value="_custom">Autre (saisie libre)</option>
                      </select>
                    ) : (
                      <input value={model} onChange={e => setModel(e.target.value)}
                        placeholder={brand ? 'Saisie libre...' : "Choisir une marque d'abord"}
                        disabled={!brand}
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand disabled:opacity-40" />
                    )}
                  </div>

                  {/* VIN */}
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">VIN / Châssis</label>
                    <input value={vin} onChange={e => setVin(e.target.value.toUpperCase())}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm font-mono uppercase focus:outline-none focus:border-brand" />
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
                </div>
              </div>

              {/* 7. Avertissements */}
              {warnings.length > 0 && (
                <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                  <h2 className="text-white font-semibold text-sm mb-4">⚠️ Avertissements</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {warnings.map(w => {
                      const selected = selectedWarnings.includes(w.id)
                      const colors   = warningColorMap[w.color] || warningColorMap.orange
                      return (
                        <button key={w.id} onClick={() => toggleWarning(w.id)}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition ${
                            selected ? colors : 'border-[#2a2a2a] bg-[#111] text-zinc-500 hover:text-white'
                          }`}>
                          <span>{w.icon}</span>
                          <span className="text-xs text-left leading-tight">{w.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 8. Remarques */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4">📝 Remarques</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Remarques générales (visible bureau + chauffeur)</label>
                    <textarea value={remarksGeneral} onChange={e => setRemarksGeneral(e.target.value)}
                      rows={3} className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand resize-none" />
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Remarques de facturation (visible bureau + facture)</label>
                    <textarea value={remarksBilling} onChange={e => setRemarksBilling(e.target.value)}
                      rows={2} className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand resize-none" />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Colonne droite : résumé + action ────────────────────────── */}
            <div className="space-y-4">
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5 sticky top-[89px] space-y-4">

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
                  <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-3">Résumé</p>
                  {[
                    { label: 'RDV',      value: rdvDate && rdvTime ? `${rdvDate} ${rdvTime}` : '—' },
                    { label: 'Source',   value: ALL_SOURCES.find(s => s.value === source)?.label || source },
                    { label: 'Type',     value: MISSION_TYPES.find(t => t.value === missionType)?.label || '—' },
                    { label: 'Facturé', value: billedName || '—' },
                    { label: 'Assisté', value: assistedName || billedName || '—' },
                    { label: 'Véhicule', value: plate || '—' },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between gap-2">
                      <span className="text-zinc-500 text-xs flex-shrink-0">{r.label}</span>
                      <span className="text-white text-xs text-right truncate">{r.value}</span>
                    </div>
                  ))}

                  {odooPartnerId && (
                    <div className="flex items-center gap-1.5 text-green-400 text-xs">✓ Client Odoo lié</div>
                  )}
                  {odooVehicleId && (
                    <div className="flex items-center gap-1.5 text-green-400 text-xs">✓ Véhicule Odoo lié</div>
                  )}
                  {distanceKm !== null && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500 text-xs">Distance</span>
                      <span className="text-white text-xs">{distanceKm} km · ~{durationMin} min</span>
                    </div>
                  )}
                  {selectedWarnings.length > 0 && (
                    <div>
                      <span className="text-zinc-500 text-xs">Avertissements</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {warnings.filter(w => selectedWarnings.includes(w.id)).map(w => (
                          <span key={w.id} className="text-xs">{w.icon} {w.label}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
