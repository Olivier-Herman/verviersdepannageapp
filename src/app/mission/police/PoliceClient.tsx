'use client'
// src/app/mission/police/PoliceClient.tsx

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type MissionType = 'accident' | 'saisie' | 'mal_garee' | 'snc' | 'appel_prive' | 'assistance'
type AssistanceCompany = 'touring' | 'vab' | 'ima' | 'mondial' | 'ipa'
type InterventionType = 'dsp' | 'rem' | 'rem_parc'
type Screen = 'type' | 'company' | 'intervention' | 'form' | 'success'

const TYPE_CONFIG: Record<MissionType, { label: string; icon: string; color: string; hidePolice?: boolean }> = {
  accident:    { label: 'Police Accident',    icon: '🚨', color: 'bg-red-600' },
  saisie:      { label: 'Saisie',             icon: '⚖️', color: 'bg-purple-600' },
  mal_garee:   { label: 'Mal Garée',          icon: '🚫', color: 'bg-amber-600' },
  snc:         { label: 'Siabis Non Couvert', icon: '🛣️', color: 'bg-blue-600' },
  appel_prive: { label: 'Appel Privé',        icon: '📞', color: 'bg-green-800', hidePolice: true },
  assistance:  { label: 'Assistance',         icon: '🤝', color: 'bg-teal-600', hidePolice: true },
}

const COMPANY_CONFIG: Record<AssistanceCompany, { label: string; icon: string }> = {
  touring: { label: 'Touring',  icon: '🔵' },
  vab:     { label: 'VAB',      icon: '🟡' },
  ima:     { label: 'IMA',      icon: '🟠' },
  mondial: { label: 'Mondial',  icon: '🌍' },
  ipa:     { label: 'IPA',      icon: '🔷' },
}

const INTERVENTION_CONFIG: Record<InterventionType, { label: string; icon: string; hasDestination: boolean }> = {
  dsp:      { label: 'DSP — Dépannage sur place', icon: '🔧', hasDestination: false },
  rem:      { label: 'REM — Remorquage',          icon: '🚛', hasDestination: true },
  rem_parc: { label: 'REM + Parc',                icon: '🏭', hasDestination: true },
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

function AddressField({ label, value, onChange, required }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const acRef = useRef<any>(null)

  useEffect(() => {
    const init = () => {
      if (!window.google?.maps?.places || !inputRef.current || acRef.current) return
      acRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ['address'],
        componentRestrictions: { country: ['be', 'lu', 'nl', 'de', 'fr'] },
      })
      acRef.current.addListener('place_changed', () => {
        const place = acRef.current.getPlace()
        if (place?.formatted_address) onChange(place.formatted_address)
      })
    }
    if (window.google?.maps?.places) init()
    else {
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
  }, [])

  const getGPS = useCallback(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`,
            { headers: { 'Accept-Language': 'fr' } }
          )
          const data = await res.json()
          onChange(data.display_name || `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`)
        } catch {
          onChange(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`)
        }
      },
      err => { console.error('GPS error:', err.code, err.message) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [onChange])

  return (
    <div>
      <label className="block text-gray-600 text-xs font-medium mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="flex gap-2">
        <input ref={inputRef} value={value} onChange={e => onChange(e.target.value)}
          placeholder="Rue, autoroute..."
          className="flex-1 bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-gray-900 text-sm outline-none focus:border-blue-500" />
        <button onClick={getGPS}
          className="px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-600 text-sm font-medium">
          🎯
        </button>
      </div>
    </div>
  )
}

export default function PoliceClient({ userRole = 'driver' }: { userRole?: string }) {
  const isSuperAdmin = userRole === 'superadmin'
  const router = useRouter()
  const [screen, setScreen] = useState<Screen>('type')
  const [selectedType, setSelectedType] = useState<MissionType | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<AssistanceCompany | null>(null)
  const [selectedIntervention, setSelectedIntervention] = useState<InterventionType | null>(null)
  const { date: initDate, time: initTime } = nowFormatted()

  const [date,           setDate]           = useState(initDate)
  const [time,           setTime]           = useState(initTime)
  const [dossierNumber,  setDossierNumber]  = useState('')
  const [plate,          setPlate]          = useState('')
  const [vin,            setVin]            = useState('')
  const [brand,          setBrand]          = useState('')
  const [model,          setModel]          = useState('')
  const [location,       setLocation]       = useState('')
  const [destination,    setDestination]    = useState('')
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

  // Brands/Models from Odoo
  const [brands,          setBrands]          = useState<{id:number;name:string}[]>([])
  const [models,          setModels]          = useState<{id:number;name:string}[]>([])
  const [selectedBrandId, setSelectedBrandId] = useState<number|null>(null)
  const [showBrands,      setShowBrands]      = useState(false)
  const [showModels,      setShowModels]      = useState(false)
  const [brandSearch,     setBrandSearch]     = useState('')
  const [modelSearch,     setModelSearch]     = useState('')

  const photoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/vehicles?type=brands')
      .then(r => r.json()).then(d => setBrands(d || []))
  }, [])

  useEffect(() => {
    if (!selectedBrandId) { setModels([]); return }
    fetch(`/api/vehicles?type=models&brandId=${selectedBrandId}`)
      .then(r => r.json()).then(d => setModels(d || []))
  }, [selectedBrandId])

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

  const cfg = selectedType ? TYPE_CONFIG[selectedType] : null
  const isAssistance = selectedType === 'assistance'
  const needsDestination = isAssistance && (selectedIntervention === 'rem' || selectedIntervention === 'rem_parc')
  const hidePolice = cfg?.hidePolice || isAssistance

  const handleSubmit = async () => {
    if (!selectedType) return
    if (!location.trim()) { setErr("Le lieu d'intervention est requis"); return }
    if (!plate && !vin)   { setErr('Plaque ou VIN requis'); return }

    setLoading(true); setErr('')

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
        type: selectedType,
        company: selectedCompany,
        interventionType: selectedIntervention,
        date, time,
        dossierNumber: dossierNumber || '',
        plate, vin, brand, model,
        location,
        destination: destination || '',
        policeZone, officerName,
        ownerFirstName, ownerLastName, ownerPhone,
        remarks, photoUrls,
      }),
    })

    const data = await res.json()
    setLoading(false)

    if (data.ok) {
      setScreen('success')
      setTimeout(() => router.push('/dashboard'), 2000)
    } else {
      setErr(data.error || 'Erreur création')
    }
  }

  // ── Écran succès ──────────────────────────────────────────
  if (screen === 'success') return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="bg-white rounded-3xl shadow-lg p-10 text-center max-w-sm w-full">
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-gray-900 text-2xl font-bold mb-2">Mission créée</h1>
        <p className="text-gray-500 text-sm">Email envoyé — TowSoft en cours de mise à jour</p>
      </div>
    </div>
  )

  // ── Écran sélection type ──────────────────────────────────
  if (screen === 'type') return (
    <div className="min-h-screen bg-gray-50 px-4 pt-12 pb-8">
      <button onClick={() => router.push('/dashboard')} className="mb-6 text-gray-500 text-sm">← Retour</button>
      <h1 className="text-gray-900 text-2xl font-bold mb-1">Créer une mission</h1>
      <p className="text-gray-500 text-sm mb-8">Sélectionne le type d&apos;intervention</p>
      <div className="space-y-3">
        {(Object.entries(TYPE_CONFIG) as [MissionType, typeof TYPE_CONFIG[MissionType]][]).map(([type, conf]) => {
          if (type === 'assistance' && !isSuperAdmin) return null
          return (
            <button key={type} onClick={() => {
              setSelectedType(type)
              if (type === 'assistance') setScreen('company')
              else setScreen('form')
            }}
              className={`w-full flex items-center gap-4 p-5 ${conf.color} rounded-2xl text-left active:scale-[0.98] transition shadow-md`}>
              <span className="text-3xl">{conf.icon}</span>
              <span className="text-white font-bold text-lg">{conf.label}</span>
              <span className="ml-auto text-white/70 text-xl">›</span>
            </button>
          )
        })}
      </div>
    </div>
  )

  // ── Écran sélection compagnie ─────────────────────────────
  if (screen === 'company') return (
    <div className="min-h-screen bg-gray-50 px-4 pt-12 pb-8">
      <button onClick={() => setScreen('type')} className="mb-6 text-gray-500 text-sm">← Retour</button>
      <h1 className="text-gray-900 text-2xl font-bold mb-1">Assistance</h1>
      <p className="text-gray-500 text-sm mb-8">Sélectionne la compagnie</p>
      <div className="space-y-3">
        {(Object.entries(COMPANY_CONFIG) as [AssistanceCompany, typeof COMPANY_CONFIG[AssistanceCompany]][]).map(([company, conf]) => (
          <button key={company} onClick={() => { setSelectedCompany(company); setScreen('intervention') }}
            className="w-full flex items-center gap-4 p-5 bg-teal-600 rounded-2xl text-left active:scale-[0.98] transition shadow-md">
            <span className="text-3xl">{conf.icon}</span>
            <span className="text-white font-bold text-lg">{conf.label}</span>
            <span className="ml-auto text-white/70 text-xl">›</span>
          </button>
        ))}
      </div>
    </div>
  )

  // ── Écran sélection type intervention ─────────────────────
  if (screen === 'intervention') return (
    <div className="min-h-screen bg-gray-50 px-4 pt-12 pb-8">
      <button onClick={() => setScreen('company')} className="mb-6 text-gray-500 text-sm">← Retour</button>
      <h1 className="text-gray-900 text-2xl font-bold mb-1">
        {selectedCompany ? COMPANY_CONFIG[selectedCompany].label : 'Assistance'}
      </h1>
      <p className="text-gray-500 text-sm mb-8">Type d&apos;intervention</p>
      <div className="space-y-3">
        {(Object.entries(INTERVENTION_CONFIG) as [InterventionType, typeof INTERVENTION_CONFIG[InterventionType]][]).map(([itype, conf]) => (
          <button key={itype} onClick={() => { setSelectedIntervention(itype); setScreen('form') }}
            className="w-full flex items-center gap-4 p-5 bg-teal-600 rounded-2xl text-left active:scale-[0.98] transition shadow-md">
            <span className="text-3xl">{conf.icon}</span>
            <span className="text-white font-bold text-lg">{conf.label}</span>
            <span className="ml-auto text-white/70 text-xl">›</span>
          </button>
        ))}
      </div>
    </div>
  )

  // ── Formulaire ─────────────────────────────────────────────
  const headerColor = isAssistance ? 'bg-teal-600' : (cfg?.color || 'bg-gray-600')
  const headerLabel = isAssistance
    ? `${selectedCompany ? COMPANY_CONFIG[selectedCompany].label : ''} — ${selectedIntervention ? INTERVENTION_CONFIG[selectedIntervention].label : ''}`
    : `${cfg?.icon} ${cfg?.label}`

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* Header */}
      <div className={`${headerColor} px-4 pt-12 pb-5 shadow-md`}>
        <button onClick={() => isAssistance ? setScreen('intervention') : setScreen('type')}
          className="mb-3 text-white/80 text-sm">← Changer</button>
        <h1 className="text-white text-xl font-bold">{headerLabel}</h1>
      </div>

      <div className="px-4 py-5 space-y-4">

        {/* Date/Heure */}
        <Section title="Date & Heure">
          <div className="grid grid-cols-2 gap-3">
            <LInput label="Date" value={date} onChange={setDate} placeholder="DD-MM-YYYY" />
            <LInput label="Heure" value={time} onChange={setTime} placeholder="HH:MM" />
          </div>
        </Section>

        {/* N° Dossier (assistance uniquement) */}
        {isAssistance && (
          <Section title="Dossier">
            <LInput label="N° Dossier (optionnel)" value={dossierNumber} onChange={setDossierNumber} placeholder="Ex: 12345" />
          </Section>
        )}

        {/* Véhicule */}
        <Section title="Véhicule">
          <div className="grid grid-cols-2 gap-3">
            <LInput label="Plaque" value={plate} onChange={v => setPlate(v.toUpperCase())} placeholder="1ABC234" required />
            <LInput label="VIN" value={vin} onChange={v => setVin(v.toUpperCase())} placeholder="Optionnel" />
          </div>
          <div>
            <label className="block text-gray-600 text-xs font-medium mb-1">Marque</label>
            <button onClick={() => { setShowBrands(true); setBrandSearch('') }}
              className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-left text-sm text-gray-900 flex items-center justify-between">
              <span className={brand ? 'text-gray-900' : 'text-gray-400'}>{brand || 'Sélectionner une marque'}</span>
              <span className="text-gray-400">▼</span>
            </button>
          </div>
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
          <AddressField label="Lieu d'intervention" value={location} onChange={setLocation} required />
          {needsDestination && (
            <AddressField label="Adresse de remorquage (optionnel)" value={destination} onChange={setDestination} />
          )}
          {!hidePolice && (
            <>
              <LSelect label="Zone de police" value={policeZone} onChange={setPoliceZone} options={POLICE_ZONES} />
              <LInput label="Nom du policier" value={officerName} onChange={setOfficerName} />
            </>
          )}
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
          className={`w-full py-4 ${headerColor} disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-md`}>
          {loading ? '⏳ Création en cours...' : `Créer la mission`}
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
                placeholder="Rechercher..." className="w-full bg-gray-100 rounded-xl px-3 py-2.5 text-sm outline-none" autoFocus />
            </div>
            <div className="overflow-y-auto flex-1 px-4 pb-4">
              {filteredBrands.map(b => (
                <button key={b.id} onClick={() => {
                  setBrand(b.name); setSelectedBrandId(b.id); setModel(''); setShowBrands(false)
                }} className="w-full text-left py-3 border-b border-gray-100 text-gray-900 text-sm">{b.name}</button>
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
                placeholder="Rechercher..." className="w-full bg-gray-100 rounded-xl px-3 py-2.5 text-sm outline-none" autoFocus />
            </div>
            <div className="overflow-y-auto flex-1 px-4 pb-4">
              {filteredModels.map(m => (
                <button key={m.id} onClick={() => { setModel(m.name); setShowModels(false) }}
                  className="w-full text-left py-3 border-b border-gray-100 text-gray-900 text-sm">{m.name}</button>
              ))}
              <button onClick={() => { setModel(''); setShowModels(false) }}
                className="w-full text-left py-3 text-gray-400 text-sm">Saisir manuellement →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
