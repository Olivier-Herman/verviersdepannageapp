'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

interface ListItem { value: string; label: string }
interface Brand { id: number; name: string }
interface Model { id: number; name: string }
interface OdooClient {
  id: number; name: string; phone: string; email: string
  address: string; street: string; zip: string; city: string
  countryCode: string; vat: string
}
interface OdooVehicle {
  id: number; licensePlate: string; brandName: string
  modelName: string; displayName: string; vinSn: string
}

declare global {
  interface Window { google: any; initGooglePlaces: () => void }
}

// Normaliser immat
const normalizePlate = (v: string) => v.replace(/[-.\s]/g, '').toUpperCase()

export default function EncaissementClient({ motifs, paymentModes }: {
  motifs: ListItem[]
  paymentModes: ListItem[]
}) {
  const [page, setPage] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const totalPages = 9

  // Page 0 — Immat
  const [plate, setPlate] = useState('')
  const [plateChecking, setPlateChecking] = useState(false)
  const [odooVehicle, setOdooVehicle] = useState<OdooVehicle | null>(null)
  const [plateChecked, setPlateChecked] = useState(false)

  // Page 1 — Confirmation véhicule / marque / modèle
  const [vehicleConfirmed, setVehicleConfirmed] = useState<boolean | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [selectedBrand, setSelectedBrand] = useState('')
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [modelOther, setModelOther] = useState('')

  // Page 2 — Motif
  const [motif, setMotif] = useState('')
  const [motifLabel, setMotifLabel] = useState('')
  const [motifPrecision, setMotifPrecision] = useState('')

  // Page 3 — Lieu
  const [location, setLocation] = useState('')
  const [locationLoading, setLocationLoading] = useState(false)

  // Page 4 — Montant & paiement
  const [amount, setAmount] = useState('')
  const [paymentMode, setPaymentMode] = useState('')

  // Page 5 — Sélection client
  const [previousClients, setPreviousClients] = useState<OdooClient[]>([])
  const [selectedClient, setSelectedClient] = useState<OdooClient | null>(null)
  const [isNewClient, setIsNewClient] = useState(false)

  // Page 6+ — Infos nouveau client
  const [clientVat, setClientVat] = useState('')
  const [viesLoading, setViesLoading] = useState(false)
  const [viesResult, setViesResult] = useState<any>(null)
  const [clientName, setClientName] = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const [clientStreet, setClientStreet] = useState('')
  const [clientZip, setClientZip] = useState('')
  const [clientCity, setClientCity] = useState('')
  const [clientCountryCode, setClientCountryCode] = useState('BE')
  const [clientPhone, setClientPhone] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [notes, setNotes] = useState('')

  const locationInputRef = useRef<HTMLInputElement>(null)
  const clientAddressInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const autocompleteClientRef = useRef<any>(null)

  const PLACES_OPTIONS = { types: ['address'] as string[], componentRestrictions: { country: ['be', 'fr', 'de', 'nl', 'lu'] } }

  const initAC = (inputRef: React.RefObject<HTMLInputElement>, acRef: React.MutableRefObject<any>, setter: (v: string) => void, componentSetter?: (place: any) => void) => {
    if (!inputRef.current || !window.google?.maps?.places || acRef.current) return
    acRef.current = new window.google.maps.places.Autocomplete(inputRef.current, PLACES_OPTIONS)
    acRef.current.addListener('place_changed', () => {
      const place = acRef.current.getPlace()
      if (place?.formatted_address) setter(place.formatted_address)
      if (componentSetter && place) componentSetter(place)
    })
  }

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) return
    window.initGooglePlaces = () => initAC(locationInputRef, autocompleteRef, setLocation)
    if (!document.getElementById('google-maps-script')) {
      const s = document.createElement('script')
      s.id = 'google-maps-script'
      s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initGooglePlaces`
      s.async = true; document.head.appendChild(s)
    } else if (window.google?.maps?.places) {
      initAC(locationInputRef, autocompleteRef, setLocation)
    }
  }, [])

  useEffect(() => {
    if (page !== 8) return
    const t = setTimeout(() => {
      initAC(clientAddressInputRef, autocompleteClientRef, setClientAddress, (place) => {
        const c = place.address_components || []
        const get = (t: string) => c.find((x: any) => x.types.includes(t))?.long_name || ''
        const getS = (t: string) => c.find((x: any) => x.types.includes(t))?.short_name || ''
        const num = get('street_number'); const box = get('subpremise')
        const route = get('route'); const zip = get('postal_code')
        const city = get('locality') || get('postal_town'); const country = getS('country')
        setClientStreet([route, num + (box ? `/${box}` : '')].filter(Boolean).join(' ').trim())
        setClientZip(zip); setClientCity(city); setClientCountryCode(country || 'BE')
      })
    }, 150)
    return () => clearTimeout(t)
  }, [page])

  useEffect(() => {
    fetch('/api/vehicles?type=brands').then(r => r.json()).then(setBrands)
  }, [])

  useEffect(() => {
    if (!selectedBrandId) { setModels([]); return }
    fetch(`/api/vehicles?type=models&brandId=${selectedBrandId}`).then(r => r.json()).then(setModels)
  }, [selectedBrandId])

  const checkPlate = async () => {
    if (plate.length < 3) { setError('Immatriculation trop courte'); return }
    setPlateChecking(true); setError('')
    try {
      const res = await fetch(`/api/plates?plate=${encodeURIComponent(plate)}`)
      const data = await res.json()
      setPlateChecked(true)
      if (data.found) {
        setOdooVehicle(data.vehicle)
        setPreviousClients(data.previousClients || [])
        setSelectedBrand(data.vehicle.brandName)
        setSelectedModel(data.vehicle.modelName)
        setPage(1) // → confirmation véhicule
      } else {
        setOdooVehicle(null)
        setPage(2) // → motif directement (marque/modèle à saisir)
      }
    } catch { setError('Erreur de connexion') }
    finally { setPlateChecking(false) }
  }

  const checkVies = async () => {
    if (!clientVat || clientVat.length < 5) return
    setViesLoading(true); setViesResult(null)
    try {
      const res = await fetch(`/api/vies?vat=${encodeURIComponent(clientVat)}`)
      const data = await res.json()
      setViesResult(data)
      if (data.valid) {
        if (data.name) setClientName(data.name)
        if (data.address) setClientAddress(data.address)
      }
    } finally { setViesLoading(false) }
  }

  const getMyLocation = () => {
    if (!navigator.geolocation) return
    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`,
          { headers: { 'Accept-Language': 'fr' } }
        )
        const data = await res.json()
        if (data.display_name) setLocation(data.display_name)
        else setLocation(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`)
      } catch { setLocation(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`) }
      finally { setLocationLoading(false) }
    }, () => setLocationLoading(false), { enableHighAccuracy: true, timeout: 10000 })
  }

  const handleSubmit = async () => {
    setSaving(true); setError('')
    const client = selectedClient || {
      id: null, name: clientName, phone: clientPhone, email: clientEmail,
      address: clientAddress, street: clientStreet, zip: clientZip,
      city: clientCity, countryCode: clientCountryCode, vat: clientVat
    }
    try {
      const res = await fetch('/api/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_type: 'encaissement',
          plate,
          brand_id: selectedBrandId || null,
          model_id: selectedModel === 'Autre' ? null : selectedModelId,
          brand_text: selectedBrand,
          model_text: selectedModel === 'Autre' ? (modelOther || 'Autre') : selectedModel,
          motif_id: motif, motif_text: motifLabel,
          motif_precision: motifPrecision || null,
          location_address: location,
          amount, payment_mode: paymentMode,
          client_vat: client.vat, client_name: client.name,
          client_address: client.address,
          client_street: client.street, client_zip: client.zip,
          client_city: client.city, client_country_code: client.countryCode,
          client_phone: client.phone, client_email: client.email,
          notes,
        })
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Erreur'); return }
      setSaved(true)
    } finally { setSaving(false) }
  }

  const resetForm = () => {
    setPage(0); setSaved(false); setError('')
    setPlate(''); setPlateChecked(false); setOdooVehicle(null); setVehicleConfirmed(null)
    setPreviousClients([]); setSelectedClient(null); setIsNewClient(false)
    setSelectedBrand(''); setSelectedBrandId(null); setSelectedModel(''); setSelectedModelId(null); setModelOther('')
    setMotif(''); setMotifLabel(''); setMotifPrecision(''); setLocation('')
    setAmount(''); setPaymentMode('')
    setClientVat(''); setClientName(''); setClientAddress(''); setClientStreet('')
    setClientZip(''); setClientCity(''); setClientCountryCode('BE')
    setClientPhone(''); setClientEmail(''); setNotes(''); setViesResult(null)
    autocompleteRef.current = null; autocompleteClientRef.current = null
  }

  // ── Écran succès ─────────────────────────────────────────
  if (saved) return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6 text-center">
      <div className="text-6xl mb-6">✅</div>
      <h2 className="text-white text-2xl font-bold mb-2">Enregistré !</h2>
      <p className="text-zinc-500 text-sm mb-8">Intervention sauvegardée et envoyée dans Odoo.</p>
      <button onClick={resetForm} className="w-full max-w-sm bg-brand text-white font-bold rounded-xl py-3.5 mb-3">+ Nouvelle intervention</button>
      <Link href="/dashboard" className="text-zinc-500 text-sm">← Dashboard</Link>
    </div>
  )

  // ── Layout commun ─────────────────────────────────────────
  const Shell = ({ children, title, onBack }: { children: React.ReactNode; title: string; onBack?: () => void }) => (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col max-w-md mx-auto">
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-5 pt-12 pb-4 safe-top">
        <div className="flex items-center gap-3 mb-3">
          {onBack
            ? <button onClick={onBack} className="text-zinc-500 hover:text-white text-sm">←</button>
            : <Link href="/dashboard" className="text-zinc-500 hover:text-white text-sm">←</Link>
          }
          <h1 className="text-white font-bold text-lg">Encaissement</h1>
        </div>
        {/* Barre de progression */}
        <div className="flex gap-1">
          {Array.from({ length: totalPages }).map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= page ? 'bg-brand' : 'bg-[#2a2a2a]'}`} />
          ))}
        </div>
        <p className="text-zinc-500 text-xs mt-2">{title}</p>
      </div>
      <div className="flex-1 px-5 py-6 overflow-y-auto">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-5">{error}</div>
        )}
        {children}
      </div>
    </div>
  )

  const BigBtn = ({ label, onClick, disabled, secondary }: { label: string; onClick: () => void; disabled?: boolean; secondary?: boolean }) => (
    <button onClick={onClick} disabled={disabled}
      className={`w-full rounded-2xl py-4 text-base font-bold transition-all active:scale-95 disabled:opacity-40 ${secondary ? 'bg-[#1e1e1e] border border-[#333] text-zinc-300' : 'bg-brand text-white'}`}>
      {label}
    </button>
  )

  // ── Page 0 — Immatriculation ──────────────────────────────
  if (page === 0) return (
    <Shell title="Quelle est l'immatriculation ?">
      <div className="mt-4">
        <input
          value={plate}
          onChange={e => setPlate(normalizePlate(e.target.value))}
          onKeyDown={e => e.key === 'Enter' && checkPlate()}
          placeholder="1ADK440"
          autoFocus
          className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-2xl font-bold text-center outline-none tracking-widest uppercase mb-2"
        />
        <p className="text-zinc-600 text-xs text-center mb-8">Sans tirets ni espaces</p>
        <BigBtn label={plateChecking ? 'Recherche…' : 'Rechercher →'} onClick={checkPlate} disabled={plateChecking || plate.length < 3} />
      </div>
    </Shell>
  )

  // ── Page 1 — Confirmation véhicule ───────────────────────
  if (page === 1 && odooVehicle) return (
    <Shell title="Ce véhicule est-il correct ?" onBack={() => setPage(0)}>
      <div className="mt-4">
        <div className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-2xl p-6 text-center mb-8">
          <p className="text-zinc-400 text-sm mb-2">Véhicule trouvé dans Odoo</p>
          <p className="text-white text-2xl font-bold">{odooVehicle.brandName}</p>
          <p className="text-zinc-400 text-lg">{odooVehicle.modelName}</p>
          <p className="text-zinc-600 text-sm mt-2">{plate}</p>
        </div>
        <div className="flex flex-col gap-3">
          <BigBtn label="✓ Oui, c'est ce véhicule" onClick={() => { setVehicleConfirmed(true); setPage(2) }} />
          <BigBtn label="✗ Non, autre véhicule" secondary onClick={() => {
            setVehicleConfirmed(false)
            setSelectedBrand(''); setSelectedBrandId(null)
            setSelectedModel(''); setSelectedModelId(null)
            setPage(10) // page saisie marque
          }} />
        </div>
      </div>
    </Shell>
  )

  // ── Page 10 — Saisie marque (véhicule non confirmé) ──────
  if (page === 10) return (
    <Shell title="Quelle est la marque ?" onBack={() => setPage(odooVehicle ? 1 : 0)}>
      <div className="mt-2 flex flex-col gap-2 max-h-[70vh] overflow-y-auto">
        {brands.map(b => (
          <button key={b.id} onClick={() => { setSelectedBrand(b.name); setSelectedBrandId(b.id); setPage(11) }}
            className={`w-full text-left px-5 py-4 rounded-2xl border text-white font-medium transition-all active:scale-95 ${selectedBrandId === b.id ? 'bg-brand/20 border-brand' : 'bg-[#1e1e1e] border-[#2a2a2a] hover:border-zinc-500'}`}>
            {b.name}
          </button>
        ))}
      </div>
    </Shell>
  )

  // ── Page 11 — Saisie modèle ───────────────────────────────
  if (page === 11) return (
    <Shell title={`Quel modèle de ${selectedBrand} ?`} onBack={() => setPage(10)}>
      <div className="mt-2 flex flex-col gap-2 max-h-[70vh] overflow-y-auto">
        {models.map(m => (
          <button key={m.id} onClick={() => {
            setSelectedModel(m.name); setSelectedModelId(m.id)
            if (m.name === 'Autre') setPage(12)
            else setPage(2)
          }}
            className={`w-full text-left px-5 py-4 rounded-2xl border text-white font-medium transition-all active:scale-95 ${selectedModelId === m.id ? 'bg-brand/20 border-brand' : 'bg-[#1e1e1e] border-[#2a2a2a] hover:border-zinc-500'}`}>
            {m.name}
          </button>
        ))}
      </div>
    </Shell>
  )

  // ── Page 12 — Modèle "Autre" précision ───────────────────
  if (page === 12) return (
    <Shell title="Préciser le modèle" onBack={() => setPage(11)}>
      <div className="mt-4">
        <input value={modelOther} onChange={e => setModelOther(e.target.value)}
          placeholder="Ex: 308 SW, Clio V…"
          className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-xl font-bold text-center outline-none mb-2" />
        <p className="text-zinc-600 text-xs text-center mb-8">Optionnel — laisse vide si inconnu</p>
        <BigBtn label="Continuer →" onClick={() => setPage(2)} />
      </div>
    </Shell>
  )

  // ── Page 2 — Motif ────────────────────────────────────────
  if (page === 2) return (
    <Shell title="Quel est le motif ?" onBack={() => {
      if (!odooVehicle || vehicleConfirmed === false) setPage(11)
      else setPage(1)
    }}>
      <div className="mt-2 flex flex-col gap-3">
        {motifs.map(m => (
          <button key={m.value} onClick={() => {
            setMotif(m.value); setMotifLabel(m.label)
            if (m.value === 'autre') setPage(13)
            else setPage(3)
          }}
            className={`w-full text-left px-5 py-4 rounded-2xl border text-white font-medium transition-all active:scale-95 ${motif === m.value ? 'bg-brand/20 border-brand' : 'bg-[#1e1e1e] border-[#2a2a2a] hover:border-zinc-500'}`}>
            {m.label}
          </button>
        ))}
      </div>
    </Shell>
  )

  // ── Page 13 — Motif "Autre" précision ────────────────────
  if (page === 13) return (
    <Shell title="Préciser le motif" onBack={() => setPage(2)}>
      <div className="mt-4">
        <input value={motifPrecision} onChange={e => setMotifPrecision(e.target.value)}
          placeholder="Décris l'intervention…"
          className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-lg text-center outline-none mb-2" />
        <p className="text-zinc-600 text-xs text-center mb-8">Apparaîtra sur le devis Odoo</p>
        <BigBtn label="Continuer →" onClick={() => setPage(3)} disabled={!motifPrecision.trim()} />
      </div>
    </Shell>
  )

  // ── Page 3 — Lieu d'intervention ─────────────────────────
  if (page === 3) return (
    <Shell title="Lieu d'intervention" onBack={() => setPage(motif === 'autre' ? 13 : 2)}>
      <div className="mt-4">
        <div className="relative mb-2">
          <input ref={locationInputRef} value={location} onChange={e => setLocation(e.target.value)}
            placeholder="Adresse du lieu…"
            className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-base outline-none pr-12" />
          <button onClick={getMyLocation} disabled={locationLoading}
            className="absolute right-3 top-3 bg-[#2a2a2a] rounded-xl px-3 py-2 text-sm disabled:opacity-40">
            {locationLoading ? '⏳' : '🎯'}
          </button>
        </div>
        <p className="text-zinc-600 text-xs mb-8">Tape une adresse ou utilise ta position GPS</p>
        <BigBtn label="Continuer →" onClick={() => setPage(4)} disabled={!location.trim()} />
      </div>
    </Shell>
  )

  // ── Page 4 — Montant & paiement ──────────────────────────
  if (page === 4) return (
    <Shell title="Montant & mode de paiement" onBack={() => setPage(3)}>
      <div className="mt-4">
        <div className="relative mb-6">
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00" min="0" step="0.01"
            className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-3xl font-bold text-center outline-none" />
          <span className="absolute right-5 top-4 text-zinc-400 text-xl">€</span>
        </div>
        <p className="text-zinc-400 text-xs font-medium mb-3">Mode de paiement</p>
        <div className="flex flex-col gap-2 mb-8">
          {paymentModes.map(p => (
            <button key={p.value} onClick={() => setPaymentMode(p.value)}
              className={`w-full px-5 py-4 rounded-2xl border text-white font-medium transition-all active:scale-95 ${paymentMode === p.value ? 'bg-brand border-brand' : 'bg-[#1e1e1e] border-[#2a2a2a] hover:border-zinc-500'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <BigBtn label="Continuer →" onClick={() => setPage(5)} disabled={!amount || !paymentMode} />
      </div>
    </Shell>
  )

  // ── Page 5 — Sélection client ─────────────────────────────
  if (page === 5) return (
    <Shell title="Qui est le client ?" onBack={() => setPage(4)}>
      <div className="mt-2 flex flex-col gap-3">
        {previousClients.map(client => (
          <button key={client.id} onClick={() => { setSelectedClient(client); setIsNewClient(false); setPage(9) }}
            className="w-full text-left bg-[#1e1e1e] border border-[#2a2a2a] hover:border-brand rounded-2xl p-4 transition-all active:scale-95">
            <p className="text-white font-semibold">{client.name}</p>
            {client.phone && <p className="text-zinc-500 text-sm mt-0.5">{client.phone}</p>}
            {client.address && <p className="text-zinc-600 text-xs mt-0.5">{client.address}</p>}
          </button>
        ))}
        <button onClick={() => { setSelectedClient(null); setIsNewClient(true); setPage(6) }}
          className="w-full bg-[#1e1e1e] border border-dashed border-[#444] rounded-2xl p-4 text-zinc-400 font-medium text-center hover:border-zinc-300 transition-all active:scale-95">
          + Nouveau client
        </button>
      </div>
    </Shell>
  )

  // ── Page 6 — TVA (nouveau client) ────────────────────────
  if (page === 6) return (
    <Shell title="Numéro de TVA ?" onBack={() => setPage(5)}>
      <div className="mt-4">
        <div className="flex gap-2 mb-2">
          <input value={clientVat} onChange={e => { setClientVat(e.target.value.toUpperCase()); setViesResult(null) }}
            placeholder="BE0460759205"
            className="flex-1 bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-xl font-bold text-center outline-none uppercase" />
          <button onClick={checkVies} disabled={viesLoading || clientVat.length < 5}
            className="bg-[#1e1e1e] border border-[#333] hover:border-brand text-brand font-bold rounded-2xl px-4 disabled:opacity-40">
            {viesLoading ? '…' : 'VIES'}
          </button>
        </div>
        {viesResult && (
          <div className={`rounded-xl px-4 py-3 text-sm border mb-4 ${viesResult.valid ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
            {viesResult.valid ? `✓ ${viesResult.name || 'TVA valide'}` : '✗ TVA invalide ou introuvable'}
          </div>
        )}
        <p className="text-zinc-600 text-xs text-center mb-8">Pour un client particulier, passe directement</p>
        <div className="flex flex-col gap-3">
          <BigBtn label="Continuer →" onClick={() => setPage(7)} />
          <BigBtn label="Client particulier →" secondary onClick={() => { setClientVat(''); setPage(7) }} />
        </div>
      </div>
    </Shell>
  )

  // ── Page 7 — Nom client ───────────────────────────────────
  if (page === 7) return (
    <Shell title="Nom du client" onBack={() => setPage(6)}>
      <div className="mt-4">
        <input value={clientName} onChange={e => setClientName(e.target.value)}
          placeholder="Nom et prénom ou société"
          className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-xl font-bold text-center outline-none mb-8" />
        <BigBtn label="Continuer →" onClick={() => setPage(8)} disabled={!clientName.trim()} />
      </div>
    </Shell>
  )

  // ── Page 8 — Adresse client ───────────────────────────────
  if (page === 8) return (
    <Shell title="Adresse du client" onBack={() => setPage(7)}>
      <div className="mt-4">
        <input ref={clientAddressInputRef} value={clientAddress} onChange={e => setClientAddress(e.target.value)}
          placeholder="Rue, numéro, code postal, ville"
          className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-base outline-none mb-2" />
        <p className="text-zinc-600 text-xs mb-4">Autocomplétion Google Maps</p>
        <div className="mb-8">
          <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Téléphone <span className="text-brand">*</span></label>
          <input value={clientPhone} onChange={e => setClientPhone(e.target.value)} type="tel"
            placeholder="+32 4xx xxx xxx"
            className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-3 text-white text-base outline-none mb-3" />
          <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Email</label>
          <input value={clientEmail} onChange={e => setClientEmail(e.target.value)} type="email"
            placeholder="client@email.com"
            className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-3 text-white text-base outline-none" />
        </div>
        <BigBtn label="Continuer →" onClick={() => setPage(9)} disabled={!clientPhone.trim()} />
      </div>
    </Shell>
  )

  // ── Page 9 — Récapitulatif ────────────────────────────────
  if (page === 9) {
    const client = selectedClient || { name: clientName, phone: clientPhone, email: clientEmail, address: clientAddress, vat: clientVat }
    const vehicleDisplay = vehicleConfirmed && odooVehicle
      ? `${odooVehicle.brandName} ${odooVehicle.modelName}`
      : `${selectedBrand} ${selectedModel === 'Autre' ? (modelOther || 'Autre') : selectedModel}`

    return (
      <Shell title="Récapitulatif" onBack={() => isNewClient ? setPage(8) : setPage(5)}>
        <div className="mt-2 space-y-3">
          {[
            { label: 'Immat', value: plate },
            { label: 'Véhicule', value: vehicleDisplay },
            { label: 'Motif', value: motifPrecision || motifLabel },
            { label: 'Lieu', value: location },
            { label: 'Montant', value: `${parseFloat(amount || '0').toFixed(2)} € TVAC` },
            { label: 'Paiement', value: paymentModes.find(p => p.value === paymentMode)?.label },
            { label: 'Client', value: client.name },
            { label: 'Téléphone', value: client.phone },
            { label: 'Adresse', value: client.address },
          ].filter(r => r.value).map(row => (
            <div key={row.label} className="flex justify-between items-start gap-3 py-2 border-b border-[#1e1e1e]">
              <span className="text-zinc-500 text-sm flex-shrink-0">{row.label}</span>
              <span className="text-white text-sm text-right">{row.value}</span>
            </div>
          ))}

          <div className="mt-4">
            <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Remarques (optionnel)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Notes internes…" rows={2}
              className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand resize-none" />
          </div>
        </div>

        <div className="mt-6">
          <BigBtn label={saving ? 'Enregistrement…' : '✓ Enregistrer'} onClick={handleSubmit} disabled={saving} />
        </div>
      </Shell>
    )
  }

  return null
}
