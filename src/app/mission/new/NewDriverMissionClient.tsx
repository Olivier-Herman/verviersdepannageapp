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
import ScanButton from '@/components/ScanButton'
import { T } from '@/lib/i18n/T'
import { normalizePlate } from '@/lib/plate'

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
  { value: 'prive',  label: 'Privé',   icon: '👤', color: 'border-zinc-600  bg-surface-2/40'  },
  { value: 'garage', label: 'Garage',  icon: '🔧', color: 'border-amber-700 bg-amber-900/40' },
  { value: 'autre',  label: 'Autre',   icon: '📋', color: 'border-zinc-600  bg-surface-2/40'  },
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
  // Refs pour onChange/onSelect : evite closure stale (listener cree une fois).
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect

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
      onChangeRef.current(addr)
      onSelectRef.current(addr, lat, lng, cityComp?.long_name || '')
    })
  }, [mapsReady])

  return (
    <input
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Ex: Rue de la Paix 12, Liège"
      autoFocus
      className="w-full bg-surface border border rounded-xl px-4 py-4 text-ink text-base focus:outline-none focus:border-brand placeholder:text-ink-faint"
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

  // ── GPS position actuelle ────────────────────────────────────────────────

  const handleGPS = () => {
    if (!navigator.geolocation) {
      setError('Géolocalisation non disponible sur cet appareil')
      return
    }
    setGpsLoading(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        const g = (window as any).google
        if (g?.maps) {
          new g.maps.Geocoder().geocode({ location: { lat, lng } }, (results: any[], status: string) => {
            setGpsLoading(false)
            if (status === 'OK' && results[0]) {
              const addr = results[0].formatted_address
              const cityComp = (results[0].address_components || []).find((c: any) =>
                c.types.includes('locality') || c.types.includes('postal_town')
              )
              setAddress(addr)
              setAddrLat(lat)
              setAddrLng(lng)
              setAddrCity(cityComp?.long_name || '')
            } else {
              setAddress(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)
              setAddrLat(lat); setAddrLng(lng)
            }
          })
        } else {
          setGpsLoading(false)
          setAddress(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)
          setAddrLat(lat); setAddrLng(lng)
        }
      },
      (err) => {
        setGpsLoading(false)
        setError(err.code === 1
          ? 'Accès refusé — autorise la géolocalisation dans les réglages'
          : 'Position indisponible, réessaye')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
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
        src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places&region=BE`}
        strategy="afterInteractive"
        onLoad={() => setMapsReady(true)}
        onReady={() => setMapsReady(true)}
      />

      <div className="min-h-screen bg-surface pb-32">

        {/* Header sticky */}
        <div className="bg-surface border-b border px-4 pt-12 pb-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => step > 1 ? setStep((step - 1) as 1|2|3|4) : router.push('/mission')}
              className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg flex-shrink-0">
              ←
            </button>
            <div>
              <h1 className="text-ink font-bold text-lg"><T k="mission_list.new_intervention_title" /></h1>
              <p className="text-ink-muted text-xs">Étape {step} sur 4</p>
            </div>
          </div>
          <div className="h-1 bg-surface-hover rounded-full overflow-hidden">
            <div className="h-full bg-brand rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="px-4 mt-6 space-y-4">

          {/* ── Étape 1 : Source ────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <p className="text-ink-secondary text-xs font-semibold uppercase tracking-widest">Qui fait appel à vous ?</p>
              <div className="grid grid-cols-2 gap-3">
                {SOURCES.map(s => (
                  <button key={s.value}
                    onClick={() => { setSource(s.value); setStep(2) }}
                    className={`flex flex-col items-center justify-center py-7 rounded-2xl border-2 text-ink font-bold transition active:scale-95 ${
                      source === s.value ? s.color : 'bg-surface border'
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
              <p className="text-ink-secondary text-xs font-semibold uppercase tracking-widest">Où se trouve la panne ?</p>

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
                <div className="flex-1 h-px bg-surface-hover" />
                <span className="text-ink-faint text-xs">ou saisir manuellement</span>
                <div className="flex-1 h-px bg-surface-hover" />
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
                <p className="text-ink-faint text-xs">⏳ Chargement de la recherche d&apos;adresse…</p>
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
              <p className="text-ink-secondary text-xs font-semibold uppercase tracking-widest">Type d&apos;intervention</p>
              <div className="space-y-3">
                {TYPES.map(t => (
                  <button key={t.value}
                    onClick={() => { setMissionType(t.value); setStep(4) }}
                    className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition active:scale-[0.98] ${
                      missionType === t.value ? t.color : 'bg-surface border'
                    }`}>
                    <div className="flex-1">
                      <p className="text-ink font-bold text-xl">{t.label}</p>
                      <p className="text-ink-secondary text-sm">{t.sub}</p>
                    </div>
                    <span className="text-ink-faint text-2xl">→</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Étape 4 : Véhicule ──────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-ink-secondary text-xs font-semibold uppercase tracking-widest">Véhicule à prendre en charge</p>

              {/* Recherche plaque */}
              {vehicleState === 'idle' && (
                <div>
                  <label className="block text-ink text-sm font-medium mb-2">Recherche par plaque</label>
                  <div className="flex gap-2">
                    <input
                      value={plateQuery}
                      onChange={e => setPlateQuery(normalizePlate(e.target.value))}
                      onKeyDown={e => e.key === 'Enter' && searchVehicle()}
                      placeholder="Ex: 1-ABC-123"
                      className="flex-1 bg-surface border border rounded-xl px-4 py-3.5 text-ink font-mono text-base uppercase focus:outline-none focus:border-brand placeholder:text-ink-faint placeholder:normal-case"
                    />
                    <ScanButton mode="plate" value={plateQuery} onScan={t => setPlateQuery(normalizePlate(t))}
                      className="px-4 py-3.5 bg-brand/10 text-brand rounded-xl font-medium text-sm" label="📷" />
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
                  <div className="bg-surface border border rounded-2xl p-4">
                    <p className="text-ink-secondary text-xs mb-3">Véhicule trouvé pour la plaque <span className="font-mono text-ink">{plateQuery}</span> :</p>
                    <div className="flex items-start gap-3 mb-4">
                      <span className="text-2xl">🚘</span>
                      <div>
                        <p className="text-ink font-bold text-lg">{vehicleFound.brand} {vehicleFound.model}</p>
                        <p className="text-ink-secondary font-mono text-sm">{vehicleFound.plate}</p>
                        {vehicleFound.vin && <p className="text-ink-muted text-xs mt-0.5">VIN : {vehicleFound.vin}</p>}
                      </div>
                    </div>
                    <p className="text-ink-secondary text-sm font-medium mb-3">C&apos;est bien ce véhicule ?</p>
                    <div className="flex gap-2">
                      <button onClick={confirmVehicle}
                        className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-ink font-bold rounded-xl text-sm transition">
                        ✅ Oui, c&apos;est le bon
                      </button>
                      <button onClick={rejectVehicle}
                        className="flex-1 py-3 bg-surface-hover hover:bg-surface-2 text-ink-secondary font-medium rounded-xl text-sm transition">
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
                    <p className="text-ink font-bold">{vehicleFound.brand} {vehicleFound.model}</p>
                    <p className="text-green-400 font-mono text-sm">{vehicleFound.plate}</p>
                    {vehicleFound.vin && <p className="text-ink-muted text-xs mt-0.5">VIN : {vehicleFound.vin}</p>}
                  </div>
                  <button onClick={() => { setVehicleState('idle'); setVehicleFound(null) }}
                    className="text-ink-muted text-xs hover:text-ink">Changer</button>
                </div>
              )}

              {/* Refusé ou pas trouvé → saisie manuelle */}
              {(vehicleState === 'rejected' || vehicleState === 'not_found') && (
                <div className="space-y-3">
                  {vehicleState === 'not_found' ? (
                    <div className="bg-surface border border rounded-xl px-4 py-3 text-ink-secondary text-sm">
                      Plaque <span className="font-mono text-ink">{plateQuery}</span> non connue dans notre base de données — remplis les informations manuellement.
                    </div>
                  ) : (
                    <div className="bg-surface border border rounded-xl px-4 py-3 text-ink-secondary text-sm">
                      Remplis les informations du véhicule réel.
                    </div>
                  )}

                  {/* Marque */}
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Marque *</label>
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
                        className="w-full bg-surface border border rounded-xl px-3 py-3 text-ink text-sm focus:outline-none focus:border-brand">
                        <option value="">— Choisir une marque —</option>
                        {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    ) : (
                      <input value={manualBrand} onChange={e => setManualBrand(e.target.value)}
                        placeholder="BMW, Renault…"
                        className="w-full bg-surface border border rounded-xl px-3 py-3 text-ink text-sm focus:outline-none focus:border-brand" />
                    )}
                  </div>

                  {/* Modèle */}
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Modèle *</label>
                    {filteredModels.length > 0 ? (
                      <select
                        value={manualModel}
                        onChange={e => setManualModel(e.target.value)}
                        disabled={!manualBrandId}
                        className="w-full bg-surface border border rounded-xl px-3 py-3 text-ink text-sm focus:outline-none focus:border-brand disabled:opacity-40">
                        <option value="">— Choisir un modèle —</option>
                        {filteredModels.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                      </select>
                    ) : (
                      <input value={manualModel} onChange={e => setManualModel(e.target.value)}
                        placeholder="320d, Clio…"
                        className="w-full bg-surface border border rounded-xl px-3 py-3 text-ink text-sm focus:outline-none focus:border-brand" />
                    )}
                  </div>

                  {/* Plaque */}
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Plaque *</label>
                    <div className="flex gap-1.5">
                      <input value={manualPlate} onChange={e => setManualPlate(e.target.value.toUpperCase())}
                        placeholder="1-ABC-123"
                        className="flex-1 bg-surface border border rounded-xl px-3 py-3 text-ink font-mono text-sm uppercase focus:outline-none focus:border-brand" />
                      <ScanButton mode="plate" value={manualPlate} onScan={setManualPlate}
                        className="px-3 bg-brand/10 text-brand rounded-xl text-sm flex items-center" label="📷" />
                    </div>
                  </div>

                  {/* VIN */}
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">
                      VIN / Châssis <span className="text-ink-faint">(souhaité)</span>
                    </label>
                    <div className="flex gap-1.5">
                      <input value={manualVin} onChange={e => setManualVin(e.target.value.toUpperCase())}
                        placeholder="WBA3A5C55DF..."
                        className="flex-1 bg-surface border border rounded-xl px-3 py-3 text-ink font-mono text-xs uppercase focus:outline-none focus:border-brand" />
                      <ScanButton mode="vin" value={manualVin} onScan={setManualVin}
                        className="px-3 bg-brand/10 text-brand rounded-xl text-sm flex items-center" label="📷" />
                    </div>
                  </div>
                </div>
              )}

              {/* Note */}
              <div>
                <label className="block text-ink-muted text-xs mb-1.5">
                  Note rapide <span className="text-ink-faint">(optionnel)</span>
                </label>
                <input value={note} onChange={e => setNote(e.target.value)}
                  placeholder="Voie rapide, conducteur seul, clés dans le véhicule…"
                  className="w-full bg-surface border border rounded-xl px-3 py-3 text-ink text-sm focus:outline-none focus:border-brand" />
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
        <div className="fixed bottom-0 left-0 right-0 bg-surface/95 border-t border px-4 py-4 space-y-2">

          {step === 2 && (
            <button onClick={() => { if (address) setStep(3) }} disabled={!address}
              className="w-full py-4 bg-brand disabled:opacity-40 text-white font-bold rounded-2xl text-base transition">
              <T k="encaissement.btn_continue" /> →
            </button>
          )}

          {step === 4 && (
            <>
              {canSubmit && (
                <button onClick={() => handleSubmit(false)} disabled={saving}
                  className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-ink font-bold rounded-2xl text-base transition">
                  {saving ? '⏳ Création en cours…' : <>✅ <T k="create_mission.create_mission_btn" /></>}
                </button>
              )}
              <button onClick={() => handleSubmit(true)} disabled={saving}
                className="w-full py-2.5 bg-surface border border text-ink-secondary hover:text-ink rounded-2xl text-sm transition">
                Continuer sans véhicule
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
