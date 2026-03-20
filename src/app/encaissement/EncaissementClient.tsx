'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface ListItem { value: string; label: string }
interface Brand { id: number; name: string }
interface Model { id: number; name: string }

declare global {
  interface Window {
    google: any
    initGooglePlaces: () => void
  }
}

export default function EncaissementClient({
  motifs,
  paymentModes,
}: {
  motifs: ListItem[]
  paymentModes: ListItem[]
}) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Étape 1
  const [plate, setPlate] = useState('')
  const [brands, setBrands] = useState<Brand[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [selectedBrand, setSelectedBrand] = useState('')
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [modelOther, setModelOther] = useState('')
  const [location, setLocation] = useState('')
  const [locationLoading, setLocationLoading] = useState(false)
  const [motif, setMotif] = useState('')
  const [motifLabel, setMotifLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMode, setPaymentMode] = useState('')

  // Étape 2
  const [clientVat, setClientVat] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [viesLoading, setViesLoading] = useState(false)
  const [viesResult, setViesResult] = useState<{ name?: string; address?: string; valid?: boolean } | null>(null)

  const locationInputRef = useRef<HTMLInputElement>(null)
  const clientAddressInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const autocompleteClientRef = useRef<any>(null)

  // Charger Google Maps Places
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) return

    window.initGooglePlaces = () => {
      const options = { types: ['address'], componentRestrictions: { country: ['be', 'fr', 'de', 'nl', 'lu'] } }
      if (locationInputRef.current) {
        autocompleteRef.current = new window.google.maps.places.Autocomplete(locationInputRef.current, options)
        autocompleteRef.current.addListener('place_changed', () => {
          const place = autocompleteRef.current.getPlace()
          if (place?.formatted_address) setLocation(place.formatted_address)
        })
      }
      if (clientAddressInputRef.current) {
        autocompleteClientRef.current = new window.google.maps.places.Autocomplete(clientAddressInputRef.current, options)
        autocompleteClientRef.current.addListener('place_changed', () => {
          const place = autocompleteClientRef.current.getPlace()
          if (place?.formatted_address) setClientAddress(place.formatted_address)
        })
      }
    }

    if (!document.getElementById('google-maps-script')) {
      const script = document.createElement('script')
      script.id = 'google-maps-script'
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initGooglePlaces`
      script.async = true
      document.head.appendChild(script)
    } else if (window.google) {
      window.initGooglePlaces()
    }
  }, [step])

  // Bouton "Ici" — géolocalisation
  const getMyLocation = () => {
    if (!navigator.geolocation) {
      setError('Géolocalisation non supportée par ce navigateur')
      return
    }
    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        try {
          // Reverse geocoding via OpenStreetMap Nominatim (gratuit, pas de clé)
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
            { headers: { 'Accept-Language': 'fr' } }
          )
          const data = await res.json()
          if (data.display_name) {
            setLocation(data.display_name)
          } else {
            setLocation(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`)
          }
        } catch {
          setLocation(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`)
        } finally {
          setLocationLoading(false)
        }
      },
      (err) => {
        setLocationLoading(false)
        if (err.code === err.PERMISSION_DENIED) {
          setError('Accès à la localisation refusé. Autorise la géolocalisation dans les paramètres.')
        } else {
          setError('Impossible de récupérer ta position.')
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // Charger les marques
  useEffect(() => {
    fetch('/api/vehicles?type=brands').then(r => r.json()).then(setBrands)
  }, [])

  // Charger les modèles
  useEffect(() => {
    if (!selectedBrandId) { setModels([]); return }
    fetch(`/api/vehicles?type=models&brandId=${selectedBrandId}`).then(r => r.json()).then(setModels)
  }, [selectedBrandId])

  const handleBrandChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    const brand = brands.find(b => b.id === parseInt(val))
    setSelectedBrand(brand?.name || '')
    setSelectedBrandId(val ? parseInt(val) : null)
    setSelectedModel(''); setSelectedModelId(null); setModelOther('')
  }

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    const model = models.find(m => m.id === parseInt(val))
    setSelectedModel(model?.name || '')
    setSelectedModelId(val ? parseInt(val) : null)
    if (model?.name !== 'Autre') setModelOther('')
  }

  // VIES
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

  const validateStep1 = () => {
    if (!plate.trim()) return 'Immatriculation ou VIN requis'
    if (!selectedBrandId) return 'Marque requise'
    if (!selectedModelId) return 'Modèle requis'
    if (!location.trim()) return "Lieu d'intervention requis"
    if (!motif) return 'Motif requis'
    if (!amount || isNaN(parseFloat(amount))) return 'Montant invalide'
    if (!paymentMode) return 'Mode de paiement requis'
    return ''
  }

  const goToStep2 = () => {
    const err = validateStep1()
    if (err) { setError(err); return }
    setError(''); setStep(2); window.scrollTo(0, 0)
  }

  const handleSubmit = async () => {
    if (!clientPhone.trim()) { setError('Téléphone requis'); return }
    setError(''); setSaving(true)
    try {
      const res = await fetch('/api/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_type: 'encaissement',
          plate: plate.toUpperCase(),
          brand_id: selectedBrandId,
          model_id: selectedModel === 'Autre' ? null : selectedModelId,
          brand_text: selectedBrand,
          model_text: selectedModel === 'Autre' ? (modelOther || 'Autre') : selectedModel,
          motif_id: motif, motif_text: motifLabel,
          location_address: location, amount,
          payment_mode: paymentMode,
          client_vat: clientVat, client_name: clientName,
          client_address: clientAddress, client_phone: clientPhone,
          client_email: clientEmail, notes,
        })
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Erreur'); return }
      setSaved(true)
    } finally { setSaving(false) }
  }

  const resetForm = () => {
    setSaved(false); setStep(1)
    setPlate(''); setSelectedBrand(''); setSelectedBrandId(null)
    setSelectedModel(''); setSelectedModelId(null); setModelOther('')
    setLocation(''); setMotif(''); setMotifLabel(''); setAmount(''); setPaymentMode('')
    setClientVat(''); setClientName(''); setClientAddress('')
    setClientPhone(''); setClientEmail(''); setNotes(''); setViesResult(null)
  }

  if (saved) {
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl mb-6">✅</div>
        <h2 className="text-white text-2xl font-bold mb-2">Enregistré !</h2>
        <p className="text-zinc-500 text-sm mb-8">L'intervention a été sauvegardée avec succès.</p>
        <button onClick={resetForm} className="w-full max-w-sm bg-brand text-white font-bold rounded-xl py-3.5 mb-3">
          + Nouvelle intervention
        </button>
        <Link href="/dashboard" className="text-zinc-500 text-sm">← Retour au dashboard</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-5 pt-12 pb-4 safe-top">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/dashboard" className="text-zinc-500 hover:text-white text-sm">←</Link>
          <h1 className="text-white font-bold text-lg">Encaissement Chauffeur</h1>
        </div>
        <div className="flex gap-2 mt-3">
          {[1, 2].map(s => (
            <div key={s} className={`flex-1 h-1 rounded-full transition-colors ${step >= s ? 'bg-brand' : 'bg-[#2a2a2a]'}`} />
          ))}
        </div>
        <p className="text-zinc-500 text-xs mt-2">
          {step === 1 ? 'Étape 1 — Véhicule & intervention' : 'Étape 2 — Informations client'}
        </p>
      </div>

      <div className="flex-1 px-4 py-5 overflow-y-auto pb-10">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {step === 1 && (
          <>
            {/* Immat */}
            <div className="mb-4">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Immat ou VIN <span className="text-brand">*</span></label>
              <input value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} placeholder="1-ABC-234"
                className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand uppercase" />
            </div>

            {/* Marque */}
            <div className="mb-4">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Marque <span className="text-brand">*</span></label>
              <select value={selectedBrandId || ''} onChange={handleBrandChange}
                className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand appearance-none">
                <option value="">Sélectionner une marque…</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            {/* Modèle */}
            <div className="mb-4">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Modèle <span className="text-brand">*</span></label>
              <select value={selectedModelId || ''} onChange={handleModelChange} disabled={!selectedBrandId}
                className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand appearance-none disabled:opacity-40">
                <option value="">{selectedBrandId ? 'Sélectionner un modèle…' : 'Choisir une marque d\'abord'}</option>
                {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {selectedModel === 'Autre' && (
                <input value={modelOther} onChange={e => setModelOther(e.target.value)}
                  placeholder="Préciser le modèle (optionnel)"
                  className="w-full bg-[#1e1e1e] border border-brand/50 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand mt-2" />
              )}
            </div>

            {/* Lieu avec bouton Ici */}
            <div className="mb-4">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Lieu d'intervention <span className="text-brand">*</span></label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    ref={locationInputRef}
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    placeholder="Adresse ou description du lieu"
                    className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 pr-9 text-white text-sm outline-none focus:border-brand"
                  />
                  <span className="absolute right-3 top-3 text-zinc-500 text-base">📍</span>
                </div>
                <button
                  onClick={getMyLocation}
                  disabled={locationLoading}
                  className="bg-[#1e1e1e] border border-[#333] hover:border-brand text-white rounded-xl px-3 py-3 text-sm font-semibold transition-colors disabled:opacity-40 whitespace-nowrap flex items-center gap-1.5"
                >
                  {locationLoading ? (
                    <span className="animate-spin text-base">⏳</span>
                  ) : (
                    <><span className="text-base">🎯</span> Ici</>
                  )}
                </button>
              </div>
              <p className="text-zinc-600 text-xs mt-1 pl-1">Tape une adresse ou appuie sur "Ici" pour ta position GPS</p>
            </div>

            {/* Motif */}
            <div className="mb-4">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Motif <span className="text-brand">*</span></label>
              <select value={motif} onChange={e => { setMotif(e.target.value); setMotifLabel(motifs.find(m => m.value === e.target.value)?.label || '') }}
                className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand appearance-none">
                <option value="">Sélectionner un motif…</option>
                {motifs.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>

            {/* Montant */}
            <div className="mb-4">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Montant payé (€) <span className="text-brand">*</span></label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00" min="0" step="0.01"
                className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand" />
            </div>

            {/* Mode paiement */}
            <div className="mb-6">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Mode de paiement <span className="text-brand">*</span></label>
              <div className="flex flex-wrap gap-2">
                {paymentModes.map(p => (
                  <button key={p.value} onClick={() => setPaymentMode(p.value)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                      paymentMode === p.value ? 'bg-brand border-brand text-white' : 'bg-[#1e1e1e] border-[#333] text-zinc-400 hover:border-zinc-500'
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={goToStep2} className="w-full bg-brand text-white font-bold rounded-xl py-3.5">
              Suivant →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            {/* TVA */}
            <div className="mb-4">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Numéro TVA</label>
              <div className="flex gap-2">
                <input value={clientVat} onChange={e => { setClientVat(e.target.value.toUpperCase()); setViesResult(null) }}
                  placeholder="BE0460759205"
                  className="flex-1 bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand uppercase" />
                <button onClick={checkVies} disabled={viesLoading || clientVat.length < 5}
                  className="bg-[#1e1e1e] border border-[#333] hover:border-brand text-brand font-bold text-sm rounded-xl px-4 transition-colors disabled:opacity-40">
                  {viesLoading ? '…' : 'VIES'}
                </button>
              </div>
              {viesResult && (
                <div className={`mt-2 rounded-xl px-4 py-3 text-sm border ${viesResult.valid ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                  {viesResult.valid ? `✓ ${viesResult.name || 'TVA valide'}` : '✗ Numéro de TVA invalide ou introuvable'}
                </div>
              )}
            </div>

            {/* Nom */}
            <div className="mb-4">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Nom et prénom / Société</label>
              <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Nom du client ou société"
                className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand" />
            </div>

            {/* Adresse */}
            <div className="mb-4">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Adresse client</label>
              <input
                ref={clientAddressInputRef}
                value={clientAddress} onChange={e => setClientAddress(e.target.value)}
                placeholder="Rue, numéro, code postal, ville"
                className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand" />
            </div>

            {/* Téléphone */}
            <div className="mb-4">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Téléphone <span className="text-brand">*</span></label>
              <input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="+32 4xx xxx xxx" type="tel"
                className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand" />
            </div>

            {/* Email */}
            <div className="mb-4">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Email</label>
              <input value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="client@email.com" type="email"
                className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand" />
            </div>

            {/* Remarques */}
            <div className="mb-5">
              <label className="text-zinc-400 text-xs font-medium mb-1.5 block">Remarques</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes internes, observations…" rows={3}
                className="w-full bg-[#1e1e1e] border border-[#333] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand resize-none" />
            </div>

            {/* Récap */}
            <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl p-4 mb-5">
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">Récapitulatif</p>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500 flex-shrink-0">Véhicule</span>
                  <span className="text-white font-medium text-right">{plate} — {selectedBrand} {selectedModel === 'Autre' ? (modelOther || 'Autre') : selectedModel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Motif</span>
                  <span className="text-white">{motifLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Lieu</span>
                  <span className="text-white text-right text-xs">{location.slice(0, 40)}{location.length > 40 ? '…' : ''}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Montant</span>
                  <span className="text-brand font-bold">{parseFloat(amount || '0').toFixed(2)} €</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Paiement</span>
                  <span className="text-white">{paymentModes.find(p => p.value === paymentMode)?.label}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setStep(1); setError('') }}
                className="flex-1 bg-[#1e1e1e] border border-[#333] text-zinc-400 font-bold rounded-xl py-3.5">
                ← Retour
              </button>
              <button onClick={handleSubmit} disabled={saving}
                className="flex-1 bg-brand text-white font-bold rounded-xl py-3.5 disabled:opacity-50">
                {saving ? 'Enregistrement…' : '✓ Enregistrer'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
