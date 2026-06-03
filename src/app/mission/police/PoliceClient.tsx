'use client'
// src/app/mission/police/PoliceClient.tsx

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import VehiclePlateLookup from '@/components/vehicles/VehiclePlateLookup'
import ScanButton from '@/components/ScanButton'
import type { VehicleMatch } from '@/types/vehicles'
import { useT } from '@/lib/i18n/I18nProvider'
import { T }    from '@/lib/i18n/T'
import { normalizePlate } from '@/lib/plate'

type MissionType = 'accident' | 'saisie' | 'rodeo' | 'mal_garee' | 'snc' | 'sc' | 'appel_prive' | 'avp'

const TYPE_CONFIG: Record<MissionType, { label: string; icon: string; color: string; colorLight: string; hidePolice?: boolean; hideOwner?: boolean }> = {
  accident:    { label: 'Police Accident',    icon: '🚨', color: 'bg-red-600',    colorLight: 'bg-red-50 border-red-200' },
  saisie:      { label: 'Saisie',             icon: '⚖️', color: 'bg-purple-600', colorLight: 'bg-purple-50 border-purple-200' },
  rodeo:       { label: 'Rodéo',              icon: '🏎️', color: 'bg-rose-600',   colorLight: 'bg-rose-50 border-rose-200' },
  mal_garee:   { label: 'Mal Garée',          icon: '🚫', color: 'bg-amber-600',  colorLight: 'bg-amber-50 border-amber-200' },
  snc:         { label: 'Siabis Non Couvert', icon: '🛣️', color: 'bg-blue-600',   colorLight: 'bg-blue-50 border-blue-200' },
  sc:          { label: 'Siabis Couvert',     icon: '🛣️', color: 'bg-cyan-600',   colorLight: 'bg-cyan-50 border-cyan-200', hidePolice: true, hideOwner: true },
  appel_prive: { label: 'Appel Privé',        icon: '📞', color: 'bg-green-800',  colorLight: 'bg-green-50 border-green-200', hidePolice: true },
  avp:         { label: 'AVP',                icon: '🔲', color: 'bg-black',     colorLight: 'bg-gray-50 border-gray-200',  hidePolice: true, hideOwner: true },
}

// Triees alphabetiquement pour la liste affichee. Le defaut (zone la plus
// frequente, Verviers Depannage etant sur Verviers) est Vesdre.
// Olivier 2026-06-02 : les zones de police sont maintenant gerees depuis
// /admin/police-zones (pattern zero-hardcode). Le fallback historique est
// utilise au chargement initial le temps que /api/police-zones reponde.
const POLICE_ZONES_FALLBACK = ['Police Zone Vesdre', 'Police Zone Fagnes']
const DEFAULT_POLICE_ZONE = 'Police Zone Vesdre'

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
  const { t } = useT()
  const [selectedType, setSelectedType] = useState<MissionType | null>(null)
  const { date: initDate, time: initTime } = nowFormatted()

  const [date,           setDate]           = useState(initDate)
  const [time,           setTime]           = useState(initTime)
  const [plate,          setPlate]          = useState('')
  const [vin,            setVin]            = useState('')
  const [brand,          setBrand]          = useState('')
  const [model,          setModel]          = useState('')
  const [location,       setLocation]       = useState('')
  const [policeZone,     setPoliceZone]     = useState(DEFAULT_POLICE_ZONE)
  const [policeZones,    setPoliceZones]    = useState<string[]>(POLICE_ZONES_FALLBACK)
  const [officerName,    setOfficerName]    = useState('')
  const [ownerFirstName, setOwnerFirstName] = useState('')
  const [ownerLastName,  setOwnerLastName]  = useState('')
  const [ownerPhone,     setOwnerPhone]     = useState('')
  const [remarks,        setRemarks]        = useState('')
  const [policeBlocked,  setPoliceBlocked]  = useState(false)
  // Saisie : motif obligatoire choisi dans la liste configuree en admin
  // (demande Franck 2026-06-01). Le label apparaitra sur l etiquette parc.
  const [saisieMotifCode,  setSaisieMotifCode]  = useState<string>('')
  const [saisieMotifs,     setSaisieMotifs]     = useState<Array<{ id: string; code: string; label: string; label_short: string | null; icon: string | null }>>([])
  const [loadingSaisieMotifs, setLoadingSaisieMotifs] = useState(false)
  // Mal Garee scenario : 'chargement' (defaut, mise en parc) ou 'deplacement_paye'
  // (client arrive avant chargement, paye le deplacement 125 EUR TVAC, pas de
  // mise en parc, mission close apres encaissement). Olivier 2026-05-26.
  const [malGareeScenario, setMalGareeScenario] = useState<'chargement' | 'deplacement_paye'>('chargement')
  // Note : la levee de saisie Rodeo n est plus saisie depuis le formulaire
  // chauffeur (Olivier 2026-05-24, regle "info levee = service fourriere
  // uniquement"). C est la fiche dispatch / le workflow restitution qui
  // capture la confirmation.
  // SNC (Siabis Non Couvert) + SC (Siabis Couvert) : balisage + scenario
  const [sncRequiresBalisage, setSncRequiresBalisage] = useState(false)
  const [sncScenario, setSncScenario] = useState<'dsp' | 'rem_client' | 'rem_depot' | ''>('')
  // SC uniquement : nom de l assistance qui paye (Touring, Ethias, VAB, etc.)
  const [scAssistanceName, setScAssistanceName] = useState('')
  // Appel Prive : forfait TVAC negocie au tel (optionnel). Si vide, la
  // facturation appliquera le fallback tarif police_accident + majorations.
  const [amountToCollect, setAmountToCollect] = useState('')
  // Appel Prive : type d intervention (DSP ou REM). Pour DSP on n a pas de
  // destination, pour REM on en propose une. Olivier 2026-05-26.
  const [appelPriveType, setAppelPriveType] = useState<'DSP' | 'REM' | ''>('')
  // Appel Prive REM : destination = livraison directe client OU passage par
  // notre depot Pepinster. Si DSP : implicitement 'client'. Si 'depot' :
  // mise en parc Transit + impression etiquette. Si 'client' : pas d
  // etiquette mais owner OBLIGATOIRE (necessaire pour facturation).
  const [appelPriveDestination, setAppelPriveDestination] = useState<'client' | 'depot' | ''>('')
  // Preview tarif Appel Prive (resultat de /api/missions/estimate-preview)
  const [priveEstimate, setPriveEstimate] = useState<{ total_tvac: number; total_htva: number; lines: Array<{ name: string; qty: number; price_unit: number }> } | null>(null)
  const [priveEstimateLoading, setPriveEstimateLoading] = useState(false)
  const [priveEstimateError, setPriveEstimateError] = useState<string | null>(null)
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
  // Id mission VD Soft renvoye par /api/towsoft/create. Utilise sur l ecran
  // succes pour construire le lien encaissement precomplete (Olivier 2026-05-26).
  const [createdMissionId, setCreatedMissionId] = useState<string | null>(null)

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
  // Olivier 2026-06-02 : zones de police dynamiques (gerees dans /admin/police-zones)
  useEffect(() => {
    fetch('/api/police-zones')
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data?.zones) ? data.zones : []
        if (list.length > 0) {
          setPoliceZones(list.map((z: any) => z.name))
          const def = list.find((z: any) => z.is_default)
          if (def) setPoliceZone(def.name)
        }
      })
      .catch(() => {/* fallback hardcode garde */})
  }, [])

  useEffect(() => {
    if (!selectedType) return
    acRef.current = null // Reset pour forcer la réinit
    const init = () => {
      if (!window.google?.maps?.places || !locationRef.current) return
      // Pas de restriction 'types' pour autoriser adresses ET etablissements
      // (ex: "Garage Untel", "McDonald s Verviers", etc.)
      acRef.current = new window.google.maps.places.Autocomplete(locationRef.current, {
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

  // ──────────── Chargement des motifs de saisie (au passage en type 'saisie') ────────────
  useEffect(() => {
    if (selectedType !== 'saisie') return
    if (saisieMotifs.length > 0 || loadingSaisieMotifs) return
    setLoadingSaisieMotifs(true)
    fetch('/api/saisie-motifs')
      .then(r => r.json())
      .then(d => setSaisieMotifs(d.motifs || []))
      .catch(() => {})
      .finally(() => setLoadingSaisieMotifs(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType])

  // Reset du motif quand on change de type
  useEffect(() => {
    if (selectedType !== 'saisie') setSaisieMotifCode('')
  }, [selectedType])

  // ──────────── Autocomplete destination (SNC rem_client / rem_depot + Prive REM depot) ────────────
  // Initialise une seule fois quand le champ est rendu (= scenario qui requiert
  // une destination). Olivier 2026-05-26 : ajout Appel Prive REM depot pour
  // saisir adresse de relivraison directement (pre-remplit la note etiquette).
  useEffect(() => {
    destAcRef.current = null  // reset au changement de scenario
    const isSiabis = selectedType === 'snc' || selectedType === 'sc'
    // Olivier 2026-05-27 : autocomplete destination pour tous les REM Appel Prive
    // (client direct ET depot), pas seulement depot.
    const isPriveRem = selectedType === 'appel_prive' && appelPriveType === 'REM'
    if (!isSiabis && !isPriveRem) return
    if (isSiabis && sncScenario !== 'rem_client' && sncScenario !== 'rem_depot') return

    const init = () => {
      if (!window.google?.maps?.places || !destinationRef.current) return
      if (destAcRef.current) return  // deja init
      // Pas de restriction 'types' pour autoriser adresses ET etablissements
      destAcRef.current = new window.google.maps.places.Autocomplete(destinationRef.current, {
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

  // ──────────── Preview tarif SNC/SC en live ────────────
  // Quand SNC/SC + scenario + coords sont presents, debounce et appel
  // /api/snc-preview-tarif. SC = forfait sans km (variant=sc).
  useEffect(() => {
    const isSiabis = selectedType === 'snc' || selectedType === 'sc'
    if (!isSiabis || !sncScenario || locationLat == null || locationLng == null) {
      setSncPreview(null); setPreviewError(null)
      return
    }
    // REM client : destination obligatoire pour calcul (SNC seulement, pas SC)
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
            variant:           selectedType === 'sc' ? 'sc' : 'snc',
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

  // ──────────── Preview tarif Appel Prive en live ────────────
  // Quand selectedType=appel_prive et type DSP/REM choisi, appelle
  // /api/missions/estimate-preview pour afficher au chauffeur le tarif estime
  // (forfait negocie si saisi, sinon fallback tarif source).
  useEffect(() => {
    if (selectedType !== 'appel_prive' || !appelPriveType) {
      setPriveEstimate(null); setPriveEstimateError(null)
      return
    }
    const ctrl = new AbortController()
    const handler = setTimeout(async () => {
      setPriveEstimateLoading(true)
      setPriveEstimateError(null)
      try {
        const [dd, mm, yyyy] = (date || '').split('-')
        const [hh, mn] = (time || '00:00').split(':')
        const interventionAt = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mn}:00`).toISOString()
        const res = await fetch('/api/missions/estimate-preview', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            source:            'prive',
            mission_type:      appelPriveType,
            intervention_at:   interventionAt,
            amount_to_collect: amountToCollect !== '' ? Number(amountToCollect) : null,
          }),
          signal: ctrl.signal,
        })
        const j = await res.json()
        if (!res.ok || !j.ok) {
          setPriveEstimate(null)
          setPriveEstimateError(j.error || 'Tarif indisponible')
        } else {
          setPriveEstimate(j)
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setPriveEstimate(null)
          setPriveEstimateError(e.message || 'Erreur réseau')
        }
      } finally {
        setPriveEstimateLoading(false)
      }
    }, 500)
    return () => { clearTimeout(handler); ctrl.abort() }
  }, [selectedType, appelPriveType, amountToCollect, date, time])

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
    // Saisie : motif obligatoire (demande Franck 2026-06-01).
    if (selectedType === 'saisie' && !saisieMotifCode) {
      setErr('Le motif de la saisie est obligatoire'); return
    }
    // Appel Privé : DSP/REM obligatoire, et pour REM le scenario destination
    // doit etre choisi explicitement.
    if (selectedType === 'appel_prive') {
      if (!appelPriveType) { setErr('Choisis le type d\'intervention (DSP ou REM)'); return }
      if (appelPriveType === 'REM' && !appelPriveDestination) {
        setErr('Choisis la destination du remorquage (client direct ou dépôt)'); return
      }
      // REM client direct : adresse destination OBLIGATOIRE (calcul tarif + livraison).
      if (appelPriveType === 'REM' && appelPriveDestination === 'client' && !destination.trim()) {
        setErr('Adresse de destination obligatoire pour une REM client direct'); return
      }
      // Owner : plus jamais obligatoire dans le form chauffeur (Olivier 2026-05-27).
      // Le client sera recupere via le module encaissement (recherche/creation
      // Odoo) qui auto-link a la mission. Plus simple et evite la double saisie.
    }
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

    // Olivier 2026-06-01 — Workflow encaisser-avant-creer :
    // Pour les scenarios avec paiement immediat obligatoire (Mal Garee
    // deplacement_paye, Appel Prive DSP/REM client, SNC DSP/REM client),
    // on cree la mission en mode DRAFT (awaiting_payment=true). Pas d envoi
    // TowSoft / Helpdesk / email tant que le solde n est pas encaisse en
    // totalite. Redirection vers la fiche mission qui sait afficher le
    // bouton "Encaisser solde" puis "Finaliser" quand solde = 0.
    const needsImmediatePaymentLocal =
      (selectedType === 'mal_garee' && malGareeScenario === 'deplacement_paye') ||
      (selectedType === 'appel_prive' && (appelPriveType === 'DSP' || (appelPriveType === 'REM' && appelPriveDestination === 'client'))) ||
      (selectedType === 'snc' && (sncScenario === 'dsp' || sncScenario === 'rem_client'))

    if (needsImmediatePaymentLocal) {
      // Olivier 2026-06-03 : pre-calcul de intervention_at cote browser pour
      // que la timezone soit correctement gerée (sinon le serveur Node UTC
      // interprete date/time en UTC au lieu de heure Belgique → decalage 2h
      // qui fait perdre la majoration nuit).
      const [dd0, mm0, yyyy0] = (date || '').split('-')
      const [hh0, mn0] = (time || '00:00').split(':')
      const interventionAtIso = (dd0 && mm0 && yyyy0)
        ? new Date(`${yyyy0}-${mm0}-${dd0}T${hh0}:${mn0}:00`).toISOString()
        : new Date().toISOString()
      const draftRes = await fetch('/api/missions/police/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: selectedType, date, time, intervention_at: interventionAtIso, plate: finalPlate, vin, brand, model,
          location, policeZone, officerName,
          ownerFirstName, ownerLastName, ownerPhone,
          remarks, photoUrls,
          policeBlocked,
          sncRequiresBalisage,
          sncScenario:           sncScenario || null,
          incidentLat:           locationLat,
          incidentLng:           locationLng,
          destination,
          destinationLat,
          destinationLng,
          amountToCollect:       selectedType === 'appel_prive' ? amountToCollect : null,
          appelPriveType:        selectedType === 'appel_prive' ? (appelPriveType || null) : null,
          appelPriveDestination: selectedType === 'appel_prive' ? (appelPriveDestination || null) : null,
          malGareeScenario:      selectedType === 'mal_garee'   ? malGareeScenario : null,
          // saisie n entre pas dans needsImmediatePayment donc rien a passer ici
          saisieMotifCode:       null,
          saisieMotifLabel:      null,
        }),
      })
      const draftData = await draftRes.json()
      setLoading(false)
      if (!draftRes.ok || !draftData.ok) {
        setErr(draftData.error || 'Erreur création mission en mode encaissement')
        return
      }
      // Redirection directe vers la fiche mission qui pilotera l encaissement
      window.location.href = `/mission/${draftData.missionId}`
      return
    }

    // Flow normal (pas de paiement immediat) : creation directe + hooks externes
    const res = await fetch('/api/towsoft/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: selectedType, date, time, plate: finalPlate, vin, brand, model,
        location, policeZone, officerName,
        ownerFirstName, ownerLastName, ownerPhone,
        remarks, photoUrls,
        policeBlocked,
        sncRequiresBalisage,
        sncScenario:             sncScenario || null,
        scAssistanceName:        selectedType === 'sc' ? scAssistanceName.trim() || null : null,
        // Coordonnees GPS (depuis autocomplete) pour SNC + calcul tarif futur
        incidentLat:             locationLat,
        incidentLng:             locationLng,
        destination,
        destinationLat,
        destinationLng,
        // Appel Prive : forfait TVAC saisi (string vide ou nombre)
        amountToCollect: selectedType === 'appel_prive' ? amountToCollect : null,
        // Appel Prive : type DSP ou REM (defaut REM si pas choisi pour ne pas
        // casser les missions existantes)
        appelPriveType: selectedType === 'appel_prive' ? (appelPriveType || null) : null,
        // Appel Prive REM : 'client' (livraison directe, pas d etiquette) ou
        // 'depot' (Transit + etiquette). DSP : implicitement 'client'.
        appelPriveDestination: selectedType === 'appel_prive' ? (appelPriveDestination || null) : null,
        // Mal Garee scenario : chargement (parc) ou deplacement_paye (encaissement direct).
        malGareeScenario: selectedType === 'mal_garee' ? malGareeScenario : null,
        // Saisie : code + label du motif (label snapshot pour resilience).
        saisieMotifCode:  selectedType === 'saisie' ? saisieMotifCode : null,
        saisieMotifLabel: selectedType === 'saisie'
          ? (saisieMotifs.find(m => m.code === saisieMotifCode)?.label_short
              || saisieMotifs.find(m => m.code === saisieMotifCode)?.label
              || null)
          : null,
      }),
    })

    const data = await res.json()
    setLoading(false)

    if (data.ok) {
      setCreatedMissionId(data.missionId || null)
      setDone(true)
      // Olivier 2026-05-27 : sources avec encaissement OBLIGATOIRE (Mal Garee
      // deplacement_paye + Appel Prive DSP/REM client + SNC dsp/rem_client) =
      // auto-redirect immediat vers /encaissement, sans ecran intermediaire ni
      // bouton "Plus tard". Le chauffeur ne peut PAS skipper.
      // Olivier 2026-06-02 : pour les missions avec mise en parc (mal_garee
      // chargement, snc rem_depot, appel_prive REM depot), PAS d ecran de
      // choix encaissement. Le paiement se fera plus tard via la recherche
      // plaque ou le scan QR quand le client vient recuperer le vehicule.
      // Pour les autres types (accident, saisie, ...) : redirect auto dashboard.
      const goesToParc =
        (selectedType === 'mal_garee'   && malGareeScenario === 'chargement') ||
        (selectedType === 'appel_prive' && appelPriveDestination === 'depot') ||
        (selectedType === 'snc'         && sncScenario === 'rem_depot')
      const needsPayment = ['appel_prive', 'mal_garee', 'snc'].includes(selectedType) && !goesToParc
      const needsImmediatePayment =
        (selectedType === 'mal_garee' && malGareeScenario === 'deplacement_paye') ||
        (selectedType === 'appel_prive' && (appelPriveType === 'DSP' || (appelPriveType === 'REM' && appelPriveDestination === 'client'))) ||
        (selectedType === 'snc' && (sncScenario === 'dsp' || sncScenario === 'rem_client'))

      if (needsImmediatePayment && data.missionId) {
        // Calcul du montant prefill selon source
        const prefillAmt = selectedType === 'mal_garee'
          ? 125
          : selectedType === 'appel_prive' && amountToCollect !== ''
            ? Number(amountToCollect)
            : null
        // Motif label / precision selon source
        const motifLabel = selectedType === 'mal_garee'
          ? 'Mal Garée'
          : selectedType === 'appel_prive'
            ? 'Intervention Privée'
            : 'Siabis'
        const motifPrecision = selectedType === 'mal_garee'
          ? `Déplacement payé — ${(plate || vin || '').trim().toUpperCase()}`
          : selectedType === 'appel_prive'
            ? `${appelPriveType || ''} — ${(plate || vin || '').trim().toUpperCase()}`.trim()
            : `${sncScenario || ''} — ${(plate || vin || '').trim().toUpperCase()}`.trim()
        const url = `/encaissement?prefill_mission_id=${data.missionId}`
          + `&prefill_plate=${encodeURIComponent(plate || vin || '')}`
          + `&prefill_brand=${encodeURIComponent(brand || '')}`
          + `&prefill_model=${encodeURIComponent(model || '')}`
          + (prefillAmt != null ? `&prefill_amount=${prefillAmt}` : '')
          + `&prefill_location=${encodeURIComponent(location || '')}`
          + `&prefill_motif_label=${encodeURIComponent(motifLabel)}`
          + `&prefill_motif_precision=${encodeURIComponent(motifPrecision)}`
          + `&return_to=/mission/${data.missionId}`
        setTimeout(() => { window.location.href = url }, 800)
      } else if (!needsPayment) {
        setTimeout(() => router.push('/dashboard'), 2000)
      }
    } else {
      setErr(data.error || 'Erreur création')
    }
  }

  const cfg = selectedType ? TYPE_CONFIG[selectedType] : null

  // ── Écran succès ──────────────────────────────────────────────────────────
  // Sources avec encaissement chauffeur direct : on propose un bouton qui
  // ouvre /encaissement precomplete (mission_id + plate + brand + model +
  // amount). Le chauffeur peut choisir d encaisser maintenant ou plus tard.
  if (done) {
    // Olivier 2026-06-02 : les missions qui partent au parc (mise en depot)
    // n ont PAS de proposition d encaissement sur l ecran de succes. Le
    // paiement se fera plus tard via recherche plaque ou scan QR quand le
    // client vient recuperer le vehicule.
    const goesToParcSuccess =
      (selectedType === 'mal_garee'   && malGareeScenario === 'chargement') ||
      (selectedType === 'appel_prive' && appelPriveDestination === 'depot') ||
      (selectedType === 'snc'         && sncScenario === 'rem_depot')
    const needsPayment = selectedType && ['appel_prive', 'mal_garee', 'snc'].includes(selectedType) && !goesToParcSuccess
    const malGareeDeplacementPaye = selectedType === 'mal_garee' && malGareeScenario === 'deplacement_paye'
    // Encaissement OBLIGATOIRE = pas de bouton "Plus tard" (Olivier 2026-05-27).
    // 3 cas : Mal Garee deplacement_paye + Appel Prive DSP/REM client + SNC dsp/rem_client.
    const needsImmediatePaymentSuccess =
      malGareeDeplacementPaye ||
      (selectedType === 'appel_prive' && (appelPriveType === 'DSP' || (appelPriveType === 'REM' && appelPriveDestination === 'client'))) ||
      (selectedType === 'snc' && (sncScenario === 'dsp' || sncScenario === 'rem_client'))
    // Estimation : pour Appel Prive on prefere le total TVAC du preview tarif
    // (forfait negocie OU tarif source). Pour Mal Garee deplacement paye : 125 fixe.
    // Pour les autres on laisse vide, l ecran encaissement re-calculera depuis la mission.
    const prefillAmount = selectedType === 'appel_prive'
      ? (amountToCollect !== '' ? Number(amountToCollect) : (priveEstimate?.total_tvac ?? null))
      : (malGareeDeplacementPaye ? 125 : (selectedType === 'snc' ? (sncPreview?.total_tvac ?? null) : null))
    // Description courte du motif d encaissement selon source (Olivier 2026-05-26).
    // Permet au chauffeur de ne pas re-saisir manuellement la description dans
    // le module encaissement. Olivier 2026-05-27 (Fix H) : ajout motif_label
    // pour auto-selectionner le motif principal dans la liste.
    const motifLabel = malGareeDeplacementPaye
      ? 'Mal Garée'
      : selectedType === 'appel_prive'
        ? 'Intervention Privée'
        : selectedType === 'snc'
          ? 'Siabis'
          : selectedType === 'mal_garee'
            ? 'Mal Garée'
            : ''
    const motifPrecision = malGareeDeplacementPaye
      ? `Déplacement payé — ${(plate || vin || '').trim().toUpperCase()}`
      : selectedType === 'appel_prive'
        ? `${appelPriveType || ''} — ${(plate || vin || '').trim().toUpperCase()}`.trim()
        : selectedType === 'snc'
          ? `${sncScenario || ''} — ${(plate || vin || '').trim().toUpperCase()}`.trim()
          : `${(plate || vin || '').trim().toUpperCase()}`
    const encaissementUrl = createdMissionId
      ? `/encaissement?prefill_mission_id=${createdMissionId}`
        + `&prefill_plate=${encodeURIComponent(plate || vin || '')}`
        + `&prefill_brand=${encodeURIComponent(brand || '')}`
        + `&prefill_model=${encodeURIComponent(model || '')}`
        + (prefillAmount != null ? `&prefill_amount=${prefillAmount}` : '')
        + `&prefill_location=${encodeURIComponent(location || '')}`
        + (motifLabel ? `&prefill_motif_label=${encodeURIComponent(motifLabel)}` : '')
        + `&prefill_motif_precision=${encodeURIComponent(motifPrecision)}`
        + `&return_to=/dashboard`
      : null
    return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center px-4">
      <div className="bg-surface rounded-3xl shadow-lg p-8 text-center max-w-sm w-full space-y-4">
        <div className="text-6xl">✅</div>
        <h1 className="text-ink text-2xl font-bold"><T k="create_mission.mission_created" /></h1>
        <p className="text-ink-muted text-sm">Email envoyé — TowSoft en cours de mise à jour</p>

        {needsPayment && encaissementUrl && (
          <div className="pt-2 space-y-2">
            {needsImmediatePaymentSuccess && (
              <div className="bg-red-50 border-2 border-red-300 rounded-xl p-3 mb-2">
                <p className="text-red-900 text-sm font-bold">⚠️ Encaissement obligatoire</p>
                <p className="text-red-800 text-xs mt-1">
                  Redirection automatique vers l&apos;encaissement... Le client doit payer avant de partir.
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => router.push(encaissementUrl)}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-2xl shadow-md flex items-center justify-center gap-2"
            >
              💳 Encaisser maintenant
              {prefillAmount != null && (
                <span className="font-normal opacity-90 text-sm">— {prefillAmount.toFixed(2)} €</span>
              )}
            </button>
            {/* Bouton "Plus tard" : masque pour les sources encaissement obligatoire
                (Mal Garee deplacement_paye + Privé direct + SNC direct).
                Le client paye sur place avant de partir. */}
            {!needsImmediatePaymentSuccess && (
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="w-full bg-surface-hover hover:bg-page text-ink-muted text-sm py-2 rounded-xl"
              >
                Plus tard, retour au dashboard
              </button>
            )}
          </div>
        )}

        {needsPayment && !encaissementUrl && (
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 rounded-2xl shadow-md"
          >
            Retour au dashboard
          </button>
        )}

        {!needsPayment && (
          <div className="mt-6 w-full bg-surface-hover rounded-full h-1">
            <div className="bg-green-500 h-1 rounded-full animate-[width_2s_ease-in-out]" style={{width:'100%',transition:'width 2s'}} />
          </div>
        )}
      </div>
    </div>
    )
  }

  // ── Écran sélection type ──────────────────────────────────────────────────
  if (!selectedType) return (
    <div className="min-h-screen bg-page px-4 pt-12 pb-8">
      <button onClick={() => router.push('/dashboard')} className="mb-6 text-ink-muted text-sm flex items-center gap-1">
        ← <T k="encaissement.btn_back" />
      </button>
      <h1 className="text-ink text-2xl font-bold mb-1"><T k="create_mission.title_create" /></h1>
      <p className="text-ink-muted text-sm mb-8"><T k="create_mission.scenario" /></p>
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
        <Section title={t('create_mission.section_datetime')}>
          <div className="grid grid-cols-2 gap-3">
            <LInput label="Date" value={date} onChange={setDate} placeholder="DD-MM-YYYY" />
            <LInput label="Heure" value={time} onChange={setTime} placeholder="HH:MM" />
          </div>
        </Section>

        {/* Véhicule — plaque et VIN sur 2 lignes separees pour laisser de la
            place aux boutons appareil photo (etaient ecrases en grid-cols-2).
            Olivier 2026-05-27. */}
        <Section title={t('create_mission.section_vehicle')}>
          <div>
            <label className="block text-ink-secondary text-xs font-medium mb-1">
              Plaque<span className="text-critical ml-0.5">*</span>
            </label>
            <div className="flex gap-2">
              <input type="text" value={plate}
                onChange={e => {
                  setPlate(normalizePlate(e.target.value))
                  if (vehicleFromOdoo) setVehicleFromOdoo(false)
                }}
                onBlur={searchVehicleByPlate}
                placeholder="1ABC234"
                className="flex-1 bg-surface border border-strong rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft" />
              <ScanButton mode="plate" value={plate} onScan={text => { setPlate(normalizePlate(text)); if (vehicleFromOdoo) setVehicleFromOdoo(false) }}
                className="px-3 bg-brand/10 text-brand rounded-xl text-sm flex items-center justify-center min-w-[48px]" label="📷" />
            </div>
          </div>
          <div>
            <label className="block text-ink-secondary text-xs font-medium mb-1">VIN</label>
            <div className="flex gap-2">
              <input value={vin} onChange={e => setVin(e.target.value.toUpperCase())} placeholder="Optionnel"
                className="flex-1 bg-surface border border-strong rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft" />
              <ScanButton mode="vin" value={vin} onScan={setVin}
                className="px-3 bg-brand/10 text-brand rounded-xl text-sm flex items-center justify-center min-w-[48px]" label="📷" />
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
        <Section title={t('create_mission.section_intervention')}>
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
          {!cfg!.hidePolice && <LSelect label="Zone de police" value={policeZone} onChange={setPoliceZone} options={policeZones} />}
          {!cfg!.hidePolice && <LInput label="Nom du policier" value={officerName} onChange={setOfficerName} />}
        </Section>

        {/* Propriétaire — toujours optionnel. Pour les sources avec paiement
            direct (Appel Prive, SNC dsp/rem_client, Mal Garee deplacement_paye),
            le client sera lie automatiquement via le module encaissement
            (recherche/creation Odoo). Olivier 2026-05-27. */}
        {!cfg!.hideOwner && (() => {
          const isSnc = selectedType === 'snc'
          const sncDirectPayment = isSnc && (sncScenario === 'dsp' || sncScenario === 'rem_client')
          const priveDirectPayment = selectedType === 'appel_prive' && (
            appelPriveType === 'DSP' || (appelPriveType === 'REM' && appelPriveDestination === 'client')
          )
          const malGareePaye = selectedType === 'mal_garee' && malGareeScenario === 'deplacement_paye'
          const autoLinkViaPayment = sncDirectPayment || priveDirectPayment || malGareePaye
          return (
            <Section title={t('create_mission.section_owner_optional')}>
              {autoLinkViaPayment && (
                <p className="text-blue-800 text-xs bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5">
                  💡 Le client sera lié automatiquement à la mission lors de l&apos;encaissement
                  (recherche / création depuis le module paiement).
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <LInput label="Prénom" value={ownerFirstName} onChange={setOwnerFirstName} />
                <LInput label="Nom" value={ownerLastName} onChange={setOwnerLastName} />
              </div>
              <LInput label="Téléphone" value={ownerPhone} onChange={setOwnerPhone} type="tel" />
            </Section>
          )
        })()}

        {/* Appel Privé : type DSP/REM + forfait TVAC (optionnel) + preview tarif.
            Si forfait vide -> facturation fallback sur tarif Prive en vigueur. */}
        {selectedType === 'appel_prive' && (
          <Section title={t('create_mission.section_private_call')}>
            <div className="space-y-3">
              {/* Type d intervention */}
              <div>
                <label className="text-xs font-medium text-ink-secondary mb-1.5 block">
                  Type d&apos;intervention *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: 'DSP', label: '🔧 DSP', desc: 'Dépannage sur place' },
                    { key: 'REM', label: '🚛 REM', desc: 'Remorquage' },
                  ] as const).map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => {
                        setAppelPriveType(opt.key)
                        // DSP : destination implicitement 'client' (paiement direct, pas de parc).
                        // REM : on reset pour forcer le choix explicite client vs depot.
                        if (opt.key === 'DSP') setAppelPriveDestination('client')
                        else setAppelPriveDestination('')
                      }}
                      className={`p-3 rounded-xl border text-left transition ${
                        appelPriveType === opt.key
                          ? 'border-green-500 bg-green-50 ring-2 ring-green-200'
                          : 'border-strong bg-surface hover:border-green-300'
                      }`}
                    >
                      <div className="text-ink text-sm font-medium">{opt.label}</div>
                      <div className="text-ink-muted text-xs">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Destination REM : livraison directe client OU passage depot.
                  Visible uniquement quand type REM choisi. */}
              {appelPriveType === 'REM' && (
                <div>
                  <label className="text-xs font-medium text-ink-secondary mb-1.5 block">
                    Destination du remorquage *
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {([
                      { key: 'client', label: '🏠 Livraison directe client', desc: 'Vers l\'adresse client. Paiement immédiat, pas d\'étiquette parc. Coordonnées client obligatoires.' },
                      { key: 'depot',  label: '🏢 Passage par dépôt Pepinster', desc: 'Mise en parc Transit. Étiquette imprimée. Coordonnées client optionnelles (passera au bureau).' },
                    ] as const).map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setAppelPriveDestination(opt.key)}
                        className={`p-3 rounded-xl border text-left transition ${
                          appelPriveDestination === opt.key
                            ? 'border-green-500 bg-green-50 ring-2 ring-green-200'
                            : 'border-strong bg-surface hover:border-green-300'
                        }`}
                      >
                        <div className="text-ink text-sm font-medium">{opt.label}</div>
                        <div className="text-ink-muted text-xs leading-relaxed">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Adresse de destination : visible si REM (client direct OU depot).
                  Pour REM client direct : OBLIGATOIRE (calcul tarif + livraison).
                  Pour REM depot : OPTIONNEL (relivraison future, pre-remplit etiquette).
                  Olivier 2026-05-27. */}
              {appelPriveType === 'REM' && appelPriveDestination && (
                <div>
                  <label className="text-xs font-medium text-ink-secondary mb-1.5 block">
                    {appelPriveDestination === 'client'
                      ? <>Adresse de destination <span className="text-critical">*</span></>
                      : 'Adresse de relivraison (optionnelle)'}
                  </label>
                  <input
                    ref={destinationRef}
                    value={destination}
                    onChange={e => setDestination(e.target.value)}
                    placeholder="Rue, n°, code postal, ville…"
                    className="w-full bg-surface border border-strong rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-green-500"
                  />
                  <p className="text-xs text-ink-muted mt-1">
                    {appelPriveDestination === 'client'
                      ? '💡 Adresse où le véhicule sera livré. Permet aussi le calcul de tarif km exact.'
                      : '💡 Si renseignée, sera imprimée sur l\'étiquette parc. Sinon : "En attente d\'info adresse de relivraison".'}
                  </p>
                </div>
              )}

              {/* Forfait negocie */}
              <div className="bg-amber-500/10 border-2 border-amber-500/60 rounded-2xl p-3">
                <label className="block text-ink text-sm font-bold mb-1">
                  💳 Paiement à réclamer au client (TVAC)
                </label>
                <p className="text-ink-muted text-xs leading-relaxed mb-2">
                  Forfait négocié au téléphone, montant <strong>TVAC</strong>.
                  Laisse vide si pas de forfait — on appliquera le tarif Privé en vigueur.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={amountToCollect}
                    onChange={e => setAmountToCollect(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-surface border border-strong rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                  />
                  <span className="text-ink-muted text-sm font-medium">€ TVAC</span>
                </div>
              </div>

              {/* Preview tarif (visible des qu un type est choisi) */}
              {appelPriveType && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  {priveEstimateLoading && (
                    <div className="text-green-800 text-xs flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Calcul du tarif estimé...
                    </div>
                  )}
                  {!priveEstimateLoading && priveEstimateError && (
                    <div className="text-amber-800 text-xs">⚠️ {priveEstimateError}</div>
                  )}
                  {!priveEstimateLoading && priveEstimate && (
                    <div className="space-y-1">
                      <div className="text-green-900 text-xs font-semibold uppercase tracking-wide">Tarif estimé</div>
                      {priveEstimate.lines?.map((ln, i) => (
                        <div key={i} className="flex justify-between text-green-800 text-xs">
                          <span>{ln.name}{ln.qty > 1 ? ` × ${ln.qty}` : ''}</span>
                          <span className="tabular-nums">{(ln.qty * ln.price_unit).toFixed(2)} €</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-green-900 text-sm font-bold pt-1 border-t border-green-200">
                        <span>Total TVAC</span>
                        <span className="tabular-nums">{priveEstimate.total_tvac.toFixed(2)} €</span>
                      </div>
                      <div className="flex justify-between text-green-700 text-xs">
                        <span>HTVA</span>
                        <span className="tabular-nums">{priveEstimate.total_htva.toFixed(2)} €</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Mal Garee scenario : Chargement normal (parc) ou Deplacement avec
            paiement (125 EUR TVAC, client arrive avant chargement, pas de parc).
            Olivier 2026-05-26. */}
        {selectedType === 'mal_garee' && (
          <Section title={t('create_mission.section_mal_garee')}>
            <div className="grid grid-cols-1 gap-2">
              {([
                { key: 'chargement',      label: '🚛 Chargement et mise en parc',  desc: 'Workflow standard : véhicule chargé et mis en zone L. Restitution ultérieure au propriétaire (avec gardiennage).' },
                { key: 'deplacement_paye', label: '💳 Déplacement avec paiement',    desc: 'Le client arrive AVANT chargement. Paye 125€ TVAC pour le déplacement de la dépanneuse. Véhicule pas chargé, pas de parc.' },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMalGareeScenario(opt.key)}
                  className={`p-3 rounded-xl border text-left transition ${
                    malGareeScenario === opt.key
                      ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-200'
                      : 'border-strong bg-surface hover:border-amber-300'
                  }`}
                >
                  <div className="text-ink text-sm font-medium">{opt.label}</div>
                  <div className="text-ink-muted text-xs leading-relaxed">{opt.desc}</div>
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Motif de saisie — obligatoire pour Police-Saisie (demande Franck 2026-06-01).
            Liste configuree dans /admin/saisie-motifs. Le motif choisi apparait sur l etiquette parc. */}
        {selectedType === 'saisie' && (
          <Section title={t('create_mission.section_saisie_motif')}>
            {loadingSaisieMotifs ? (
              <p className="text-ink-faint text-sm text-center py-4">Chargement…</p>
            ) : saisieMotifs.length === 0 ? (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 text-center">
                <p className="text-amber-900 font-semibold">⚠️ Aucun motif configuré</p>
                <p className="text-amber-700 text-xs mt-1">L admin doit configurer la liste via /admin/saisie-motifs avant que tu puisses créer cette mission.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto p-1">
                {saisieMotifs.map(m => {
                  const selected = saisieMotifCode === m.code
                  return (
                    <button key={m.id} type="button"
                      onClick={() => setSaisieMotifCode(m.code)}
                      className={`p-3 rounded-xl border-2 transition text-center ${
                        selected
                          ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-200'
                          : 'border-strong bg-surface hover:border-purple-300'
                      }`}>
                      <div className="text-2xl mb-1">{m.icon || '⚖️'}</div>
                      <div className={`text-xs font-semibold leading-tight ${selected ? 'text-purple-900' : 'text-ink'}`}>{m.label}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </Section>
        )}

        {/* Blocage Police : toggle visible pour les Mal Garees (uniquement scenario
            chargement, pas pour deplacement_paye qui ne va pas en parc).
            Si actif, la restitution exigera une confirmation que le
            proprietaire est bien passe au commissariat. */}
        {selectedType === 'mal_garee' && malGareeScenario === 'chargement' && (
          <Section title={t('create_mission.section_police_block')}>
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

        {/* Remarques */}
        <Section title={t('create_mission.section_remarks')}>
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={3}
            placeholder="Observations..."
            className="w-full bg-surface border border-strong rounded-xl px-3 py-3 text-ink text-sm outline-none resize-none focus:border-blue-500" />
        </Section>

        {/* SNC (Siabis Non Couvert) + SC (Siabis Couvert) : scenario + balisage + assistance (SC) */}
        {(selectedType === 'snc' || selectedType === 'sc') && (
          <Section title={selectedType === 'sc' ? t('create_mission.section_sia_covered') : t('create_mission.section_snc')}>
            <div className="space-y-3">
              {/* Nom assistance (SC uniquement) */}
              {selectedType === 'sc' && (
                <div>
                  <label className="text-xs font-medium text-ink-secondary mb-1.5 block">
                    Assistance qui prend en charge *
                  </label>
                  <input
                    value={scAssistanceName}
                    onChange={e => setScAssistanceName(e.target.value)}
                    placeholder="Ex: Touring, Ethias, VAB, IMA, AXA..."
                    className="w-full bg-surface border border-strong rounded-xl px-3 py-3 text-ink text-sm outline-none focus:border-cyan-500"
                  />
                  <p className="text-xs text-ink-muted mt-1">
                    L&apos;assistance paye la facture (aucun encaissement client). Sera utilisée comme client facturé sur le devis Odoo.
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-ink-secondary mb-1.5 block">
                  Scénario d&apos;intervention
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {([
                    { key: 'dsp',        label: '🔧 DSP — Dépannage sur place',          desc: selectedType === 'sc' ? 'Réparation sur autoroute, facturée à l\'assistance.' : 'Réparation sur autoroute, client paie en direct au chauffeur.' },
                    ...(selectedType === 'snc' ? [{ key: 'rem_client' as const, label: '🚛 REM avec paiement immédiat',          desc: 'Remorquage vers destination du client, paiement immédiat.' }] : []),
                    { key: 'rem_depot',  label: '🏢 REM vers dépôt Pepinster',            desc: selectedType === 'sc' ? 'Mise en zone Transit, relivraison ultérieure au tarif assistance.' : 'Mise en zone Transit, le client passera au bureau ensuite.' },
                  ] as const).map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setSncScenario(opt.key)}
                      className={`p-3 rounded-xl border text-left transition ${
                        sncScenario === opt.key
                          ? (selectedType === 'sc' ? 'bg-cyan-50 border-cyan-500 ring-2 ring-cyan-200' : 'bg-blue-50 border-blue-500 ring-2 ring-blue-200')
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

        {/* Note : pas de section "Levée de saisie" cote chauffeur — c est le
            service fourriere qui gere ca depuis la fiche dispatch / workflow
            restitution (Olivier 2026-05-24). */}

        {/* Photos */}
        <Section title={`${t('create_mission.section_photos')} (${photos.length})`}>
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

      {/* Bottom button — label dynamique selon scenario.
          Olivier 2026-05-27 : pour les sources avec encaissement direct
          chauffeur (Mal Garee deplacement_paye, Appel Prive DSP/REM client,
          SNC dsp/rem_client), le label rend explicite que l etape suivante
          sera l encaissement (auto-redirect immediat sans ecran intermediaire). */}
      {(() => {
        const needsImmediatePayment =
          (selectedType === 'mal_garee' && malGareeScenario === 'deplacement_paye') ||
          (selectedType === 'appel_prive' && (appelPriveType === 'DSP' || (appelPriveType === 'REM' && appelPriveDestination === 'client'))) ||
          (selectedType === 'snc' && (sncScenario === 'dsp' || sncScenario === 'rem_client'))
        // Olivier 2026-06-01 : pour les scenarios a paiement immediat, le
        // bouton dit "Encaisser" (et non "Creer la mission") car la mission
        // est creee en mode DRAFT et le chauffeur encaisse depuis la fiche.
        // Le solde restant + bouton "Finaliser" sont affiches sur la fiche.
        const submitLabel = loading
          ? `⏳ ${t('create_mission.creating')}`
          : needsImmediatePayment
            ? `💳 Encaisser`
            : `${cfg!.icon} ${t('create_mission.create_mission_btn')}`
        return (
          <div className="fixed bottom-0 left-0 right-0 bg-surface/95 border-t border px-4 py-4 shadow-lg">
            <button onClick={handleSubmit} disabled={loading}
              className={`w-full py-4 ${cfg!.color} disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-md`}>
              {submitLabel}
            </button>
            {needsImmediatePayment && !loading && (
              <p className="text-ink-muted text-xs text-center mt-2">
                ⚠️ Encaissement obligatoire — redirection automatique vers la page paiement après création
              </p>
            )}
          </div>
        )
      })()}

      {/* Modal Marques */}
      {showBrands && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="bg-surface w-full rounded-t-3xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-ink"><T k="create_mission.select_brand" /></h2>
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
