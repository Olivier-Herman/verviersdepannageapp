'use client'
// src/app/mission/police/PoliceClient.tsx

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import VehiclePlateLookup from '@/components/vehicles/VehiclePlateLookup'
import ScanButton from '@/components/ScanButton'
import type { VehicleMatch } from '@/types/vehicles'

type MissionType = 'accident' | 'saisie' | 'rodeo' | 'mal_garee' | 'snc' | 'appel_prive' | 'avp'

const TYPE_CONFIG: Record<MissionType, { label: string; icon: string; color: string; colorLight: string; hidePolice?: boolean; hideOwner?: boolean }> = {
  accident:    { label: 'Police Accident',    icon: '🚨', color: 'bg-red-600',    colorLight: 'bg-red-50 border-red-200' },
  saisie:      { label: 'Saisie',             icon: '⚖️', color: 'bg-purple-600', colorLight: 'bg-purple-50 border-purple-200' },
  rodeo:       { label: 'Rodéo',              icon: '🏎️', color: 'bg-rose-600',   colorLight: 'bg-rose-50 border-rose-200' },
  mal_garee:   { label: 'Mal Garée',          icon: '🚫', color: 'bg-amber-600',  colorLight: 'bg-amber-50 border-amber-200' },
  snc:         { label: 'Siabis Non Couvert', icon: '🛣️', color: 'bg-blue-600',   colorLight: 'bg-blue-50 border-blue-200' },
  appel_prive: { label: 'Appel Privé',        icon: '📞', color: 'bg-green-800',  colorLight: 'bg-green-50 border-green-200', hidePolice: true },
  avp:         { label: 'AVP',                icon: '🔲', color: 'bg-black',     colorLight: 'bg-gray-50 border-gray-200',  hidePolice: true, hideOwner: true },
}

const POLICE_ZONES = ['Police Zone Vesdre', 'Police Zone Fagnes']

function nowFormatted() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

// ── Input light ────────────────────────────────────────────────────────────
function LInput({ label, value, onChange, placeholder, type = 'text', required }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; required?: boolean
}) {
  return (
    <div>
      <label className="block text-ink-secondary text-xs font-medium mb-1">{label}{required && <span className="text-critical ml-0.5">*</span>}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-surface border border-strong rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft" />
    </div>
  )
}

function LSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <div>
      <label className="block text-ink-secondary text-xs font-medium mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-surface border border-strong rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-blue-500">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border rounded-2xl p-4 shadow-sm space-y-3">
      <p className="text-ink-faint text-xs uppercase tracking-widest font-semibold">{title}</p>
      {children}
    </div>
  )
}

export default function PoliceClient({ userRole = 'driver' }: { userRole?: string }) {
  const isSuperAdmin = userRole === 'superadmin'
  const router = useRouter()
  const [selectedType, setSelectedType] = useState<MissionType | null>(null)
  const { date: initDate, time: initTime } = nowFormatted()

  const [date,           setDate]           = useState(initDate)
  const [time,           setTime]           = useState(initTime)
  const [plate,          setPlate]          = useState('')
  const [vin,            setVin]            = useState('')
  const [brand,          setBrand]          = useState('')
  const [model,          setModel]          = useState('')
  const [location,       setLocation]       = useState('')
  const [policeZone,     setPoliceZone]     = useState(POLICE_ZONES[0])
  const [officerName,    setOfficerName]    = useState('')
  const [ownerFirstName, setOwnerFirstName] = useState('')
  const [ownerLastName,  setOwnerLastName]  = useState('')
  const [ownerPhone,     setOwnerPhone]     = useState('')
  const [remarks,        setRemarks]        = useState('')
  const [policeBlocked,  setPoliceBlocked]  = useState(false)
  // Rodeo : toggle obligatoire "Levee de saisie validee" + photo doc optionnelle
  const [leveeSaisieOk,    setLeveeSaisieOk]    = useState(false)
  const [leveeSaisiePhoto, setLeveeSaisiePhoto] = useState<File | null>(null)
  const [leveeSaisiePreview, setLeveeSaisiePreview] = useState<string>('')
  // SNC (Siabis Non Couvert) : balisage + scenario d intervention
  const [sncRequiresBalisage, setSncRequiresBalisage] = useState(false)
  const [sncScenario, setSncScenario] = useState<'dsp' | 'rem_client' | 'rem_depot' | ''>('')
  // Coordonnees GPS de l intervention (capturees via Google Autocomplete) — necessaires
  // pour le preview tarif SNC qui utilise Google Distance Matrix.
  const [locationLat, setLocationLat] = useState<number | null>(null)
  const [locationLng, setLocationLng] = useState<number | null>(null)
  // Destination (pour REM client = obligatoire, REM depot = optionnel pour relivraison future)
  const [destination,     setDestination]     = useState('')
  const [destinationLat,  setDestinationLat]  = useState<number | null>(null)
  const [destinationLng,  setDestinationLng]  = useState<number | null>(null)
  // Preview tarif SNC en live (resultat de /api/snc-preview-tarif)
  const [sncPreview, setSncPreview] = useState<any>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [photos,         setPhotos]         = useState<File[]>([])
  const [previews,       setPreviews]       = useState<string[]>([])
  const [loading,        setLoading]        = useState(false)
  const [err,            setErr]            = useState('')
  const [done,           setDone]           = useState(false)

  // Brands/Models from Odoo
  const [brands,          setBrands]          = useState<{id:number;name:string}[]>([])
  const [models,          setModels]          = useState<{id:number;name:string}[]>([])
  const [selectedBrandId, setSelectedBrandId] = useState<number|null>(null)
  const [loadingBrands,   setLoadingBrands]   = useState(false)
  const [showBrands,      setShowBrands]      = useState(false)
  const [showModels,      setShowModels]      = useState(false)
  const [brandSearch,     setBrandSearch]     = useState('')
  const [modelSearch,     setModelSearch]     = useState('')

  // Lookup véhicule Odoo par plaque (Phase 1 multi-match via composant partagé)
  const [vehicleFromOdoo, setVehicleFromOdoo] = useState(false)
  const [showLookup,      setShowLookup]      = useState(false)

  /** Trigger onBlur du champ plaque : ouvre la modal lookup. */
  const searchVehicleByPlate = () => {
    const trimmed = plate.trim()
    if (trimmed.length < 4) return
    setShowLookup(true)
  }

  /** Callback : un véhicule existant a été choisi (skip auto si 1 seul). */
  const handleVehicleSelect = (v: VehicleMatch) => {
    if (v.brand) setBrand(v.brand)
    if (v.model) setModel(v.model)
    if (v.vin)   setVin(v.vin)
    setVehicleFromOdoo(true)
    setShowLookup(false)
  }

  /** Callback : "Aucun de ceux-là, créer nouveau" → reset flag + ferme. */
  const handleCreateNewVehicle = () => {
    setShowLookup(false)
    setVehicleFromOdoo(false)
  }

  const locationRef = useRef<HTMLInputElement>(null)
  const destinationRef = useRef<HTMLInputElement>(null)
  const photoRef    = useRef<HTMLInputElement>(null)
  const acRef       = useRef<any>(null)
  const destAcRef   = useRef<any>(null)

  // Load brands on mount
  useEffect(() => {
    setLoadingBrands(true)
    fetch('/api/vehicles?type=brands')
      .then(r => r.json())
      .then(d => setBrands(d || []))
      .finally(() => setLoadingBrands(false))
  }, [])

  // Load models when brand changes
  useEffect(() => {
    if (!selectedBrandId) { setModels([]); return }
    fetch(`/api/vehicles?type=models&brandId=${selectedBrandId}`)
      .then(r => r.json())
      .then(d => setModels(d || []))
  }, [selectedBrandId])

  // Google Maps autocomplete — réinitialiser quand le formulaire apparaît
  useEffect(() => {
    if (!selectedType) return
    acRef.current = null // Reset pour forcer la réinit
    const init = () => {
      if (!window.google?.maps?.places || !locationRef.current) return
      acRef.current = new window.google.maps.places.Autocomplete(locationRef.current, {
        types: ['address'],
        componentRestrictions: { country: ['be', 'lu', 'nl', 'de', 'fr'] },
      })
      acRef.current.addListener('place_changed', () => {
        const place = acRef.current.getPlace()
        if (place?.formatted_address) setLocation(place.formatted_address)
        // Capture lat/lng pour le preview tarif SNC (Google Distance Matrix)
        if (place?.geometry?.location) {
          setLocationLat(place.geometry.location.lat())
          setLocationLng(place.geometry.location.lng())
        }
      })
    }
    if (window.google?.maps?.places) {
      init()
    } else {
      const existing = document.getElementById('gmaps-script')
      if (!existing) {
        const script = document.createElement('script')
        script.id = 'gmaps-script'
        script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`
        script.async = true
        script.onload = init
        document.head.appendChild(script)
      } else {
        if (window.google?.maps?.places) init()
        else existing.addEventListener('load', init)
      }
    }
  }, [selectedType])

  // ──────────── Autocomplete destination (SNC rem_client / rem_depot) ────────────
  // Initialise une seule fois quand le champ est rendu (= scenario SNC choisi).
  // Reset destAcRef quand le scenario change pour eviter de pointer vers un input demonté.
  useEffect(() => {
    destAcRef.current = null  // reset au changement de scenario
    if (selectedType !== 'snc') return
    if (sncScenario !== 'rem_client' && sncScenario !== 'rem_depot') return

    const init = () => {
      if (!window.google?.maps?.places || !destinationRef.current) return
      if (destAcRef.current) return  // deja init
      destAcRef.current = new window.google.maps.places.Autocomplete(destinationRef.current, {
        types: ['address'],
        componentRestrictions: { country: ['be', 'lu', 'nl', 'de', 'fr'] },
      })
      destAcRef.current.addListener('place_changed', () => {
        const place = destAcRef.current.getPlace()
        if (place?.formatted_address) setDestination(place.formatted_address)
        if (place?.geometry?.location) {
          setDestinationLat(place.geometry.location.lat())
          setDestinationLng(place.geometry.location.lng())
        }
      })
    }
    if (window.google?.maps?.places) {
      // Petit delai pour s assurer que le champ est rendu dans le DOM
      setTimeout(init, 100)
    } else {
      // Script Google deja chargé pour location, juste attendre
      setTimeout(init, 500)
    }
  }, [selectedType, sncScenario])

  // ──────────── Preview tarif SNC en live ────────────
  // Quand SNC + scenario + coords sont presents, debounce et appel
  // /api/snc-preview-tarif pour afficher au chauffeur le montant a encaisser
  // (DSP / REM client) ou a transmettre au client (REM depot).
  useEffect(() => {
    if (selectedType !== 'snc' || !sncScenario || locationLat == null || locationLng == null) {
      setSncPreview(null); setPreviewError(null)
      return
    }
    // REM client : destination obligatoire pour calcul
    if (sncScenario === 'rem_client' && (destinationLat == null || destinationLng == null)) {
      setSncPreview(null); setPreviewError(null)
      return
    }

    const ctrl = new AbortController()
    const handler = setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError(null)
      try {
        // Construit intervention_at depuis date+time saisis
        const [dd, mm, yyyy] = (date || '').split('-')
        const [hh, mn] = (time || '00:00').split(':')
        const interventionAt = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mn}:00`).toISOString()
        const res = await fetch('/api/snc-preview-tarif', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            scenario:          sncScenario,
            requires_balisage: sncRequiresBalisage,
            incident_lat:      locationLat,
            incident_lng:      locationLng,
            destination_lat:   destinationLat,
            destination_lng:   destinationLng,
            intervention_at:   interventionAt,
          }),
          signal: ctrl.signal,
        })
        const j = await res.json()
        if (!res.ok || !j.ok) {
          setSncPreview(null)
          setPreviewError(j.error || 'Erreur calcul')
        } else {
          setSncPreview(j)
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setSncPreview(null)
          setPreviewError(e.message || 'Erreur reseau')
        }
      } finally {
        setPreviewLoading(false)
      }
    }, 600)
    return () => { clearTimeout(handler); ctrl.abort() }
  }, [selectedType, sncScenario, sncRequiresBalisage, locationLat, locationLng, destinationLat, destinationLng, date, time])

  const getGPS = useCallback(() => {
    if (!navigator.geolocation) {
      alert('Géolocalisation non disponible')
      return
    }
    navigator.geolocation.getCurrentPosition(
      async pos => {
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
      },
      err => {
        console.error('GPS error:', err.code, err.message)
        alert('Impossible d\'obtenir votre position')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  const compressPhoto = (file: File): Promise<{ blob: Blob; preview: string }> => {
    return new Promise(resolve => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        const MAX = 1200
        let w = img.width, h = img.height
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX }
          else       { w = Math.round(w * MAX / h); h = MAX }
        }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        canvas.toBlob(blob => {
          const preview = canvas.toDataURL('image/jpeg', 0.8)
          URL.revokeObjectURL(url)
          resolve({ blob: blob!, preview })
        }, 'image/jpeg', 0.8)
      }
      img.src = url
    })
  }

  const addPhotos = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(async f => {
      const { blob, preview } = await compressPhoto(f)
      const compressed = new File([blob], f.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
      setPhotos(p => [...p, compressed])
      setPreviews(p => [...p, preview])
    })
  }

  const filteredBrands = brands.filter(b => b.name.toLowerCase().includes(brandSearch.toLowerCase()))
  const filteredModels = models.filter(m => m.name.toLowerCase().includes(modelSearch.toLowerCase()))

  const handleSubmit = async () => {
    if (!selectedType) return
    if (!location.trim()) { setErr('Le lieu d\'intervention est requis'); return }
    if (!plate && !vin)   { setErr('Plaque ou VIN requis'); return }
    if (!brand)           { setErr('La marque du véhicule est requise'); return }
    if (!model)           { setErr('Le modèle du véhicule est requis'); return }
    // Si plaque vide, utiliser le VIN
    const finalPlate = plate.trim() || vin.trim()

    setLoading(true); setErr('')

    // Upload photos vers Supabase
    let photoUrls: string[] = []
    if (photos.length > 0) {
      try {
        const fd = new FormData()
        fd.append('mission_id', `police-${Date.now()}`)
        photos.forEach(f => fd.append('files', f))
        const upRes = await fetch('/api/missions/photos-upload', { method: 'POST', body: fd })
        if (upRes.ok) {
          const upData = await upRes.json()
          photoUrls = upData.urls || []
        }
      } catch (e) { console.error('Upload photos:', e) }
    }

    // Upload photo levee de saisie (Rodeo) si fournie
    let leveeSaisieDocUrl: string | null = null
    if (selectedType === 'rodeo' && leveeSaisiePhoto) {
      try {
        const fd = new FormData()
        fd.append('mission_id', `rodeo-levee-${Date.now()}`)
        fd.append('files', leveeSaisiePhoto)
        const upRes = await fetch('/api/missions/photos-upload', { method: 'POST', body: fd })
        if (upRes.ok) {
          const upData = await upRes.json()
          leveeSaisieDocUrl = (upData.urls && upData.urls[0]) || null
        }
      } catch (e) { console.error('Upload levee:', e) }
    }

    const res = await fetch('/api/towsoft/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: selectedType, date, time, plate: finalPlate, vin, brand, model,
        location, policeZone, officerName,
        ownerFirstName, ownerLastName, ownerPhone,
        remarks, photoUrls,
        policeBlocked,
        policeLeveeSaisieOk:     leveeSaisieOk,
        policeLeveeSaisieDocUrl: leveeSaisieDocUrl,
        sncRequiresBalisage,
        sncScenario:             sncScenario || null,
        // Coordonnees GPS (depuis autocomplete) pour SNC + calcul tarif futur
        incidentLat:             locationLat,
        incidentLng:             locationLng,
        destination,
        destinationLat,
        destinationLng,
      }),
    })

    const data = await res.json()
    setLoading(false)

    if (data.ok) {
      setDone(true)
      setTimeout(() => router.push('/dashboard'), 2000)
    } else {
      setErr(data.error || 'Erreur création')
    }
  }

  const cfg = selectedType ? TYPE_CONFIG[selectedType] : null

  // ── Écran succès ──────────────────────────────────────────────────────────
  if (done) return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center px-4">
      <div className="bg-surface rounded-3xl shadow-lg p-10 text-center max-w-sm w-full">
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-ink text-2xl font-bold mb-2">Mission créée</h1>
        <p className="text-ink-muted text-sm">Email envoyé — TowSoft en cours de mise à jour</p>
        <div className="mt-6 w-full bg-surface-hover rounded-full h-1">
          <div className="bg-green-500 h-1 rounded-full animate-[width_2s_ease-in-out]" style={{width:'100%',transition:'width 2s'}} />
        </div>
      </div>
    </div>
  )

  // ── Écran sélection type ──────────────────────────────────────────────────
  if (!selectedType) return (
    <div className="min-h-screen bg-page px-4 pt-12 pb-8">
      <button onClick={() => router.push('/dashboard')} className="mb-6 text-ink-muted text-sm flex items-center gap-1">
        ← Retour
      </button>
      <h1 className="text-ink text-2xl font-bold mb-1">Créer une mission</h1>
      <p className="text-ink-muted text-sm mb-8">Sélectionne le type d&apos;intervention</p>
      <div className="space-y-3">
        {(Object.entries(TYPE_CONFIG) as [MissionType, typeof TYPE_CONFIG[MissionType]][]).map(([type, conf]) => (
          <button key={type} onClick={() => setSelectedType(type)}
            className={`w-full flex items-center gap-4 p-5 ${conf.color} rounded-2xl text-left active:scale-[0.98] transition shadow-md`}>
            <span className="text-3xl">{conf.icon}</span>
            <span className="text-white font-bold text-lg">{conf.label}</span>
            <span className="ml-auto text-white/70 text-xl">›</span>
          </button>
        ))}
      </div>
    </div>
  )

  // ── Formulaire ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-page pb-32">
      {/* Header */}
      <div className={`${cfg!.color} px-4 pt-12 pb-5 shadow-md`}>
        <button onClick={() => setSelectedType(null)} className="mb-3 text-white/80 text-sm">← Changer de type</button>
        <h1 className="text-white text-xl font-bold">{cfg!.icon} {cfg!.label}</h1>
      </div>

      <div className="px-4 py-5 space-y-4">

        {/* Date/Heure */}
        <Section title="Date & Heure">
          <div className="grid grid-cols-2 gap-3">
            <LInput label="Date" value={date} onChange={setDate} placeholder="DD-MM-YYYY" />
            <LInput label="Heure" value={time} onChange={setTime} placeholder="HH:MM" />
          </div>
        </Section>

        {/* Véhicule */}
        <Section title="Véhicule">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-ink-secondary text-xs font-medium mb-1">
                Plaque<span className="text-critical ml-0.5">*</span>
              </label>
              <div className="flex gap-1.5">
                <input type="text" value={plate}
                  onChange={e => {
                    setPlate(e.target.value.toUpperCase())
                    if (vehicleFromOdoo) setVehicleFromOdoo(false)
                  }}
                  onBlur={searchVehicleByPlate}
                  placeholder="1ABC234"
                  className="flex-1 bg-surface border border-strong rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft" />
                <ScanButton mode="plate" value={plate} onScan={text => { setPlate(text); if (vehicleFromOdoo) setVehicleFromOdoo(false) }}
                  className="px-2.5 bg-brand/10 text-brand rounded-xl text-sm flex items-center" label="📷" />
              </div>
            </div>
            <div>
              <label className="block text-ink-secondary text-xs font-medium mb-1">VIN</label>
              <div className="flex gap-1.5">
                <input value={vin} onChange={e => setVin(e.target.value.toUpperCase())} placeholder="Optionnel"
                  className="flex-1 bg-surface border border-strong rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft" />
                <ScanButton mode="vin" value={vin} onScan={setVin}
                  className="px-2.5 bg-brand/10 text-brand rounded-xl text-sm flex items-center" label="📷" />
              </div>
            </div>
          </div>

          {/* Marque */}
          <div>
            <label className="block text-ink-secondary text-xs font-medium mb-1">Marque</label>
            <button onClick={() => { setShowBrands(true); setBrandSearch('') }}
              className="w-full bg-surface border border-strong rounded-xl px-3 py-2.5 text-left text-sm text-ink flex items-center justify-between">
              <span className={brand ? 'text-ink' : 'text-ink-faint'}>{brand || 'Sélectionner une marque'}</span>
              <span className="text-ink-faint">▼</span>
            </button>
          </div>

          {/* Modèle */}
          {brand && (
            <div>
              <label className="block text-ink-secondary text-xs font-medium mb-1">Modèle</label>
              <button onClick={() => { setShowModels(true); setModelSearch('') }}
                className="w-full bg-surface border border-strong rounded-xl px-3 py-2.5 text-left text-sm text-ink flex items-center justify-between">
                <span className={model ? 'text-ink' : 'text-ink-faint'}>{model || 'Sélectionner un modèle'}</span>
                <span className="text-ink-faint">▼</span>
              </button>
            </div>
          )}

          {vehicleFromOdoo && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 text-orange-800 text-xs leading-relaxed">
              ✓ Véhicule existant Odoo utilisé. Modifier marque/modèle ne créera pas de doublon — la plaque pointe déjà sur cette fiche.
            </div>
          )}
        </Section>

        {/* Intervention */}
        <Section title="Intervention">
          <div>
            <label className="block text-ink-secondary text-xs font-medium mb-1">Lieu d&apos;intervention <span className="text-critical">*</span></label>
            <div className="flex gap-2">
              <input ref={locationRef} value={location} onChange={e => setLocation(e.target.value)}
                placeholder="Rue, autoroute..."
                className="flex-1 bg-surface border border-strong rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-blue-500" />
              <button onClick={getGPS}
                className="px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-600 text-sm font-medium">
                🎯
              </button>
            </div>
          </div>
          {!cfg!.hidePolice && <LSelect label="Zone de police" value={policeZone} onChange={setPoliceZone} options={POLICE_ZONES} />}
          {!cfg!.hidePolice && <LInput label="Nom du policier" value={officerName} onChange={setOfficerName} />}
        </Section>

        {/* Propriétaire */}
        {!cfg!.hideOwner && <Section title="Propriétaire (optionnel)">
          <div className="grid grid-cols-2 gap-3">
            <LInput label="Prénom" value={ownerFirstName} onChange={setOwnerFirstName} />
            <LInput label="Nom" value={ownerLastName} onChange={setOwnerLastName} />
          </div>
          <LInput label="Téléphone" value={ownerPhone} onChange={setOwnerPhone} type="tel" />
        </Section>}

        {/* Remarques */}
        <Section title="Remarques">
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={3}
            placeholder="Observations..."
            className="w-full bg-surface border border-strong rounded-xl px-3 py-3 text-ink text-sm outline-none resize-none focus:border-blue-500" />
        </Section>

        {/* Blocage Police : toggle visible pour les Mal Garees (et plus tard les autres
            types fourriere). Si actif, la restitution exigera une confirmation que le
            proprietaire est bien passe au commissariat. */}
        {(selectedType === 'mal_garee') && (
          <Section title="🚓 Blocage police">
            <label className="flex items-start gap-3 cursor-pointer p-3 bg-surface border border-strong rounded-xl hover:border-blue-500 transition">
              <input
                type="checkbox"
                checked={policeBlocked}
                onChange={e => setPoliceBlocked(e.target.checked)}
                className="mt-1 w-5 h-5"
              />
              <div className="flex-1">
                <div className="text-ink text-sm font-medium">
                  Le policier exige que le propriétaire passe au commissariat avant restitution
                </div>
                <div className="text-ink-muted text-xs mt-1">
                  Active ce toggle si le policier sur place le demande (souvent pour les véhicules étrangers, parfois pour les belges). À la restitution, on demandera confirmation que le propriétaire s&apos;est bien présenté à la police.
                </div>
              </div>
            </label>
          </Section>
        )}

        {/* SNC (Siabis Non Couvert) : scenario d intervention + toggle balisage */}
        {(selectedType === 'snc') && (
          <Section title="🛣️ Détails SNC">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-ink-secondary mb-1.5 block">
                  Scénario d&apos;intervention
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {([
                    { key: 'dsp',        label: '🔧 DSP — Dépannage sur place',          desc: 'Réparation sur autoroute, client paie en direct au chauffeur.' },
                    { key: 'rem_client', label: '🚛 REM avec paiement immédiat',          desc: 'Remorquage vers destination du client, paiement immédiat.' },
                    { key: 'rem_depot',  label: '🏢 REM vers dépôt Pepinster',            desc: 'Mise en zone Transit, le client passera au bureau ensuite.' },
                  ] as const).map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setSncScenario(opt.key)}
                      className={`p-3 rounded-xl border text-left transition ${
                        sncScenario === opt.key
                          ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-200'
                          : 'bg-surface border-strong hover:border-blue-300'
                      }`}
                    >
                      <div className="text-ink font-medium text-sm">{opt.label}</div>
                      <div className="text-ink-muted text-xs mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer p-3 bg-surface border border-strong rounded-xl hover:border-blue-500 transition">
                <input
                  type="checkbox"
                  checked={sncRequiresBalisage}
                  onChange={e => setSncRequiresBalisage(e.target.checked)}
                  className="mt-1 w-5 h-5"
                />
                <div className="flex-1">
                  <div className="text-ink text-sm font-medium">
                    Intervention avec balisage (véhicule de sécurité)
                  </div>
                  <div className="text-ink-muted text-xs mt-1">
                    Active si un véhicule de sécurité a dû être placé avant l&apos;incident. Génère un supplément SIABAL à la facturation (150 € HTVA normal / 175,21 € HTVA majoré).
                  </div>
                </div>
              </label>

              {/* Champ destination (visible si rem_client = obligatoire, rem_depot = optionnel) */}
              {(sncScenario === 'rem_client' || sncScenario === 'rem_depot') && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-ink-secondary block">
                    {sncScenario === 'rem_client'
                      ? 'Adresse de destination (livraison) *'
                      : 'Adresse de relivraison future (optionnelle)'}
                  </label>
                  <input
                    ref={destinationRef}
                    value={destination}
                    onChange={e => {
                      setDestination(e.target.value)
                      // Si l user efface ou modifie sans selectionner -> clear coords
                      if (destinationLat != null) { setDestinationLat(null); setDestinationLng(null) }
                    }}
                    placeholder={sncScenario === 'rem_client'
                      ? 'Ex: Rue de la Gare 10, 4800 Verviers'
                      : 'Si déjà connue (optionnel)'}
                    className="w-full bg-surface border border-strong rounded-xl px-3 py-3 text-ink text-sm outline-none focus:border-blue-500"
                  />
                  {sncScenario === 'rem_client' && destinationLat == null && destination.trim() && (
                    <p className="text-xs text-warning">⚠ Sélectionne la destination dans les suggestions Google pour calculer le tarif.</p>
                  )}
                </div>
              )}

              {/* Preview tarif live : visible si tous les params requis sont remplis */}
              {sncScenario && locationLat != null && locationLng != null &&
                (sncScenario !== 'rem_client' || (destinationLat != null && destinationLng != null)) && (
                <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-bold text-blue-900">💰 Tarif estimé</div>
                    {previewLoading && <Loader2 size={14} className="animate-spin text-blue-600" />}
                  </div>
                  {previewError && (
                    <div className="text-xs text-red-700">{previewError}</div>
                  )}
                  {sncPreview && sncPreview.ok && (
                    <>
                      <div className="space-y-1 text-xs">
                        {sncPreview.lines.map((l: any, i: number) => (
                          <div key={i} className="flex justify-between text-blue-900">
                            <span className="truncate flex-1">{l.name}</span>
                            <span className="font-mono ml-2 flex-shrink-0">
                              {l.qty} × {l.price_unit.toFixed(4)} = <strong>{(l.qty * l.price_unit).toFixed(2)} €</strong>
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-blue-300 pt-2 space-y-0.5 text-xs">
                        <div className="flex justify-between text-blue-700">
                          <span>Total HTVA</span>
                          <span className="font-mono">{sncPreview.total_htva.toFixed(2)} €</span>
                        </div>
                        <div className="flex justify-between font-bold text-blue-900 text-sm">
                          <span>Total TVAC à encaisser</span>
                          <span className="font-mono">{sncPreview.total_tvac.toFixed(2)} €</span>
                        </div>
                      </div>
                      {sncPreview.metrics?.is_majored && (
                        <div className="text-xs text-orange-700 font-medium">⏰ Plage horaire majorée appliquée</div>
                      )}
                      <div className="text-[10px] text-blue-700 italic">{sncPreview.metrics?.note}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Levee de saisie : visible pour Rodeos. Toggle obligatoire pour pouvoir
            restituer le vehicule. Photo du document optionnelle. */}
        {(selectedType === 'rodeo') && (
          <Section title="📋 Levée de saisie">
            <label className="flex items-start gap-3 cursor-pointer p-3 bg-surface border border-strong rounded-xl hover:border-rose-500 transition">
              <input
                type="checkbox"
                checked={leveeSaisieOk}
                onChange={e => setLeveeSaisieOk(e.target.checked)}
                className="mt-1 w-5 h-5"
              />
              <div className="flex-1">
                <div className="text-ink text-sm font-medium">
                  J&apos;ai reçu l&apos;accord de levée de saisie de la police
                </div>
                <div className="text-ink-muted text-xs mt-1">
                  Pour les Rodéos, le document de levée de saisie est obligatoire avant restitution. Si tu ne l&apos;as pas encore reçu, laisse décoché — la restitution exigera la confirmation plus tard.
                </div>
              </div>
            </label>
            {leveeSaisieOk && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-ink-muted">Photo du document (optionnel)</p>
                {leveeSaisiePreview && (
                  <div className="relative inline-block">
                    <img src={leveeSaisiePreview} alt="Levée de saisie" className="max-h-32 rounded-lg border" />
                    <button
                      type="button"
                      onClick={() => { setLeveeSaisiePhoto(null); setLeveeSaisiePreview('') }}
                      className="absolute top-1 right-1 w-6 h-6 bg-black/60 rounded-full text-white text-xs flex items-center justify-center">
                      ✕
                    </button>
                  </div>
                )}
                {!leveeSaisiePreview && (
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      setLeveeSaisiePhoto(f)
                      const reader = new FileReader()
                      reader.onload = ev => setLeveeSaisiePreview(String(ev.target?.result || ''))
                      reader.readAsDataURL(f)
                    }}
                    className="text-sm text-ink-muted"
                  />
                )}
              </div>
            )}
          </Section>
        )}

        {/* Photos */}
        <Section title={`Photos (${photos.length})`}>
          {previews.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-2">
              {previews.map((src, i) => (
                <div key={i} className="aspect-square rounded-xl overflow-hidden relative">
                  <img src={src} className="w-full h-full object-cover" />
                  <button onClick={() => {
                    setPhotos(p => p.filter((_, j) => j !== i))
                    setPreviews(p => p.filter((_, j) => j !== i))
                  }} className="absolute top-1 right-1 w-6 h-6 bg-black/60 rounded-full text-white text-xs flex items-center justify-center">✕</button>
                </div>
              ))}
            </div>
          )}
          <input ref={photoRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addPhotos(e.target.files)} />
          <button onClick={() => photoRef.current?.click()}
            className="w-full py-3 border-2 border-dashed border-strong rounded-xl text-ink-faint text-sm hover:border-gray-400">
            📷 Ajouter des photos
          </button>
        </Section>

        {err && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-critical text-sm">{err}</div>}
      </div>

      {/* Bottom button */}
      <div className="fixed bottom-0 left-0 right-0 bg-surface/95 border-t border px-4 py-4 shadow-lg">
        <button onClick={handleSubmit} disabled={loading}
          className={`w-full py-4 ${cfg!.color} disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-md`}>
          {loading ? '⏳ Création en cours...' : `${cfg!.icon} Créer la mission`}
        </button>
      </div>

      {/* Modal Marques */}
      {showBrands && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="bg-surface w-full rounded-t-3xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-ink">Sélectionner une marque</h2>
              <button onClick={() => setShowBrands(false)} className="text-ink-faint text-xl">✕</button>
            </div>
            <div className="px-4 py-2">
              <input value={brandSearch} onChange={e => setBrandSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full bg-surface-hover rounded-xl px-3 py-2.5 text-sm text-ink outline-none" autoFocus />
            </div>
            <div className="overflow-y-auto flex-1 px-4 pb-4">
              {filteredBrands.map(b => (
                <button key={b.id} onClick={() => {
                  setBrand(b.name); setSelectedBrandId(b.id); setModel(''); setShowBrands(false)
                }} className="w-full text-left py-3 border-b border-gray-100 text-ink text-sm">
                  {b.name}
                </button>
              ))}
              {filteredBrands.length === 0 && brandSearch && (
                <button onClick={() => {
                  setBrand(brandSearch); setSelectedBrandId(null); setModel(''); setShowBrands(false)
                }} className="w-full text-left py-3 text-blue-600 text-sm font-medium">
                  ✚ Utiliser &quot;{brandSearch}&quot;
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Modèles */}
      {showModels && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="bg-surface w-full rounded-t-3xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-ink">{brand}</h2>
              <button onClick={() => setShowModels(false)} className="text-ink-faint text-xl">✕</button>
            </div>
            <div className="px-4 py-2">
              <input value={modelSearch} onChange={e => setModelSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full bg-surface-hover rounded-xl px-3 py-2.5 text-sm text-ink outline-none" autoFocus />
            </div>
            <div className="overflow-y-auto flex-1 px-4 pb-4">
              {filteredModels.map(m => (
                <button key={m.id} onClick={() => {
                  setModel(m.name); setShowModels(false)
                }} className="w-full text-left py-3 border-b border-gray-100 text-ink text-sm">
                  {m.name}
                </button>
              ))}
              {(filteredModels.length === 0 || modelSearch) && modelSearch && (
                <button onClick={() => {
                  setModel(modelSearch); setShowModels(false)
                }} className="w-full text-left py-3 text-blue-600 text-sm font-medium">
                  ✚ Utiliser &quot;{modelSearch}&quot;
                </button>
              )}
              {filteredModels.length === 0 && !modelSearch && (
                <p className="text-ink-faint text-sm py-3">Tapez un modèle dans la recherche</p>
              )}
            </div>
          </div>
        </div>
      )}

      <VehiclePlateLookup
        plate={plate}
        open={showLookup}
        onSelect={handleVehicleSelect}
        onCreateNew={handleCreateNewVehicle}
        onCancel={() => setShowLookup(false)}
      />
    </div>
  )
}
