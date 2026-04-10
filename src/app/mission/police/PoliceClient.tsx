'use client'
// src/app/mission/police/PoliceClient.tsx

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

type MissionType = 'accident' | 'saisie' | 'mal_garee' | 'snc'

const TYPE_CONFIG: Record<MissionType, { label: string; icon: string; color: string }> = {
  accident:  { label: 'Police Accident',     icon: '🚨', color: 'bg-red-600' },
  saisie:    { label: 'Saisie',              icon: '⚖️', color: 'bg-purple-600' },
  mal_garee: { label: 'Mal Garée',           icon: '🚫', color: 'bg-amber-600' },
  snc:       { label: 'Siabis Non Couvert',  icon: '🛣️', color: 'bg-blue-600' },
}

const POLICE_ZONES = ['Police Zone Vesdre', 'Police Zone Fagnes']

function now() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

export default function PoliceClient() {
  const router = useRouter()
  const [selectedType, setSelectedType] = useState<MissionType | null>(null)
  const { date: initDate, time: initTime } = now()

  // Form state
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
  const [success,        setSuccess]        = useState('')
  const photoRef = useRef<HTMLInputElement>(null)

  const addPhotos = (files: FileList | null) => {
    if (!files) return
    const newFiles = Array.from(files)
    setPhotos(p => [...p, ...newFiles])
    newFiles.forEach(f => {
      const r = new FileReader()
      r.onload = e => setPreviews(p => [...p, e.target?.result as string])
      r.readAsDataURL(f)
    })
  }

  const handleSubmit = async () => {
    if (!selectedType) return
    if (!location.trim()) { setErr('Le lieu d\'intervention est requis'); return }
    if (!plate && !vin) { setErr('Plaque ou VIN requis'); return }

    setLoading(true); setErr(''); setSuccess('')

    // Photos — pas d'upload bloquant, on passe les noms dans les remarques
    const photoUrls: string[] = []

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
      setSuccess(`✅ Mission TowSoft créée${data.missionNumber ? ` #${data.missionNumber}` : ''} — Email envoyé à la fourrière`)
      setTimeout(() => router.push('/mission'), 3000)
    } else {
      setErr(data.error || 'Erreur création TowSoft')
    }
  }

  const cfg = selectedType ? TYPE_CONFIG[selectedType] : null

  // ── Écran sélection du type ────────────────────────────────────────────────
  if (!selectedType) return (
    <div className="min-h-screen bg-[#0F0F0F] px-4 pt-12 pb-8">
      <button onClick={() => router.push('/mission')} className="mb-6 text-zinc-400 text-sm">← Retour</button>
      <h1 className="text-white text-2xl font-bold mb-2">Créer une mission</h1>
      <p className="text-zinc-500 text-sm mb-8">Sélectionne le type d&apos;intervention</p>
      <div className="space-y-3">
        {(Object.entries(TYPE_CONFIG) as [MissionType, typeof TYPE_CONFIG[MissionType]][]).map(([type, conf]) => (
          <button key={type} onClick={() => setSelectedType(type)}
            className={`w-full flex items-center gap-4 p-5 ${conf.color} rounded-2xl text-left active:scale-[0.98] transition`}>
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
    <div className="min-h-screen bg-[#0F0F0F] pb-32">
      {/* Header */}
      <div className={`${cfg!.color} px-4 pt-12 pb-5`}>
        <button onClick={() => setSelectedType(null)} className="mb-3 text-white/70 text-sm">← Changer de type</button>
        <h1 className="text-white text-xl font-bold">{cfg!.icon} {cfg!.label}</h1>
      </div>

      <div className="px-4 py-5 space-y-4">

        {/* Date/Heure */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 space-y-3">
          <p className="text-zinc-400 text-xs uppercase tracking-widest font-medium">Date & Heure</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-zinc-500 text-xs mb-1">Date</p>
              <input value={date} onChange={e => setDate(e.target.value)} placeholder="DD-MM-YYYY"
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-500" />
            </div>
            <div>
              <p className="text-zinc-500 text-xs mb-1">Heure</p>
              <input value={time} onChange={e => setTime(e.target.value)} placeholder="HH:MM"
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-500" />
            </div>
          </div>
        </div>

        {/* Véhicule */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 space-y-3">
          <p className="text-zinc-400 text-xs uppercase tracking-widest font-medium">Véhicule</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-zinc-500 text-xs mb-1">Plaque</p>
              <input value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} placeholder="1ABC234"
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm font-mono outline-none focus:border-red-500" />
            </div>
            <div>
              <p className="text-zinc-500 text-xs mb-1">VIN (optionnel)</p>
              <input value={vin} onChange={e => setVin(e.target.value.toUpperCase())}
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm font-mono outline-none focus:border-red-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-zinc-500 text-xs mb-1">Marque</p>
              <input value={brand} onChange={e => setBrand(e.target.value)}
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-500" />
            </div>
            <div>
              <p className="text-zinc-500 text-xs mb-1">Modèle</p>
              <input value={model} onChange={e => setModel(e.target.value)}
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-500" />
            </div>
          </div>
        </div>

        {/* Intervention */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 space-y-3">
          <p className="text-zinc-400 text-xs uppercase tracking-widest font-medium">Intervention</p>
          <div>
            <p className="text-zinc-500 text-xs mb-1">Lieu d&apos;intervention *</p>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Rue, autoroute..."
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-500" />
          </div>
          <div>
            <p className="text-zinc-500 text-xs mb-1">Zone de police</p>
            <select value={policeZone} onChange={e => setPoliceZone(e.target.value)}
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-500">
              {POLICE_ZONES.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <p className="text-zinc-500 text-xs mb-1">Nom du policier</p>
            <input value={officerName} onChange={e => setOfficerName(e.target.value)}
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-500" />
          </div>
        </div>

        {/* Propriétaire */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 space-y-3">
          <p className="text-zinc-400 text-xs uppercase tracking-widest font-medium">Propriétaire <span className="text-zinc-600 normal-case tracking-normal font-normal">(optionnel)</span></p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-zinc-500 text-xs mb-1">Prénom</p>
              <input value={ownerFirstName} onChange={e => setOwnerFirstName(e.target.value)}
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-500" />
            </div>
            <div>
              <p className="text-zinc-500 text-xs mb-1">Nom</p>
              <input value={ownerLastName} onChange={e => setOwnerLastName(e.target.value)}
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-500" />
            </div>
          </div>
          <div>
            <p className="text-zinc-500 text-xs mb-1">Téléphone</p>
            <input value={ownerPhone} onChange={e => setOwnerPhone(e.target.value)} type="tel"
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-500" />
          </div>
        </div>

        {/* Remarques */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
          <p className="text-zinc-400 text-xs uppercase tracking-widest font-medium mb-3">Remarques</p>
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={3}
            placeholder="Observations..."
            className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm outline-none resize-none focus:border-red-500" />
        </div>

        {/* Photos */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
          <p className="text-zinc-400 text-xs uppercase tracking-widest font-medium mb-3">Photos ({photos.length})</p>
          {previews.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {previews.map((src, i) => (
                <div key={i} className="aspect-square rounded-xl overflow-hidden relative">
                  <img src={src} className="w-full h-full object-cover" />
                  <button onClick={() => {
                    setPhotos(p => p.filter((_, j) => j !== i))
                    setPreviews(p => p.filter((_, j) => j !== i))
                  }} className="absolute top-1 right-1 w-6 h-6 bg-black/70 rounded-full text-white text-xs flex items-center justify-center">✕</button>
                </div>
              ))}
            </div>
          )}
          <input ref={photoRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => addPhotos(e.target.files)} />
          <button onClick={() => photoRef.current?.click()}
            className="w-full py-3 border-2 border-dashed border-[#2a2a2a] rounded-xl text-zinc-400 text-sm hover:border-zinc-500">
            📷 Ajouter des photos
          </button>
        </div>

        {err && <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{err}</div>}
        {success && <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">{success}</div>}
      </div>

      {/* Bottom button */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4">
        <button onClick={handleSubmit} disabled={loading}
          className={`w-full py-4 ${cfg!.color} disabled:opacity-50 text-white font-bold rounded-2xl text-base`}>
          {loading ? '⏳ Création en cours...' : `${cfg!.icon} Créer la mission`}
        </button>
      </div>
    </div>
  )
}
