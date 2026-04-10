'use client'
// src/app/mission/police/PoliceClient.tsx

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type MissionType = 'accident' | 'saisie' | 'mal_garee' | 'snc'

const TYPE_CONFIG: Record<MissionType, { label: string; icon: string; color: string; colorLight: string }> = {
  accident:  { label: 'Police Accident',    icon: '🚨', color: 'bg-red-600',    colorLight: 'bg-red-50 border-red-200' },
  saisie:    { label: 'Saisie',             icon: '⚖️', color: 'bg-purple-600', colorLight: 'bg-purple-50 border-purple-200' },
  mal_garee: { label: 'Mal Garée',          icon: '🚫', color: 'bg-amber-600',  colorLight: 'bg-amber-50 border-amber-200' },
  snc:       { label: 'Siabis Non Couvert', icon: '🛣️', color: 'bg-blue-600',   colorLight: 'bg-blue-50 border-blue-200' },
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
      <label className="block text-gray-600 text-xs font-medium mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-gray-900 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
    </div>
  )
}

function LSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <div>
      <label className="block text-gray-600 text-xs font-medium mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-gray-900 text-sm outline-none focus:border-blue-500">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
      <p className="text-gray-400 text-xs uppercase tracking-widest font-semibold">{title}</p>
      {children}
    </div>
  )
}

export default function PoliceClient() {
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

  const locationRef = useRef<HTMLInputElement>(null)
  const photoRef    = useRef<HTMLInputElement>(null)
  const acRef       = useRef<any>(null)

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

  const addPhotos = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(f => {
      setPhotos(p => [...p, f])
      const r = new FileReader()
      r.onload = e => setPreviews(p => [...p, e.target?.result as string])
      r.readAsDataURL(f)
    })
  }

  const filteredBrands = brands.filter(b => b.name.toLowerCase().includes(brandSearch.toLowerCase()))
  const filteredModels = models.filter(m => m.name.toLowerCase().includes(modelSearch.toLowerCase()))

  const handleSubmit = async () => {
    if (!selectedType) return
    if (!location.trim()) { setErr('Le lieu d\'intervention est requis'); return }
    if (!plate && !vin)   { setErr('Plaque ou VIN requis'); return }

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

    const res = await fetch('/api/towsoft/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: selectedType, date, time, plate, vin, brand, model,
        location, policeZone, officerName,
        ownerFirstName, ownerLastName, ownerPhone,
        remarks, photoUrls,
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
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="bg-white rounded-3xl shadow-lg p-10 text-center max-w-sm w-full">
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-gray-900 text-2xl font-bold mb-2">Mission créée</h1>
        <p className="text-gray-500 text-sm">Email envoyé — TowSoft en cours de mise à jour</p>
        <div className="mt-6 w-full bg-gray-200 rounded-full h-1">
          <div className="bg-green-500 h-1 rounded-full animate-[width_2s_ease-in-out]" style={{width:'100%',transition:'width 2s'}} />
        </div>
      </div>
    </div>
  )

  // ── Écran sélection type ──────────────────────────────────────────────────
  if (!selectedType) return (
    <div className="min-h-screen bg-gray-50 px-4 pt-12 pb-8">
      <button onClick={() => router.push('/dashboard')} className="mb-6 text-gray-500 text-sm flex items-center gap-1">
        ← Retour
      </button>
      <h1 className="text-gray-900 text-2xl font-bold mb-1">Créer une mission</h1>
      <p className="text-gray-500 text-sm mb-8">Sélectionne le type d&apos;intervention</p>
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
    <div className="min-h-screen bg-gray-50 pb-32">
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
            <LInput label="Plaque" value={plate} onChange={v => setPlate(v.toUpperCase())} placeholder="1ABC234" required />
            <LInput label="VIN" value={vin} onChange={v => setVin(v.toUpperCase())} placeholder="Optionnel" />
          </div>

          {/* Marque */}
          <div>
            <label className="block text-gray-600 text-xs font-medium mb-1">Marque</label>
            <button onClick={() => { setShowBrands(true); setBrandSearch('') }}
              className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-left text-sm text-gray-900 flex items-center justify-between">
              <span className={brand ? 'text-gray-900' : 'text-gray-400'}>{brand || 'Sélectionner une marque'}</span>
              <span className="text-gray-400">▼</span>
            </button>
          </div>

          {/* Modèle */}
          {brand && (
            <div>
              <label className="block text-gray-600 text-xs font-medium mb-1">Modèle</label>
              <button onClick={() => { setShowModels(true); setModelSearch('') }}
                className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-left text-sm text-gray-900 flex items-center justify-between">
                <span className={model ? 'text-gray-900' : 'text-gray-400'}>{model || 'Sélectionner un modèle'}</span>
                <span className="text-gray-400">▼</span>
              </button>
            </div>
          )}
        </Section>

        {/* Intervention */}
        <Section title="Intervention">
          <div>
            <label className="block text-gray-600 text-xs font-medium mb-1">Lieu d&apos;intervention <span className="text-red-500">*</span></label>
            <div className="flex gap-2">
              <input ref={locationRef} value={location} onChange={e => setLocation(e.target.value)}
                placeholder="Rue, autoroute..."
                className="flex-1 bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-gray-900 text-sm outline-none focus:border-blue-500" />
              <button onClick={getGPS}
                className="px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-600 text-sm font-medium">
                🎯
              </button>
            </div>
          </div>
          <LSelect label="Zone de police" value={policeZone} onChange={setPoliceZone} options={POLICE_ZONES} />
          <LInput label="Nom du policier" value={officerName} onChange={setOfficerName} />
        </Section>

        {/* Propriétaire */}
        <Section title="Propriétaire (optionnel)">
          <div className="grid grid-cols-2 gap-3">
            <LInput label="Prénom" value={ownerFirstName} onChange={setOwnerFirstName} />
            <LInput label="Nom" value={ownerLastName} onChange={setOwnerLastName} />
          </div>
          <LInput label="Téléphone" value={ownerPhone} onChange={setOwnerPhone} type="tel" />
        </Section>

        {/* Remarques */}
        <Section title="Remarques">
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={3}
            placeholder="Observations..."
            className="w-full bg-white border border-gray-300 rounded-xl px-3 py-3 text-gray-900 text-sm outline-none resize-none focus:border-blue-500" />
        </Section>

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
            className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 text-sm hover:border-gray-400">
            📷 Ajouter des photos
          </button>
        </Section>

        {err && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">{err}</div>}
      </div>

      {/* Bottom button */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 border-t border-gray-200 px-4 py-4 shadow-lg">
        <button onClick={handleSubmit} disabled={loading}
          className={`w-full py-4 ${cfg!.color} disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-md`}>
          {loading ? '⏳ Création en cours...' : `${cfg!.icon} Créer la mission`}
        </button>
      </div>

      {/* Modal Marques */}
      {showBrands && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="bg-white w-full rounded-t-3xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">Sélectionner une marque</h2>
              <button onClick={() => setShowBrands(false)} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="px-4 py-2">
              <input value={brandSearch} onChange={e => setBrandSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full bg-gray-100 rounded-xl px-3 py-2.5 text-sm outline-none" autoFocus />
            </div>
            <div className="overflow-y-auto flex-1 px-4 pb-4">
              {filteredBrands.map(b => (
                <button key={b.id} onClick={() => {
                  setBrand(b.name); setSelectedBrandId(b.id); setModel(''); setShowBrands(false)
                }} className="w-full text-left py-3 border-b border-gray-100 text-gray-900 text-sm">
                  {b.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal Modèles */}
      {showModels && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="bg-white w-full rounded-t-3xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">{brand}</h2>
              <button onClick={() => setShowModels(false)} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="px-4 py-2">
              <input value={modelSearch} onChange={e => setModelSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full bg-gray-100 rounded-xl px-3 py-2.5 text-sm outline-none" autoFocus />
            </div>
            <div className="overflow-y-auto flex-1 px-4 pb-4">
              {filteredModels.map(m => (
                <button key={m.id} onClick={() => {
                  setModel(m.name); setShowModels(false)
                }} className="w-full text-left py-3 border-b border-gray-100 text-gray-900 text-sm">
                  {m.name}
                </button>
              ))}
              <button onClick={() => {
                setModel(''); setShowModels(false)
              }} className="w-full text-left py-3 text-gray-400 text-sm">
                Saisir manuellement →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
