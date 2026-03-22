'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
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

const normalizePlate = (v: string) => v.replace(/[-.\s]/g, '').toUpperCase()

// ── Composants UI définis HORS du composant principal ──────
function Shell({ children, title, page, totalPages, onBack }: {
  children: React.ReactNode; title: string; page: number; totalPages: number; onBack?: () => void
}) {
  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col max-w-md mx-auto">
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          {onBack
            ? <button onClick={onBack} className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg active:bg-[#333]">←</button>
            : <Link href="/dashboard" className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg active:bg-[#333]">←</Link>
          }
          <h1 className="text-white font-bold text-lg">Encaissement</h1>
        </div>
        <div className="flex gap-1">
          {Array.from({ length: totalPages }).map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= page ? 'bg-brand' : 'bg-[#2a2a2a]'}`} />
          ))}
        </div>
        <p className="text-zinc-500 text-xs mt-2">{title}</p>
      </div>
      <div className="flex-1 px-5 py-6 overflow-y-auto">{children}</div>
    </div>
  )
}

function BigBtn({ label, onClick, disabled, secondary }: {
  label: string; onClick: () => void; disabled?: boolean; secondary?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full rounded-2xl py-4 text-base font-bold transition-all active:scale-95 disabled:opacity-40 ${secondary ? 'bg-[#1e1e1e] border border-[#333] text-zinc-300' : 'bg-brand text-white'}`}>
      {label}
    </button>
  )
}

function ChoiceBtn({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`w-full text-left px-5 py-4 rounded-2xl border text-white font-medium transition-all active:scale-95 ${selected ? 'bg-brand/20 border-brand' : 'bg-[#1e1e1e] border-[#2a2a2a] hover:border-zinc-500'}`}>
      {label}
    </button>
  )
}

// ── Composant principal ─────────────────────────────────────
export default function EncaissementClient({ motifs, paymentModes }: {
  motifs: ListItem[]
  paymentModes: ListItem[]
}) {
  const router = useRouter()

  const [page, setPage] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const TOTAL = 9

  // Auto-redirect vers dashboard après 5 secondes si sauvegardé
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => router.push('/dashboard'), 5000)
    return () => clearTimeout(t)
  }, [saved])

  // Page 0
  const [plate, setPlate] = useState('')
  const [plateChecking, setPlateChecking] = useState(false)
  const [odooVehicle, setOdooVehicle] = useState<OdooVehicle | null>(null)

  // Page 1
  const [vehicleConfirmed, setVehicleConfirmed] = useState<boolean | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [selectedBrand, setSelectedBrand] = useState('')
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [modelOther, setModelOther] = useState('')

  // Page 2
  const [motif, setMotif] = useState('')
  const [motifLabel, setMotifLabel] = useState('')
  const [motifPrecision, setMotifPrecision] = useState('')

  // Page 3
  const [location, setLocation] = useState('')
  const [locationLoading, setLocationLoading] = useState(false)

  // Page 4
  const [amount, setAmount] = useState('')
  const [paymentMode, setPaymentMode] = useState('')

  // Page 4 — état SumUp
  const [sumupLoading, setSumupLoading] = useState(false)
  const [sumupData, setSumupData] = useState<any>(null)
  const [sumupMode, setSumupMode] = useState<string | null>(null)
  const [sumupPolling, setSumupPolling] = useState(false)
  const [sumupStatus, setSumupStatus] = useState<string | null>(null)

  // Page 5
  const [previousClients, setPreviousClients] = useState<OdooClient[]>([])
  const [selectedClient, setSelectedClient] = useState<OdooClient | null>(null)
  const [isNewClient, setIsNewClient] = useState(false)

  // Pages 6-8
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

  const PLACES_OPTIONS = {
    types: ['address'] as string[],
    componentRestrictions: { country: ['be', 'fr', 'de', 'nl', 'lu'] }
  }

  const initAC = (
    inputRef: React.RefObject<HTMLInputElement>,
    acRef: React.MutableRefObject<any>,
    setter: (v: string) => void,
    componentSetter?: (place: any) => void
  ) => {
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

  // Init autocomplete lieu quand on arrive page 3
  useEffect(() => {
    if (page !== 3) return
    autocompleteRef.current = null // forcer la réinitialisation
    const t = setTimeout(() => {
      if (window.google?.maps?.places) initAC(locationInputRef, autocompleteRef, setLocation)
    }, 200)
    return () => clearTimeout(t)
  }, [page])

  // Init autocomplete adresse client page 8
  useEffect(() => {
    if (page !== 8) return
    autocompleteClientRef.current = null // forcer la réinitialisation
    const t = setTimeout(() => {
      initAC(clientAddressInputRef, autocompleteClientRef, setClientAddress, (place) => {
        const c = place.address_components || []
        const get = (t: string) => c.find((x: any) => x.types.includes(t))?.long_name || ''
        const getS = (t: string) => c.find((x: any) => x.types.includes(t))?.short_name || ''
        const num = get('street_number'); const box = get('subpremise')
        const route = get('route')
        setClientStreet([route, num + (box ? `/${box}` : '')].filter(Boolean).join(' ').trim())
        setClientZip(get('postal_code'))
        setClientCity(get('locality') || get('postal_town'))
        setClientCountryCode(getS('country') || 'BE')
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
      if (data.found) {
        setOdooVehicle(data.vehicle)
        setPreviousClients(data.previousClients || [])
        setSelectedBrand(data.vehicle.brandName)
        setSelectedModel(data.vehicle.modelName)
        setPage(1)
      } else {
        setOdooVehicle(null)
        setPage(10) // → saisie marque/modèle
      }
    } catch { setError('Erreur de connexion') }
    finally { setPlateChecking(false) }
  }

  const checkVies = async (): Promise<any> => {
    if (!clientVat || clientVat.length < 5) return null
    setViesLoading(true); setViesResult(null)
    try {
      const res = await fetch(`/api/vies?vat=${encodeURIComponent(clientVat)}`)
      const data = await res.json()

      if (data.valid) {
        if (data.name) setClientName(data.name)
        if (data.address) {
          const lines = data.address.split('\n').map((l: string) => l.trim()).filter(Boolean)
          if (lines.length >= 2) {
            const street = lines[0].charAt(0) + lines[0].slice(1).toLowerCase()
            const zipCity = lines[1].match(/^(\d{4,5})\s+(.+)$/)
            if (zipCity) {
              setClientStreet(street)
              setClientZip(zipCity[1])
              setClientCity(zipCity[2].charAt(0) + zipCity[2].slice(1).toLowerCase())
              setClientAddress(`${street}, ${zipCity[1]} ${zipCity[2].charAt(0) + zipCity[2].slice(1).toLowerCase()}`)
            } else {
              setClientAddress(lines.join(', '))
            }
          } else {
            setClientAddress(data.address)
          }
        }

        // Chercher dans Odoo par TVA
        const odooRes = await fetch(`/api/partners?vat=${encodeURIComponent(clientVat)}`)
        const odooData = await odooRes.json()
        if (odooData.found) {
          const p = odooData.partner
          setClientName(p.name); setClientPhone(p.phone); setClientEmail(p.email)
          setClientStreet(p.street); setClientZip(p.zip); setClientCity(p.city)
          setClientCountryCode(p.countryCode); setClientAddress(p.address); setClientVat(p.vat)
          const result = { ...data, odooFound: true, odooName: p.name, hasPhone: !!p.phone }
          setViesResult(result)
          return result
        }
      }

      setViesResult(data)
      return data
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
        setLocation(data.display_name || `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`)
      } catch {
        setLocation(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`)
      }
      finally { setLocationLoading(false) }
    }, () => setLocationLoading(false), { enableHighAccuracy: true, timeout: 10000 })
  }

  const handleSubmit = async () => {
    setSaving(true); setError('')
    const client = selectedClient || {
      name: clientName, phone: clientPhone, email: clientEmail,
      address: clientAddress, street: clientStreet, zip: clientZip,
      city: clientCity, countryCode: clientCountryCode, vat: clientVat
    }
    try {
      const res = await fetch('/api/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_type: 'encaissement', plate,
          brand_id: selectedBrandId || null,
          model_id: selectedModel === 'Autre' ? null : selectedModelId,
          brand_text: selectedBrand,
          model_text: selectedModel === 'Autre' ? (modelOther || 'Autre') : selectedModel,
          motif_id: motif, motif_text: motifLabel,
          motif_precision: motifPrecision || null,
          location_address: location, amount, payment_mode: paymentMode,
          client_vat: client.vat, client_name: client.name,
          client_address: client.address, client_street: client.street,
          client_zip: client.zip, client_city: client.city,
          client_country_code: client.countryCode,
          client_phone: client.phone, client_email: client.email, notes,
        })
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Erreur'); return }
      setSaved(true)
    } finally { setSaving(false) }
  }

  const resetForm = () => {
    setPage(0); setSaved(false); setError('')
    setPlate(''); setOdooVehicle(null); setVehicleConfirmed(null)
    setPreviousClients([]); setSelectedClient(null); setIsNewClient(false)
    setSelectedBrand(''); setSelectedBrandId(null)
    setSelectedModel(''); setSelectedModelId(null); setModelOther('')
    setMotif(''); setMotifLabel(''); setMotifPrecision(''); setLocation('')
    setAmount(''); setPaymentMode('')
    setClientVat(''); setClientName(''); setClientAddress('')
    setClientStreet(''); setClientZip(''); setClientCity(''); setClientCountryCode('BE')
    setClientPhone(''); setClientEmail(''); setNotes(''); setViesResult(null)
    setOdooNameMatches([])
    autocompleteRef.current = null; autocompleteClientRef.current = null
  }

  if (saved) return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6 text-center">
      <div className="text-6xl mb-6">✅</div>
      <h2 className="text-white text-2xl font-bold mb-2">Enregistré !</h2>
      <p className="text-zinc-500 text-sm mb-2">Intervention sauvegardée avec succès.</p>
      <p className="text-zinc-600 text-xs mb-8">Retour au dashboard dans 5 secondes…</p>
      <button onClick={resetForm} className="w-full max-w-sm bg-brand text-white font-bold rounded-xl py-3.5 mb-3">
        + Nouvelle intervention
      </button>
      <Link href="/dashboard" className="text-zinc-500 text-sm">← Dashboard</Link>
    </div>
  )

  // ── Page 0 — Immatriculation ──────────────────────────────
  if (page === 0) return (
    <Shell title="Quelle est l'immatriculation ?" page={0} totalPages={TOTAL}>
      <div className="mt-4">
        <input
          value={plate}
          onChange={e => setPlate(normalizePlate(e.target.value))}
          onKeyDown={e => e.key === 'Enter' && checkPlate()}
          placeholder="1ABC123"
          autoComplete="off"
          autoFocus
          className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-2xl font-bold text-center outline-none tracking-widest uppercase mb-2"
        />
        <p className="text-zinc-600 text-xs text-center mb-8">Sans tirets ni espaces</p>
        <BigBtn
          label={plateChecking ? 'Recherche…' : 'Rechercher →'}
          onClick={checkPlate}
          disabled={plateChecking || plate.length < 3}
        />
        {error && <p className="text-red-400 text-sm text-center mt-3">{error}</p>}
      </div>
    </Shell>
  )

  // ── Page 1 — Confirmation véhicule ───────────────────────
  if (page === 1 && odooVehicle) return (
    <Shell title="Identification du véhicule" page={1} totalPages={TOTAL} onBack={() => setPage(0)}>
      <div className="mt-4">
        <div className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-2xl p-6 text-center mb-8">
          <p className="text-zinc-400 text-sm mb-3">Le véhicule est-il un :</p>
          <p className="text-white text-2xl font-bold">{odooVehicle.brandName}</p>
          <p className="text-zinc-400 text-lg">{odooVehicle.modelName}</p>
          <p className="text-zinc-600 text-sm mt-2">{plate}</p>
        </div>
        <div className="flex flex-col gap-3">
          <BigBtn label="✓ Oui" onClick={() => { setVehicleConfirmed(true); setPage(2) }} />
          <BigBtn label="✗ Non, autre véhicule" secondary onClick={() => {
            setVehicleConfirmed(false)
            setSelectedBrand(''); setSelectedBrandId(null)
            setSelectedModel(''); setSelectedModelId(null)
            setPage(10)
          }} />
        </div>
      </div>
    </Shell>
  )

  // ── Page 10 — Saisie marque ───────────────────────────────
  if (page === 10) return (
    <Shell title="Quelle est la marque ?" page={2} totalPages={TOTAL} onBack={() => odooVehicle ? setPage(1) : setPage(0)}>
      <div className="mt-2 flex flex-col gap-2 max-h-[70vh] overflow-y-auto">
        {brands.map(b => (
          <ChoiceBtn key={b.id} label={b.name} selected={selectedBrandId === b.id}
            onClick={() => { setSelectedBrand(b.name); setSelectedBrandId(b.id); setPage(11) }} />
        ))}
      </div>
    </Shell>
  )

  // ── Page 11 — Saisie modèle ───────────────────────────────
  if (page === 11) return (
    <Shell title={`Quel modèle de ${selectedBrand} ?`} page={2} totalPages={TOTAL} onBack={() => setPage(10)}>
      <div className="mt-2 flex flex-col gap-2 max-h-[70vh] overflow-y-auto">
        {models.map(m => (
          <ChoiceBtn key={m.id} label={m.name} selected={selectedModelId === m.id}
            onClick={() => {
              setSelectedModel(m.name); setSelectedModelId(m.id)
              setPage(m.name === 'Autre' ? 12 : 2)
            }} />
        ))}
      </div>
    </Shell>
  )

  // ── Page 12 — Modèle Autre ────────────────────────────────
  if (page === 12) return (
    <Shell title="Préciser le modèle" page={2} totalPages={TOTAL} onBack={() => setPage(11)}>
      <div className="mt-4">
        <input
          value={modelOther}
          onChange={e => setModelOther(e.target.value)}
          placeholder="Ex: 308 SW, Clio V…"
          autoFocus
          className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-xl font-bold text-center outline-none mb-2"
        />
        <p className="text-zinc-600 text-xs text-center mb-8">Optionnel — laisse vide si inconnu</p>
        <BigBtn label="Continuer →" onClick={() => setPage(2)} />
      </div>
    </Shell>
  )

  // ── Page 2 — Motif ────────────────────────────────────────
  if (page === 2) return (
    <Shell title="Quel est le motif ?" page={3} totalPages={TOTAL} onBack={() => {
      if (!odooVehicle || vehicleConfirmed === false) setPage(11)
      else setPage(1)
    }}>
      <div className="mt-2 flex flex-col gap-3">
        {motifs.map(m => (
          <ChoiceBtn key={m.value} label={m.label} selected={motif === m.value}
            onClick={() => {
              setMotif(m.value); setMotifLabel(m.label)
              setPage(m.value === 'autre' ? 13 : 3)
            }} />
        ))}
      </div>
    </Shell>
  )

  // ── Page 13 — Motif Autre ─────────────────────────────────
  if (page === 13) return (
    <Shell title="Préciser le motif" page={3} totalPages={TOTAL} onBack={() => setPage(2)}>
      <div className="mt-4">
        <input
          value={motifPrecision}
          onChange={e => setMotifPrecision(e.target.value)}
          placeholder="Décris l'intervention…"
          autoFocus
          className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-lg text-center outline-none mb-2"
        />
        <p className="text-zinc-600 text-xs text-center mb-8">Apparaîtra sur le devis</p>
        <BigBtn label="Continuer →" onClick={() => setPage(3)} disabled={!motifPrecision.trim()} />
      </div>
    </Shell>
  )

  // ── Page 3 — Lieu ─────────────────────────────────────────
  if (page === 3) return (
    <Shell title="Lieu d'intervention" page={4} totalPages={TOTAL} onBack={() => setPage(motif === 'autre' ? 13 : 2)}>
      <div className="mt-4">
        <div className="relative mb-2">
          <input
            ref={locationInputRef}
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="Adresse du lieu…"
            className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-base outline-none pr-14"
          />
          <button onClick={getMyLocation} disabled={locationLoading}
            className="absolute right-3 top-2.5 bg-[#2a2a2a] rounded-xl px-3 py-2 text-sm disabled:opacity-40">
            {locationLoading ? '⏳' : '🎯'}
          </button>
        </div>
        <p className="text-zinc-600 text-xs mb-8">Tape une adresse ou utilise ta position GPS</p>
        <BigBtn label="Continuer →" onClick={() => setPage(5)} disabled={!location.trim()} />
      </div>
    </Shell>
  )

  // Lancer un paiement SumUp
  const startSumup = async (mode: string) => {
    if (!amount || parseFloat(amount) <= 0) { setError('Montant requis'); return }
    setSumupLoading(true); setSumupMode(mode); setError('')
    try {
      const res = await fetch('/api/sumup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(amount),
          reference: `VD-TEMP-${Date.now()}`,
          description: `Intervention véhicule ${plate}`,
          mode,
          clientEmail: mode === 'email' ? clientEmail : undefined,
          clientName,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSumupData(data)

      if (mode === 'terminal') {
        window.location.href = data.terminalDeepLink
      } else if (mode === 'tap') {
        window.open(data.tapToPayLink, '_blank')
      }

      // Polling statut
      setSumupPolling(true)
      const interval = setInterval(async () => {
        const s = await fetch(`/api/sumup?checkoutId=${data.checkoutId}`)
        const status = await s.json()
        if (status.status === 'PAID') {
          setSumupStatus('PAID')
          setPaymentMode('sumup')
          clearInterval(interval)
          setSumupPolling(false)
          setTimeout(() => setPage(9), 1500)
        } else if (status.status === 'FAILED' || status.status === 'EXPIRED') {
          setSumupStatus(status.status)
          clearInterval(interval)
          setSumupPolling(false)
        }
      }, 3000)
      setTimeout(() => { clearInterval(interval); setSumupPolling(false) }, 5 * 60 * 1000)

    } catch (err: any) {
      setError(err.message)
      setSumupMode(null)
    } finally {
      setSumupLoading(false)
    }
  }

  // ── Page 4 — Montant & paiement ──────────────────────────
  if (page === 4) return (
    <Shell title="Montant & paiement" page={5} totalPages={TOTAL} onBack={() => isNewClient ? setPage(8) : setPage(5)}>
      <div className="mt-4">
        <div className="relative mb-6">
          <input
            type="text"
            id="amount-field"
            value={amount}
            onChange={e => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); setSumupData(null); setSumupStatus(null) }}
            placeholder="0.00"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="decimal"
            data-lpignore="true"
            data-form-type="other"
            className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-3xl font-bold text-center outline-none"
          />
          <span className="absolute right-5 top-4 text-zinc-400 text-xl">€</span>
        </div>

        {/* Statut SumUp */}
        {sumupStatus === 'PAID' && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm text-center mb-4">
            ✅ Paiement SumUp confirmé !
          </div>
        )}
        {sumupStatus === 'FAILED' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm text-center mb-4">
            ❌ Paiement refusé — réessaie
          </div>
        )}
        {sumupPolling && !sumupStatus && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-400 text-sm text-center mb-4">
            ⏳ En attente du paiement…
          </div>
        )}

        {/* QR Code SumUp */}
        {sumupData?.qrUrl && sumupMode === 'qr' && !sumupStatus && (
          <div className="bg-white rounded-2xl p-4 mb-4 text-center">
            <p className="text-zinc-600 text-xs mb-2">Montrez ce QR au client — il paye sur son téléphone</p>
            <img
              src={sumupData.qrUrl}
              alt="QR Code SumUp"
              className="mx-auto w-52 h-52 pointer-events-none"
              draggable={false}
            />
            <p className="text-zinc-400 text-xs mt-2">Carte, Apple Pay, Google Pay acceptés</p>
          </div>
        )}

        {/* Email envoyé */}
        {sumupData && sumupMode === 'email' && !sumupStatus && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3 text-blue-400 text-sm text-center mb-4">
            📧 Lien de paiement envoyé à {clientEmail}
          </div>
        )}

        {/* 6 boutons de paiement */}
        {!sumupStatus && (
          <div className="flex flex-col gap-2 mb-6">
            {[
              { mode: 'cash',     icon: '💵', label: 'Espèces',              sumup: false },
              { mode: 'terminal', icon: '💳', label: 'SumUp Terminal',        sumup: true  },
              { mode: 'qr',       icon: '📱', label: 'QR Code',               sumup: true  },
              { mode: 'tap',      icon: '📲', label: 'Tap to Pay',            sumup: true  },
              { mode: 'email',    icon: '✉️',  label: 'Lien Email',            sumup: true, disabled: !clientEmail },
              { mode: 'unpaid',   icon: '📋', label: 'Non payé — À facturer', sumup: false },
            ].map(btn => (
              <button
                key={btn.mode}
                type="button"
                onClick={() => {
                  if (btn.disabled) return
                  // Réinitialiser SumUp si on change de mode
                  setSumupData(null)
                  setSumupStatus(null)
                  setSumupMode(null)
                  setSumupPolling(false)
                  if (btn.sumup) {
                    startSumup(btn.mode)
                  } else {
                    setPaymentMode(btn.mode)
                  }
                }}
                disabled={!!btn.disabled}
                className={`w-full flex items-center gap-3 px-5 py-4 rounded-2xl border text-left font-medium transition-all active:scale-95 disabled:opacity-40 ${
                  paymentMode === btn.mode
                    ? 'bg-brand border-brand text-white'
                    : sumupMode === btn.mode && sumupPolling
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                    : btn.mode === 'unpaid'
                    ? 'bg-[#1e1e1e] border-dashed border-[#444] text-zinc-500'
                    : 'bg-[#1e1e1e] border-[#2a2a2a] text-white hover:border-brand'
                }`}>
                <span className="text-xl">{btn.icon}</span>
                <span className="flex-1">{btn.label}</span>
                {btn.mode === 'email' && !clientEmail && <span className="text-zinc-600 text-xs">Email requis</span>}
                {btn.sumup && btn.mode !== 'email' && <span className="text-zinc-600 text-xs">SumUp</span>}
              </button>
            ))}
          </div>
        )}

        <BigBtn label="Continuer →" onClick={() => setPage(9)}
          disabled={!amount || (!paymentMode && !sumupStatus)} />
      </div>
    </Shell>
  )

  // ── Page 5 — Sélection client ─────────────────────────────
  if (page === 5) return (
    <Shell title="Qui est le client ?" page={6} totalPages={TOTAL} onBack={() => setPage(3)}>
      <div className="mt-2 flex flex-col gap-3">
        {previousClients.map(client => (
          <button key={client.id}
            onClick={() => { setSelectedClient(client); setIsNewClient(false); setPage(4) }}
            className="w-full text-left bg-[#1e1e1e] border border-[#2a2a2a] hover:border-brand rounded-2xl p-4 transition-all active:scale-95">
            <p className="text-white font-semibold">{client.name}</p>
            {client.phone && <p className="text-zinc-500 text-sm mt-0.5">{client.phone}</p>}
            {client.address && <p className="text-zinc-600 text-xs mt-0.5 truncate">{client.address}</p>}
          </button>
        ))}
        <button onClick={() => { setSelectedClient(null); setIsNewClient(true); setPage(6) }}
          className="w-full bg-[#1e1e1e] border border-dashed border-[#444] rounded-2xl p-4 text-zinc-400 font-medium text-center hover:border-zinc-300 transition-all active:scale-95">
          Pas dans cette liste
        </button>
      </div>
    </Shell>
  )

  // ── Page 6 — TVA ─────────────────────────────────────────
  if (page === 6) return (
    <Shell title="Numéro de TVA ?" page={6} totalPages={TOTAL} onBack={() => setPage(5)}>
      <div className="mt-4">
        <input
          value={clientVat}
          onChange={e => { setClientVat(e.target.value.toUpperCase()); setViesResult(null) }}
          placeholder="BE0460759205"
          autoComplete="off"
          autoFocus
          className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-xl font-bold text-center outline-none uppercase mb-2"
        />
        {viesResult && (
          <div className={`rounded-xl px-4 py-3 text-sm border mb-4 ${viesResult.valid ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
            {viesResult.valid
              ? viesResult.odooFound
                ? `✓ ${viesResult.odooName} — client existant`
                : `✓ ${viesResult.name || 'TVA valide'}`
              : '✗ TVA invalide ou introuvable'}
          </div>
        )}
        <p className="text-zinc-600 text-xs text-center mb-8">Pour un particulier, passe directement</p>
        <div className="flex flex-col gap-3">
          <BigBtn
            label={viesLoading ? 'Vérification…' : 'Continuer →'}
            disabled={viesLoading}
            onClick={async () => {
              if (clientVat.length >= 5) {
                const result = await checkVies()
                if (result?.valid && result?.odooFound && result?.hasPhone) {
                  setPage(4); return
                }
              }
              setPage(7)
            }}
          />
          <BigBtn label="Client particulier →" secondary onClick={() => { setClientVat(''); setViesResult(null); setPage(7) }} />
        </div>
      </div>
    </Shell>
  )

  // Helper — remplir client depuis Odoo
  const fillFromOdooPartner = (p: any) => {
    setClientName(p.name)
    setClientPhone(p.phone)
    setClientEmail(p.email)
    setClientStreet(p.street)
    setClientZip(p.zip)
    setClientCity(p.city)
    setClientCountryCode(p.countryCode)
    setClientAddress(p.address)
    setClientVat(p.vat)
  }

  const searchOdooByName = async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/partners?name=${encodeURIComponent(clientName.trim())}`)
      const data = await res.json()
      if (data.found) { fillFromOdooPartner(data.partner); return true }
    } catch {}
    return false
  }

  const searchOdooByPhone = async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/partners?phone=${encodeURIComponent(clientPhone.trim())}`)
      const data = await res.json()
      if (data.found) { fillFromOdooPartner(data.partner); return true }
    } catch {}
    return false
  }

  const [odooNameMatches, setOdooNameMatches] = useState<any[]>([])
  const [nameSearchLoading, setNameSearchLoading] = useState(false)

  const searchOdooByNameMultiple = async (): Promise<any[]> => {
    try {
      const inverted = clientName.trim().split(' ').length > 1
        ? [...clientName.trim().split(' ').slice(1), clientName.trim().split(' ')[0]].join(' ')
        : clientName.trim()

      const results: any[] = []
      for (const n of [clientName.trim(), inverted]) {
        const res = await fetch(`/api/partners?name=${encodeURIComponent(n)}`)
        const data = await res.json()
        if (data.found && !results.find(r => r.id === data.partner.id)) {
          results.push(data.partner)
        }
      }
      return results
    } catch {}
    return []
  }

  // ── Page 7 — Nom ─────────────────────────────────────────
  if (page === 7) return (
    <Shell title="Nom du client" page={7} totalPages={TOTAL} onBack={() => setPage(6)}>
      <div className="mt-4">
        <input
          value={clientName}
          onChange={e => setClientName(e.target.value)}
          placeholder="Nom et prénom ou société"
          autoComplete="off"
          autoFocus
          className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-5 py-4 text-white text-xl font-bold text-center outline-none mb-8"
        />
        <BigBtn
          label={nameSearchLoading ? 'Recherche…' : 'Continuer →'}
          disabled={!clientName.trim() || nameSearchLoading}
          onClick={async () => {
            if (!clientName.trim()) return
            setNameSearchLoading(true)
            const matches = await searchOdooByNameMultiple()
            setNameSearchLoading(false)
            if (matches.length > 0) {
              setOdooNameMatches(matches)
              setPage(14) // page de sélection des correspondances
            } else {
              setPage(8) // nouveau client direct
            }
          }}
        />
      </div>
    </Shell>
  )

  // ── Page 14 — Correspondances Odoo par nom ────────────────
  if (page === 14) return (
    <Shell title="Ce client est-il déjà connu ?" page={7} totalPages={TOTAL} onBack={() => setPage(7)}>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-zinc-500 text-xs mb-2">
          {odooNameMatches.length} correspondance{odooNameMatches.length > 1 ? 's' : ''} trouvée{odooNameMatches.length > 1 ? 's' : ''} pour "{clientName}"
        </p>
        {odooNameMatches.map(client => (
          <button
            key={client.id}
            onClick={() => {
              fillFromOdooPartner(client)
              setSelectedClient(client)
              setIsNewClient(false)
              setPage(4) // montant directement
            }}
            className="w-full text-left bg-[#1e1e1e] border border-[#2a2a2a] hover:border-brand rounded-2xl p-4 transition-all active:scale-95">
            <p className="text-white font-semibold">{client.name}</p>
            {client.phone && <p className="text-zinc-500 text-sm mt-0.5">{client.phone}</p>}
            {client.address && <p className="text-zinc-600 text-xs mt-0.5 truncate">{client.address}</p>}
            {client.vat && <p className="text-zinc-700 text-xs mt-0.5">{client.vat}</p>}
          </button>
        ))}
        <button
          onClick={() => {
            setSelectedClient(null)
            setIsNewClient(true)
            setOdooNameMatches([])
            setPage(8) // coordonnées nouveau client
          }}
          className="w-full bg-[#1e1e1e] border border-dashed border-[#444] rounded-2xl p-4 text-zinc-400 font-medium text-center hover:border-zinc-300 transition-all active:scale-95">
          Aucun de ces clients — créer un nouveau
        </button>
      </div>
    </Shell>
  )

  // ── Page 8 — Adresse + contact ───────────────────────────
  if (page === 8) return (
    <Shell title="Coordonnées du client" page={8} totalPages={TOTAL} onBack={() => setPage(7)}>
      <div className="mt-4 flex flex-col gap-4">
        <div>
          <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Adresse</label>
          <input
            ref={clientAddressInputRef}
            value={clientAddress}
            onChange={e => setClientAddress(e.target.value)}
            placeholder="Rue, numéro, code postal, ville"
            className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-4 py-3 text-white text-sm outline-none"
          />
        </div>
        <div>
          <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Téléphone <span className="text-brand">*</span></label>
          <input
            value={clientPhone}
            onChange={e => setClientPhone(e.target.value)}
            type="tel" placeholder="+32 4xx xxx xxx"
            autoComplete="tel"
            className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-4 py-3 text-white text-sm outline-none"
          />
        </div>
        <div>
          <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Email</label>
          <input
            value={clientEmail}
            onChange={e => setClientEmail(e.target.value)}
            type="email" placeholder="client@email.com"
            autoComplete="email"
            className="w-full bg-[#1e1e1e] border border-[#333] focus:border-brand rounded-2xl px-4 py-3 text-white text-sm outline-none"
          />
        </div>
        <BigBtn label="Continuer →" onClick={async () => {
          if (!clientPhone.trim()) return
          // Chercher par téléphone si pas encore trouvé par nom
          if (!clientStreet && !clientAddress) {
            await searchOdooByPhone()
          }
          setPage(4)
        }} disabled={!clientPhone.trim()} />
      </div>
    </Shell>
  )

  // ── Page 9 — Récapitulatif ────────────────────────────────
  if (page === 9) {
    const client = selectedClient || {
      name: clientName, phone: clientPhone, email: clientEmail, address: clientAddress, vat: clientVat
    }
    const vehicleDisplay = vehicleConfirmed && odooVehicle
      ? `${odooVehicle.brandName} ${odooVehicle.modelName}`
      : `${selectedBrand} ${selectedModel === 'Autre' ? (modelOther || 'Autre') : selectedModel}`

    return (
      <Shell title="Récapitulatif" page={9} totalPages={TOTAL} onBack={() => setPage(4)}>
        <div className="mt-2">
          {[
            { label: 'Immat', value: plate },
            { label: 'Véhicule', value: vehicleDisplay.trim() },
            { label: 'Motif', value: motifPrecision || motifLabel },
            { label: 'Lieu', value: location },
            { label: 'Montant', value: `${parseFloat(amount || '0').toFixed(2)} € TVAC` },
            { label: 'Paiement', value: paymentModes.find(p => p.value === paymentMode)?.label },
            { label: 'Client', value: client.name },
            { label: 'Téléphone', value: client.phone },
            { label: 'Adresse', value: client.address },
          ].filter(r => r.value).map(row => (
            <div key={row.label} className="flex justify-between items-start gap-3 py-2.5 border-b border-[#1e1e1e]">
              <span className="text-zinc-500 text-sm flex-shrink-0">{row.label}</span>
              <span className="text-white text-sm text-right">{row.value}</span>
            </div>
          ))}

          <div className="mt-5">
            <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Remarques (optionnel)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notes internes…"
              rows={2}
              className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand resize-none mb-5"
            />
            <BigBtn label={saving ? 'Enregistrement…' : '✓ Enregistrer'} onClick={handleSubmit} disabled={saving} />
            {error && <p className="text-red-400 text-sm text-center mt-3">{error}</p>}
          </div>
        </div>
      </Shell>
    )
  }

  return null
}
