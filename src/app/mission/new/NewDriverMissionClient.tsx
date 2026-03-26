'use client'
// src/app/mission/new/NewDriverMissionClient.tsx
// Corrections P6b :
// - Google Maps Script chargé localement
// - Confirmation véhicule trouvé (peut avoir changé)
// - Pas de mention Odoo → "notre base de données"
// - Marques/modèles depuis /api/vehicles
// - Status in_progress pour apparaître dans dispatch

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OdooVehicle {
  id: number; plate: string; vin: string|false
  brand: string; model: string
}
interface Brand { id: number; name: string }
interface Model { id: number; name: string; brand_id: number }

// ── Constantes ────────────────────────────────────────────────────────────────

const SOURCES = [
  { value: 'police', label: 'Police',  icon: '🚔', color: 'border-blue-700  bg-blue-900/40'  },
  { value: 'prive',  label: 'Privé',   icon: '👤', color: 'border-zinc-600  bg-zinc-800/40'  },
  { value: 'garage', label: 'Garage',  icon: '🔧', color: 'border-amber-700 bg-amber-900/40' },
  { value: 'autre',  label: 'Autre',   icon: '📋', color: 'border-zinc-600  bg-zinc-800/40'  },
]

const TYPES = [
  { value: 'DSP',       label: 'DSP',       sub: 'Dépannage sur place', color: 'border-orange-700 bg-orange-900/30' },
  { value: 'REM',       label: 'REM',       sub: 'Remorquage',          color: 'border-blue-700   bg-blue-900/30'   },
  { value: 'Transport', label: 'Transport', sub: 'Rapatriement',        color: 'border-purple-700 bg-purple-900/30' },
]

// ── Composant Adresse avec Google Maps ───────────────────────────────────────

function AddressInput({ value, onChange, onSelect, mapsReady }: {
  value: string
  onChange: (v: string) => void
  onSelect: (addr: string, lat: number, lng: number, city: string) => void
  mapsReady: boolean
}) {
  const ref   = useRef<HTMLInputElement>(null)
  const acRef = useRef<any>(null)

  useEffect(() => {
    if (!mapsReady || !ref.current || acRef.current) return
    const g = (window as any).google
    if (!g?.maps?.places) return
    acRef.current = new g.maps.places.Autocomplete(ref.current, {
      componentRestrictions: { country: ['be','lu','fr','nl','de'] },
      fields: ['formatted_address','geometry','address_components'],
    })
    acRef.current.addListener('place_changed', () => {
      const p = acRef.current.getPlace()
      if (!p?.geometry) return
      const addr = p.formatted_address || ''
      const lat  = p.geometry.location.lat()
      const lng  = p.geometry.location.lng()
      const cityComp = (p.address_components || []).find((c: any) =>
        c.types.includes('locality') || c.types.includes('postal_town')
      )
      onChange(addr)
      onSelect(addr, lat, lng, cityComp?.long_name || '')
    })
  }, [mapsReady])

  return (
    <input
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Ex: Rue de la Paix 12, Liège"
      autoFocus
      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-4 py-4 text-white text-base focus:outline-none focus:border-brand placeholder:text-zinc-600"
    />
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function NewDriverMissionClient() {
  const router = useRouter()

  const [mapsReady, setMapsReady] = useState(false)
  const [step, setStep] = useState<1|2|3|4>(1)

  // Données
  const [source,      setSource]      = useState('')
  const [missionType, setMissionType] = useState('')
  const [address,     setAddress]     = useState('')
  const [addrLat,     setAddrLat]     = useState<number|null>(null)
  const [addrLng,     setAddrLng]     = useState<number|null>(null)
  const [addrCity,    setAddrCity]    = useState('')

  // Véhicule — recherche
  const [plateQuery,   setPlateQuery]   = useState('')
  const [searching,    setSearching]    = useState(false)
  const [vehicleFound, setVehicleFound] = useState<OdooVehicle|null>(null)
  // 'idle' | 'found' | 'confirmed' | 'rejected' | 'not_found'
  const [vehicleState, setVehicleState] = useState<'idle'|'found'|'confirmed'|'rejected'|'not_found'>('idle')

  // Saisie manuelle
  const [brands,      setBrands]      = useState<Brand[]>([])
  const [models,      setModels]      = useState<Model[]>([])
  const [manualBrand, setManualBrand] = useState('')
  const [manualBrandId, setManualBrandId] = useState<number|null>(null)
  const [manualModel, setManualModel] = useState('')
  const [manualPlate, setManualPlate] = useState('')
  const [manualVin,   setManualVin]   = useState('')
  const [note,        setNote]        = useState('')

  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [gpsLoading, setGpsLoading] = useState(false)

  // ── Charger marques au montage ────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/vehicles')
      .then(r => r.json())
      .then(d => {
        setBrands(d.brands || [])
        setModels(d.models || [])
      })
      .catch(() => {})
  }, [])

  const filteredModels = models.filter(m => !manualBrandId || m.brand_id === manualBrandId)

  // ── Recherche Odoo ────────────────────────────────────────────────────────

  const searchVehicle = async () => {
    if (plateQuery.length < 3) return
    setSearching(true)
    setVehicleFound(null)
    setVehicleState('idle')
    try {
      const r = await fetch(`/api/odoo/search-vehicle?q=${encodeURIComponent(plateQuery)}`)
      const d = await r.json()
      const vehicles: OdooVehicle[] = d.vehicles || []
      if (vehicles.length > 0) {
        setVehicleFound(vehicles[0])
        setVehicleState('found')
      } else {
        setVehicleState('not_found')
        setManualPlate(plateQuery.toUpperCase())
      }
    } catch {
      setVehicleState('not_found')
      setManualPlate(plateQuery.toUpperCase())
    } finally {
      setSearching(false)
    }
  }

  const confirmVehicle = () => setVehicleState('confirmed')

  const rejectVehicle = () => {
    // Véhicule trouvé mais pas le bon → saisie manuelle avec plaque pré-remplie
    setManualPlate(plateQuery.toUpperCase())
    setVehicleState('rejected')
  }

  // ── Soumission ────────────────────────────────────────────────────────────

  const handleSubmit = async (skipVehicle = false) => {
    setError('')
    setSaving(true)
    try {
      let plate: string|null = null
      let brand: string|null = null
      let model: string|null = null
      let vin:   string|null = null

      if (!skipVehicle) {
        if (vehicleState === 'confirmed' && vehicleFound) {
          plate = vehicleFound.plate
          brand = vehicleFound.brand
          model = vehicleFound.model
          vin   = vehicleFound.vin || null
        } else if (vehicleState === 'rejected' || vehicleState === 'not_found') {
          plate = manualPlate || null
          brand = manualBrand || null
          model = manualModel || null
          vin   = manualVin   || null
        }
      }

      const r = await fetch('/api/missions/driver-create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          mission_type:     missionType,
          incident_address: address,
          incident_city:    addrCity || null,
          incident_lat:     addrLat,
          incident_lng:     addrLng,
          vehicle_plate:    plate,
          vehicle_brand:    brand,
          vehicle_model:    model,
          vehicle_vin:      vin,
          remarks_general:  note || null,
        }),
      })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Erreur'); return }
      router.push(`/mission/${data.mission.id}`)
    } catch {
      setError('Erreur réseau, réessaye')
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = vehicleState === 'confirmed'
    || vehicleState === 'rejected'
    || vehicleState === 'not_found'

  const progress = ((step - 1) / 3) * 100

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Chargement Google Maps uniquement si pas déjà présent */}
      <Script
        src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`}
        strategy="afterInteractive"
        onLoad={() => setMapsReady(true)}
        onReady={() => setMapsReady(true)}
      />

      <div className="min-h-screen bg-[#0F0F0F] pb-32">

        {/* Header sticky */}
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => step > 1 ? setStep((step - 1) as 1|2|3|4) : router.push('/mission')}
              className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg flex-shrink-0">
              ←
            </button>
            <div>
              <h1 className="text-white font-bold text-lg">Nouvelle intervention</h1>
              <p className="text-zinc-500 text-xs">Étape {step} sur 4</p>
            </div>
          </div>
          <div className="h-1 bg-[#2a2a2a] rounded-full overflow-hidden">
            <div className="h-full bg-brand rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="px-4 mt-6 space-y-4">

          {/* ── Étape 1 : Source ────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Qui fait appel à vous ?</p>
              <div className="grid grid-cols-2 gap-3">
                {SOURCES.map(s => (
                  <button key={s.value}
                    onClick={() => { setSource(s.value); setStep(2) }}
                    className={`flex flex-col items-center justify-center py-7 rounded-2xl border-2 text-white font-bold transition active:scale-95 ${
                      source === s.value ? s.color : 'bg-[#1A1A1A] border-[#2a2a2a]'
                    }`}>
                    <span className="text-4xl mb-2">{s.icon}</span>
                    <span className="text-base">{s.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Étape 2 : Adresse ───────────────────────────────────────── */}
          {step === 2 && (
            <>
              <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Où se trouve la panne ?</p>

              {/* Bouton position actuelle */}
              <button
                onClick={handleGPS}
                disabled={gpsLoading}
                className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600/20 border border-blue-500/40 hover:bg-blue-600/30 disabled:opacity-50 text-blue-300 font-semibold rounded-2xl text-base transition active:scale-95"
              >
                {gpsLoading ? (
                  <><span className="animate-spin">⏳</span> Localisation en cours…</>
                ) : (
                  <><span>📍</span> Utiliser ma position actuelle</>
                )}
              </button>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[#2a2a2a]" />
                <span className="text-zinc-600 text-xs">ou saisir manuellement</span>
                <div className="flex-1 h-px bg-[#2a2a2a]" />
              </div>

              <AddressInput
                value={address}
                onChange={setAddress}
                mapsReady={mapsReady}
                onSelect={(addr, lat, lng, city) => {
                  setAddress(addr); setAddrLat(lat); setAddrLng(lng); setAddrCity(city)
                }}
              />
              {!mapsReady && (
                <p className="text-zinc-600 text-xs">⏳ Chargement de la recherche d&apos;adresse…</p>
              )}
              {address && addrLat && (
                <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-green-400 text-sm">
                  <span>✓</span>
                  <span className="truncate">{address}</span>
                </div>
              )}
            </>
          )}

          {/* ── Étape 3 : Type ──────────────────────────────────────────── */}
          {step === 3 && (
            <>
              <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Type d&apos;intervention</p>
              <div className="space-y-3">
                {TYPES.map(t => (
                  <button key={t.value}
                    onClick={() => { setMissionType(t.value); setStep(4) }}
                    className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition active:scale-[0.98] ${
                      missionType === t.value ? t.color : 'bg-[#1A1A1A] border-[#2a2a2a]'
                    }`}>
                    <div className="flex-1">
                      <p className="text-white font-bold text-xl">{t.label}</p>
                      <p className="text-zinc-400 text-sm">{t.sub}</p>
                    </div>
                    <span className="text-zinc-600 text-2xl">→</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Étape 4 : Véhicule ──────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Véhicule à prendre en charge</p>

              {/* Recherche plaque */}
              {vehicleState === 'idle' && (
                <div>
                  <label className="block text-white text-sm font-medium mb-2">Recherche par plaque</label>
                  <div className="flex gap-2">
                    <input
                      value={plateQuery}
                      onChange={e => setPlateQuery(e.target.value.toUpperCase())}
                      onKeyDown={e => e.key === 'Enter' && searchVehicle()}
                      placeholder="Ex: 1-ABC-123"
                      className="flex-1 bg-[#111] border border-[#2a2a2a] rounded-xl px-4 py-3.5 text-white font-mono text-base uppercase focus:outline-none focus:border-brand placeholder:text-zinc-600 placeholder:normal-case"
                    />
                    <button onClick={searchVehicle} disabled={searching || plateQuery.length < 3}
                      className="px-4 py-3.5 bg-brand disabled:opacity-40 text-white rounded-xl font-medium text-sm transition">
                      {searching ? '⏳' : '🔍'}
                    </button>
                  </div>
                </div>
              )}

              {/* Véhicule trouvé — demande confirmation */}
              {vehicleState === 'found' && vehicleFound && (
                <div className="space-y-3">
                  <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
                    <p className="text-zinc-400 text-xs mb-3">Véhicule trouvé pour la plaque <span className="font-mono text-white">{plateQuery}</span> :</p>
                    <div className="flex items-start gap-3 mb-4">
                      <span className="text-2xl">🚘</span>
                      <div>
                        <p className="text-white font-bold text-lg">{vehicleFound.brand} {vehicleFound.model}</p>
                        <p className="text-zinc-400 font-mono text-sm">{vehicleFound.plate}</p>
                        {vehicleFound.vin && <p className="text-zinc-500 text-xs mt-0.5">VIN : {vehicleFound.vin}</p>}
                      </div>
                    </div>
                    <p className="text-zinc-400 text-sm font-medium mb-3">C&apos;est bien ce véhicule ?</p>
                    <div className="flex gap-2">
                      <button onClick={confirmVehicle}
                        className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-sm transition">
                        ✅ Oui, c&apos;est le bon
                      </button>
                      <button onClick={rejectVehicle}
                        className="flex-1 py-3 bg-[#2a2a2a] hover:bg-[#333] text-zinc-300 font-medium rounded-xl text-sm transition">
                        ❌ Non, autre véhicule
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Confirmé */}
              {vehicleState === 'confirmed' && vehicleFound && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 flex items-start gap-3">
                  <span className="text-green-400 text-xl">✓</span>
                  <div className="flex-1">
                    <p className="text-white font-bold">{vehicleFound.brand} {vehicleFound.model}</p>
                    <p className="text-green-400 font-mono text-sm">{vehicleFound.plate}</p>
                    {vehicleFound.vin && <p className="text-zinc-500 text-xs mt-0.5">VIN : {vehicleFound.vin}</p>}
                  </div>
                  <button onClick={() => { setVehicleState('idle'); setVehicleFound(null) }}
                    className="text-zinc-500 text-xs hover:text-white">Changer</button>
                </div>
              )}

              {/* Refusé ou pas trouvé → saisie manuelle */}
              {(vehicleState === 'rejected' || vehicleState === 'not_found') && (
                <div className="space-y-3">
                  {vehicleState === 'not_found' ? (
                    <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3 text-zinc-400 text-sm">
                      Plaque <span className="font-mono text-white">{plateQuery}</span> non connue dans notre base de données — remplis les informations manuellement.
                    </div>
                  ) : (
                    <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3 text-zinc-400 text-sm">
                      Remplis les informations du véhicule réel.
                    </div>
                  )}

                  {/* Marque */}
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Marque *</label>
                    {brands.length > 0 ? (
                      <select
                        value={manualBrandId ?? ''}
                        onChange={e => {
                          const id = parseInt(e.target.value)
                          const brand = brands.find(b => b.id === id)
                          setManualBrandId(id || null)
                          setManualBrand(brand?.name || '')
                          setManualModel('')
                        }}
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand">
                        <option value="">— Choisir une marque —</option>
                        {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    ) : (
                      <input value={manualBrand} onChange={e => setManualBrand(e.target.value)}
                        placeholder="BMW, Renault…"
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand" />
                    )}
                  </div>

                  {/* Modèle */}
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Modèle *</label>
                    {filteredModels.length > 0 ? (
                      <select
                        value={manualModel}
                        onChange={e => setManualModel(e.target.value)}
                        disabled={!manualBrandId}
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand disabled:opacity-40">
                        <option value="">— Choisir un modèle —</option>
                        {filteredModels.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                      </select>
                    ) : (
                      <input value={manualModel} onChange={e => setManualModel(e.target.value)}
                        placeholder="320d, Clio…"
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand" />
                    )}
                  </div>

                  {/* Plaque */}
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Plaque *</label>
                    <input value={manualPlate} onChange={e => setManualPlate(e.target.value.toUpperCase())}
                      placeholder="1-ABC-123"
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white font-mono text-sm uppercase focus:outline-none focus:border-brand" />
                  </div>

                  {/* VIN */}
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">
                      VIN / Châssis <span className="text-zinc-600">(souhaité)</span>
                    </label>
                    <input value={manualVin} onChange={e => setManualVin(e.target.value.toUpperCase())}
                      placeholder="WBA3A5C55DF..."
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white font-mono text-xs uppercase focus:outline-none focus:border-brand" />
                  </div>
                </div>
              )}

              {/* Note */}
              <div>
                <label className="block text-zinc-500 text-xs mb-1.5">
                  Note rapide <span className="text-zinc-600">(optionnel)</span>
                </label>
                <input value={note} onChange={e => setNote(e.target.value)}
                  placeholder="Voie rapide, conducteur seul, clés dans le véhicule…"
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand" />
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* ── Boutons fixes ────────────────────────────────────────────────── */}
        <div className="fixed bottom-0 left-0 right-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4 space-y-2">

          {step === 2 && (
            <button onClick={() => { if (address) setStep(3) }} disabled={!address}
              className="w-full py-4 bg-brand disabled:opacity-40 text-white font-bold rounded-2xl text-base transition">
              Continuer →
            </button>
          )}

          {step === 4 && (
            <>
              {canSubmit && (
                <button onClick={() => handleSubmit(false)} disabled={saving}
                  className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-bold rounded-2xl text-base transition">
                  {saving ? '⏳ Création en cours…' : '✅ Créer et démarrer'}
                </button>
              )}
              <button onClick={() => handleSubmit(true)} disabled={saving}
                className="w-full py-2.5 bg-[#1A1A1A] border border-[#2a2a2a] text-zinc-400 hover:text-white rounded-2xl text-sm transition">
                Continuer sans véhicule
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
