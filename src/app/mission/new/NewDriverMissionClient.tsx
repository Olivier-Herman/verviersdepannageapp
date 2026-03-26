'use client'
// src/app/mission/new/NewDriverMissionClient.tsx
// Formulaire mobile optimisé — création mission chauffeur en ~30 secondes
// Flow : Source → Adresse → Type → Véhicule → Créé + redirect /mission/[id]

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OdooVehicle {
  id: number; plate: string; vin: string|false
  brand: string; model: string
}

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

// ── Google Maps Autocomplete ──────────────────────────────────────────────────

function AddressInput({ value, onChange, onSelect }: {
  value: string
  onChange: (v: string) => void
  onSelect: (addr: string, lat: number, lng: number, city: string) => void
}) {
  const ref   = useRef<HTMLInputElement>(null)
  const acRef = useRef<any>(null)

  useEffect(() => {
    const init = () => {
      if (!ref.current || !(window as any).google?.maps?.places || acRef.current) return
      acRef.current = new (window as any).google.maps.places.Autocomplete(ref.current, {
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
    }
    if ((window as any).google) init()
    else {
      const t = setInterval(() => { if ((window as any).google) { init(); clearInterval(t) } }, 300)
      return () => clearInterval(t)
    }
  }, [])

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

  const [step, setStep]   = useState<1|2|3|4>(1)

  // Données du formulaire
  const [source,      setSource]      = useState('')
  const [missionType, setMissionType] = useState('')
  const [address,     setAddress]     = useState('')
  const [addrLat,     setAddrLat]     = useState<number|null>(null)
  const [addrLng,     setAddrLng]     = useState<number|null>(null)
  const [addrCity,    setAddrCity]    = useState('')

  // Véhicule
  const [plateQuery,    setPlateQuery]    = useState('')
  const [searching,     setSearching]     = useState(false)
  const [vehicleFound,  setVehicleFound]  = useState<OdooVehicle|null>(null)
  const [notFound,      setNotFound]      = useState(false)
  const [manualBrand,   setManualBrand]   = useState('')
  const [manualModel,   setManualModel]   = useState('')
  const [manualPlate,   setManualPlate]   = useState('')
  const [manualVin,     setManualVin]     = useState('')
  const [note,          setNote]          = useState('')

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // ── Recherche Odoo ───────────────────────────────────────────────────────────

  const searchVehicle = async () => {
    if (plateQuery.length < 3) return
    setSearching(true)
    setVehicleFound(null)
    setNotFound(false)
    try {
      const r = await fetch(`/api/odoo/search-vehicle?q=${encodeURIComponent(plateQuery)}`)
      const d = await r.json()
      const vehicles: OdooVehicle[] = d.vehicles || []
      if (vehicles.length > 0) {
        setVehicleFound(vehicles[0])
      } else {
        setNotFound(true)
        setManualPlate(plateQuery.toUpperCase())
      }
    } catch {
      setNotFound(true)
    } finally {
      setSearching(false)
    }
  }

  // ── Soumission ───────────────────────────────────────────────────────────────

  const handleSubmit = async (skipVehicle = false) => {
    setError('')
    setSaving(true)
    try {
      const plate = skipVehicle ? null : (vehicleFound ? vehicleFound.plate : manualPlate || null)
      const brand = skipVehicle ? null : (vehicleFound ? vehicleFound.brand  : manualBrand || null)
      const model = skipVehicle ? null : (vehicleFound ? vehicleFound.model  : manualModel || null)
      const vin   = skipVehicle ? null : (vehicleFound ? (vehicleFound.vin || null) : manualVin || null)

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

  const progress = ((step - 1) / 3) * 100

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0F0F0F] pb-32">

      {/* Header sticky */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 sticky top-0 z-20">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => step > 1 ? setStep((step - 1) as 1|2|3|4) : router.push('/mission')}
            className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg flex-shrink-0"
          >
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

        {/* ── Étape 1 : Source ──────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Qui fait appel à vous ?</p>
            <div className="grid grid-cols-2 gap-3">
              {SOURCES.map(s => (
                <button
                  key={s.value}
                  onClick={() => { setSource(s.value); setStep(2) }}
                  className={`flex flex-col items-center justify-center py-7 rounded-2xl border-2 text-white font-bold transition active:scale-95 ${
                    source === s.value ? s.color : 'bg-[#1A1A1A] border-[#2a2a2a]'
                  }`}
                >
                  <span className="text-4xl mb-2">{s.icon}</span>
                  <span className="text-base">{s.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── Étape 2 : Adresse ─────────────────────────────────────────── */}
        {step === 2 && (
          <>
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Où se trouve la panne ?</p>
            <AddressInput
              value={address}
              onChange={setAddress}
              onSelect={(addr, lat, lng, city) => {
                setAddress(addr); setAddrLat(lat); setAddrLng(lng); setAddrCity(city)
              }}
            />
            {address && addrLat && (
              <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-green-400 text-sm">
                <span>✓</span>
                <span className="truncate">{address}</span>
              </div>
            )}
          </>
        )}

        {/* ── Étape 3 : Type ────────────────────────────────────────────── */}
        {step === 3 && (
          <>
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Type d&apos;intervention</p>
            <div className="space-y-3">
              {TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => { setMissionType(t.value); setStep(4) }}
                  className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition active:scale-[0.98] ${
                    missionType === t.value ? t.color : 'bg-[#1A1A1A] border-[#2a2a2a]'
                  }`}
                >
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

        {/* ── Étape 4 : Véhicule ────────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-4">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Véhicule à prendre en charge</p>

            {/* Recherche plaque Odoo */}
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
                <button
                  onClick={searchVehicle}
                  disabled={searching || plateQuery.length < 3}
                  className="px-4 py-3.5 bg-brand disabled:opacity-40 text-white rounded-xl font-medium text-sm transition"
                >
                  {searching ? '⏳' : '🔍'}
                </button>
              </div>
            </div>

            {/* Trouvé */}
            {vehicleFound && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 flex items-start gap-3">
                <span className="text-green-400 text-xl">✓</span>
                <div>
                  <p className="text-white font-bold">{vehicleFound.brand} {vehicleFound.model}</p>
                  <p className="text-green-400 font-mono text-sm">{vehicleFound.plate}</p>
                  {vehicleFound.vin && <p className="text-zinc-500 text-xs mt-0.5">VIN : {vehicleFound.vin}</p>}
                </div>
              </div>
            )}

            {/* Pas trouvé → saisie manuelle */}
            {notFound && (
              <div className="space-y-3">
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 text-orange-300 text-sm">
                  ⚠️ Pas dans Odoo — remplis les infos manuellement
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Marque *</label>
                    <input value={manualBrand} onChange={e => setManualBrand(e.target.value)}
                      placeholder="BMW, Renault…"
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand" />
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Modèle *</label>
                    <input value={manualModel} onChange={e => setManualModel(e.target.value)}
                      placeholder="320d, Clio…"
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand" />
                  </div>
                </div>
                <div>
                  <label className="block text-zinc-500 text-xs mb-1.5">Plaque *</label>
                  <input value={manualPlate} onChange={e => setManualPlate(e.target.value.toUpperCase())}
                    placeholder="1-ABC-123"
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white font-mono text-sm uppercase focus:outline-none focus:border-brand" />
                </div>
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
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Voie rapide, conducteur seul, clés dans le véhicule…"
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand"
              />
            </div>
          </div>
        )}

        {/* Erreur */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">
            ⚠️ {error}
          </div>
        )}
      </div>

      {/* ── Boutons fixes en bas ─────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4 space-y-2">

        {/* Étape 2 : valider l'adresse */}
        {step === 2 && (
          <button
            onClick={() => { if (address) setStep(3) }}
            disabled={!address}
            className="w-full py-4 bg-brand disabled:opacity-40 text-white font-bold rounded-2xl text-base transition"
          >
            Continuer →
          </button>
        )}

        {/* Étape 4 : créer */}
        {step === 4 && (
          <>
            <button
              onClick={() => handleSubmit(false)}
              disabled={saving || (!vehicleFound && !manualPlate && !notFound)}
              className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-bold rounded-2xl text-base transition"
            >
              {saving ? '⏳ Création en cours…' : '✅ Créer et démarrer'}
            </button>
            <button
              onClick={() => handleSubmit(true)}
              disabled={saving}
              className="w-full py-2.5 bg-[#1A1A1A] border border-[#2a2a2a] text-zinc-400 hover:text-white rounded-2xl text-sm transition"
            >
              Continuer sans véhicule
            </button>
          </>
        )}
      </div>
    </div>
  )
}
