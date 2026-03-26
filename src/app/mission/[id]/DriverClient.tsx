'use client'
// src/app/mission/[id]/DriverClient.tsx

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

// ── Supabase client (anon pour upload depuis le browser) ──────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ─────────────────────────────────────────────────────────────────────
type MissionStatus = 'new' | 'dispatching' | 'assigned' | 'accepted' | 'in_progress' | 'completed'
type MissionType   = 'depannage' | 'remorquage' | 'transport' | 'trajet_vide' | 'reparation_place' | 'autre' | string

interface Mission {
  id: string
  status: MissionStatus
  external_id?: string
  dossier_number?: string
  source?: string
  mission_type?: MissionType
  incident_type?: string
  incident_description?: string
  client_name?: string
  client_phone?: string
  vehicle_brand?: string
  vehicle_model?: string
  vehicle_plate?: string
  vehicle_vin?: string
  incident_address?: string
  incident_city?: string
  incident_lat?: number
  incident_lng?: number
  destination_address?: string
  destination_name?: string
  remarks_general?: string
  accepted_at?: string
  on_way_at?: string
  on_site_at?: string
  completed_at?: string
  assigned_at?: string
  amount_guaranteed?: number
  amount_currency?: string
}

interface Props {
  mission: Mission
  currentUserId: string
  isReadOnly?: boolean
}

// ── Constantes ────────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<string, { short: string; label: string; color: string }> = {
  depannage:         { short: 'DSP', label: 'Dépannage sur place', color: 'bg-orange-500' },
  remorquage:        { short: 'REM', label: 'Remorquage',          color: 'bg-blue-600' },
  transport:         { short: 'TRN', label: 'Transport',           color: 'bg-purple-600' },
  trajet_vide:       { short: 'TVD', label: 'Trajet vide',         color: 'bg-zinc-600' },
  reparation_place:  { short: 'RPL', label: 'Réparation sur place',color: 'bg-green-600' },
  autre:             { short: 'AUT', label: 'Autre',               color: 'bg-zinc-500' },
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  assigned:    { label: 'À accepter',  color: 'text-blue-400' },
  accepted:    { label: 'Acceptée',    color: 'text-indigo-400' },
  in_progress: { label: 'En cours',    color: 'text-orange-400' },
  completed:   { label: 'Terminée',    color: 'text-green-400' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mapsUrl(lat?: number, lng?: number, addr?: string, app: 'maps' | 'gmaps' | 'waze' = 'maps') {
  const q = lat && lng ? `${lat},${lng}` : encodeURIComponent(addr || '')
  if (!q) return null
  if (app === 'waze')  return `https://waze.com/ul?ll=${q}&navigate=yes`
  if (app === 'gmaps') return `https://www.google.com/maps?q=${q}`
  return `https://maps.apple.com/?q=${q}`
}

function fmt(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}

// ── Composants UI ─────────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  )
}

function SectionTitle({ icon, label }: { icon: string; label: string }) {
  return (
    <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-1.5">
      <span>{icon}</span>{label}
    </p>
  )
}

// ── Navigation Maps ────────────────────────────────────────────────────────────
function MapsButtons({ lat, lng, addr }: { lat?: number; lng?: number; addr?: string }) {
  if (!lat && !lng && !addr) return null
  return (
    <div className="flex gap-2 mt-2">
      {[
        { app: 'gmaps' as const, label: 'Google Maps', icon: '🗺️' },
        { app: 'waze'  as const, label: 'Waze',        icon: '🧭' },
        { app: 'maps'  as const, label: 'Plans',       icon: '📍' },
      ].map(({ app, label, icon }) => {
        const url = mapsUrl(lat, lng, addr, app)
        if (!url) return null
        return (
          <a key={app} href={url} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 bg-[#2a2a2a] hover:bg-[#333] px-3 py-1.5 rounded-xl text-xs text-white transition">
            <span>{icon}</span>{label}
          </a>
        )
      })}
    </div>
  )
}

// ── Timeline ──────────────────────────────────────────────────────────────────
function Timeline({ mission }: { mission: Mission }) {
  const steps = [
    { label: 'Assignée',  ts: mission.assigned_at,  icon: '👤' },
    { label: 'Acceptée',  ts: mission.accepted_at,  icon: '✅' },
    { label: 'En route',  ts: mission.on_way_at,    icon: '🚗' },
    { label: 'Sur place', ts: mission.on_site_at,   icon: '📍' },
    { label: 'Terminée',  ts: mission.completed_at, icon: '🏁' },
  ]
  return (
    <ol className="relative border-l border-[#2a2a2a] ml-2 space-y-3 pt-1">
      {steps.map((s, i) => (
        <li key={i} className={`ml-4 ${s.ts ? '' : 'opacity-30'}`}>
          <span className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full text-xs ring-2 ring-[#0F0F0F] ${
            s.ts ? 'bg-green-500/20 text-green-400' : 'bg-[#2a2a2a] text-zinc-500'
          }`}>{s.icon}</span>
          <div className="flex items-baseline gap-2">
            <span className={`text-sm ${s.ts ? 'font-semibold text-white' : 'text-zinc-500'}`}>{s.label}</span>
            {s.ts && <span className="text-xs text-zinc-500">{fmt(s.ts)}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

// ── Canvas Signature ──────────────────────────────────────────────────────────
function SignatureCanvas({ onSave }: { onSave: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing   = useRef(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  const getPos = (e: React.TouchEvent | React.MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    const src  = 'touches' in e ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  const start = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const pos = getPos(e, canvas)
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
    drawing.current = true
  }

  const move = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const pos = getPos(e, canvas)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'
    ctx.strokeStyle = '#ffffff'
    ctx.lineTo(pos.x, pos.y); ctx.stroke()
    setHasDrawn(true)
  }

  const end = () => { drawing.current = false }

  const clear = () => {
    const canvas = canvasRef.current; if (!canvas) return
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  const save = () => {
    const canvas = canvasRef.current; if (!canvas) return
    onSave(canvas.toDataURL('image/png'))
  }

  return (
    <div>
      <div className="border border-[#2a2a2a] rounded-xl overflow-hidden bg-[#111] mb-2">
        <canvas ref={canvasRef} width={340} height={160}
          className="w-full touch-none"
          onMouseDown={start} onMouseMove={move} onMouseUp={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
      </div>
      <div className="flex gap-2">
        <button onClick={clear}
          className="flex-1 py-2 bg-[#2a2a2a] hover:bg-[#333] text-zinc-400 rounded-xl text-sm transition">
          🗑️ Effacer
        </button>
        <button onClick={save} disabled={!hasDrawn}
          className="flex-1 py-2 bg-brand hover:bg-brand/80 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition">
          ✅ Valider
        </button>
      </div>
    </div>
  )
}

// ── Formulaire de clôture ─────────────────────────────────────────────────────
interface ClosingFormProps {
  mission:       Mission
  onSubmit:      (data: ClosingData) => Promise<void>
  loading:       boolean
}

interface ClosingData {
  finalMissionType:  string
  mileage:           string
  destinationAddr:   string
  extraAddresses:    string[]
  photos:            File[]
  signatureData:     string
  signatureName:     string
  note:              string
}

function ClosingForm({ mission, onSubmit, loading }: ClosingFormProps) {
  const [missionType,      setMissionType]      = useState(mission.mission_type || 'depannage')
  const [mileage,          setMileage]          = useState('')
  const [destinationAddr,  setDestinationAddr]  = useState(mission.destination_address || '')
  const [extraAddresses,   setExtraAddresses]   = useState<string[]>([])
  const [photos,           setPhotos]           = useState<File[]>([])
  const [photoPreviews,    setPhotoPreviews]     = useState<string[]>([])
  const [signatureData,    setSignatureData]     = useState('')
  const [signatureName,    setSignatureName]     = useState(mission.client_name || '')
  const [showSig,          setShowSig]          = useState(false)
  const [note,             setNote]             = useState('')
  const [errors,           setErrors]           = useState<string[]>([])
  const photoInput = useRef<HTMLInputElement>(null)

  const isRem = missionType === 'remorquage'
  const isDsp = missionType === 'depannage'

  const addPhoto = (files: FileList | null) => {
    if (!files) return
    const arr = Array.from(files)
    setPhotos(p => [...p, ...arr])
    arr.forEach(f => {
      const reader = new FileReader()
      reader.onload = e => setPhotoPreviews(p => [...p, e.target?.result as string])
      reader.readAsDataURL(f)
    })
  }

  const removePhoto = (i: number) => {
    setPhotos(p => p.filter((_, j) => j !== i))
    setPhotoPreviews(p => p.filter((_, j) => j !== i))
  }

  const validate = () => {
    const errs: string[] = []
    if (!mileage) errs.push('Le kilométrage est obligatoire')
    if (photos.length === 0) errs.push('Au moins une photo du véhicule est obligatoire')
    if (photos.length < 3) errs.push('Minimum 3 photos (châssis, plaque, véhicule général)')
    if (isRem && !destinationAddr) errs.push("L'adresse de destination est obligatoire pour un remorquage")
    setErrors(errs)
    return errs.length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return
    onSubmit({ finalMissionType: missionType, mileage, destinationAddr, extraAddresses, photos, signatureData, signatureName, note })
  }

  return (
    <div className="space-y-4">

      {/* Type de mission */}
      <Card>
        <SectionTitle icon="🔧" label="Type de mission" />
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(TYPE_LABELS).map(([key, val]) => (
            <button key={key} onClick={() => setMissionType(key)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition ${
                missionType === key
                  ? `${val.color} border-transparent text-white`
                  : 'border-[#2a2a2a] bg-[#111] text-zinc-400 hover:text-white'
              }`}>
              <span className="font-bold text-xs">{val.short}</span>
              <span className="truncate text-xs">{val.label}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Adresse destination (REM obligatoire) */}
      {isRem && (
        <Card>
          <SectionTitle icon="📍" label="Destination de remorquage" />
          <input
            value={destinationAddr}
            onChange={e => setDestinationAddr(e.target.value)}
            placeholder="Garage, domicile client, fourrière..."
            className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600"
          />
        </Card>
      )}

      {/* Adresses supplémentaires */}
      <Card>
        <SectionTitle icon="🗺️" label="Adresses supplémentaires" />
        {extraAddresses.map((addr, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input value={addr} onChange={e => {
              const a = [...extraAddresses]; a[i] = e.target.value; setExtraAddresses(a)
            }}
              className="flex-1 bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand"
              placeholder="Adresse..."
            />
            <button onClick={() => setExtraAddresses(a => a.filter((_, j) => j !== i))}
              className="w-9 h-9 flex items-center justify-center bg-red-500/10 text-red-400 rounded-xl text-sm">
              ✕
            </button>
          </div>
        ))}
        <button onClick={() => setExtraAddresses(a => [...a, ''])}
          className="w-full py-2 border border-dashed border-[#2a2a2a] rounded-xl text-zinc-500 hover:text-white text-sm transition">
          + Ajouter une adresse
        </button>
      </Card>

      {/* Kilométrage */}
      <Card>
        <SectionTitle icon="🔢" label="Kilométrage du véhicule" />
        <input
          type="number" inputMode="numeric"
          value={mileage} onChange={e => setMileage(e.target.value)}
          placeholder="Ex: 87450"
          className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600"
        />
      </Card>

      {/* Photos */}
      <Card>
        <SectionTitle icon="📷" label={`Photos du véhicule (${photos.length}/min. 3)`} />
        <p className="text-zinc-600 text-xs mb-3">Obligatoire : numéro de châssis, plaque, vue générale du véhicule</p>

        {photoPreviews.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {photoPreviews.map((src, i) => (
              <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                <img src={src} alt="" className="w-full h-full object-cover" />
                <button onClick={() => removePhoto(i)}
                  className="absolute top-1 right-1 w-6 h-6 bg-black/70 rounded-full text-white text-xs flex items-center justify-center">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <input ref={photoInput} type="file" accept="image/*" multiple capture="environment"
          className="hidden" onChange={e => addPhoto(e.target.files)} />
        <button onClick={() => photoInput.current?.click()}
          className="w-full py-3 border border-dashed border-[#2a2a2a] rounded-xl text-zinc-400 hover:text-white hover:border-brand text-sm transition flex items-center justify-center gap-2">
          <span>📸</span> Prendre des photos
        </button>
      </Card>

      {/* Signature */}
      <Card>
        <SectionTitle icon="✍️" label="Décharge / Signature client" />
        <p className="text-zinc-600 text-xs mb-3">
          Optionnelle — à utiliser en cas de dépannage dangereux, dépôt en lieu demandé par le client, etc.
        </p>

        <div className="mb-3">
          <label className="text-zinc-500 text-xs mb-1 block">Nom du client signataire</label>
          <input value={signatureName} onChange={e => setSignatureName(e.target.value)}
            placeholder="Prénom Nom"
            className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600"
          />
        </div>

        {!signatureData ? (
          <>
            {showSig ? (
              <SignatureCanvas onSave={d => { setSignatureData(d); setShowSig(false) }} />
            ) : (
              <button onClick={() => setShowSig(true)}
                className="w-full py-2.5 border border-dashed border-[#2a2a2a] rounded-xl text-zinc-400 hover:text-white text-sm transition">
                ✍️ Faire signer le client
              </button>
            )}
          </>
        ) : (
          <div>
            <div className="border border-green-500/30 rounded-xl overflow-hidden mb-2 bg-[#111]">
              <img src={signatureData} alt="Signature" className="w-full max-h-32 object-contain" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-green-400 text-xs">✅ Signature de {signatureName || 'client'}</span>
              <button onClick={() => { setSignatureData(''); setShowSig(false) }}
                className="text-zinc-500 hover:text-red-400 text-xs transition">Refaire</button>
            </div>
          </div>
        )}
      </Card>

      {/* Note */}
      <Card>
        <SectionTitle icon="📝" label="Note de mission (optionnel)" />
        <textarea rows={3} value={note} onChange={e => setNote(e.target.value)}
          placeholder="Remarques, difficultés rencontrées..."
          className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600 resize-none"
        />
      </Card>

      {/* Erreurs */}
      {errors.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
          {errors.map((e, i) => (
            <p key={i} className="text-red-400 text-sm">⚠️ {e}</p>
          ))}
        </div>
      )}

      {/* Bouton terminer */}
      <button onClick={handleSubmit} disabled={loading}
        className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-lg transition">
        {loading ? '⏳ Envoi en cours...' : '🏁 Terminer la mission'}
      </button>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function DriverClient({ mission: initial, isReadOnly = false }: Props) {
  const router = useRouter()
  const [mission,     setMission]     = useState<Mission>(initial)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [showClosing, setShowClosing] = useState(false)

  const typeInfo   = TYPE_LABELS[mission.mission_type || 'autre'] || TYPE_LABELS.autre
  const statusInfo = STATUS_LABELS[mission.status] || { label: mission.status, color: 'text-zinc-400' }

  // Upload photos vers Supabase Storage
  const uploadPhotos = async (missionId: string, files: File[]): Promise<string[]> => {
    const urls: string[] = []
    for (const file of files) {
      const ext  = file.name.split('.').pop() || 'jpg'
      const path = `${missionId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('mission-photos').upload(path, file)
      if (!error) {
        const { data } = supabase.storage.from('mission-photos').getPublicUrl(path)
        urls.push(data.publicUrl)
      }
    }
    return urls
  }

  const doAction = async (action: string) => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch('/api/missions/driver-action', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: mission.id, action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erreur serveur')
      setMission(json.mission)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  const handleComplete = async (data: ClosingData) => {
    setLoading(true); setError(null)
    try {
      // Upload des photos
      const photoUrls = await uploadPhotos(mission.id, data.photos)

      const res = await fetch('/api/missions/driver-action', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mission_id:   mission.id,
          action:       'completed',
          closing_data: {
            final_mission_type:  data.finalMissionType,
            mileage:             data.mileage ? parseInt(data.mileage) : undefined,
            destination_address: data.destinationAddr || undefined,
            extra_addresses:     data.extraAddresses.filter(Boolean),
            photo_urls:          photoUrls,
            signature_data:      data.signatureData || undefined,
            signature_name:      data.signatureName || undefined,
            closing_notes:       data.note || undefined,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erreur serveur')
      setMission(json.mission)
      setShowClosing(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  if (mission.status === 'completed') {
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl mb-4">🏁</div>
        <h1 className="text-white font-bold text-xl mb-2">Mission terminée</h1>
        <p className="text-zinc-500 text-sm mb-6">{mission.client_name} — {mission.vehicle_plate}</p>
        <button onClick={() => router.push('/mission')}
          className="px-6 py-3 bg-[#1A1A1A] border border-[#2a2a2a] text-white rounded-2xl text-sm">
          ← Retour à mes missions
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] pb-10">

      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 safe-top sticky top-0 z-20">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => router.push('/mission')}
            className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg">
            ←
          </button>
          <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${typeInfo.color}`}>
            {typeInfo.short} — {typeInfo.label}
          </span>
          <span className={`text-xs font-semibold ${statusInfo.color}`}>{statusInfo.label}</span>
        </div>

        <h1 className="text-white font-bold text-lg truncate">
          {mission.client_name || 'Client inconnu'}
        </h1>
        {mission.client_phone && (
          <a href={`tel:${mission.client_phone}`}
            className="text-brand text-sm font-medium flex items-center gap-1 mt-0.5">
            📞 {mission.client_phone}
          </a>
        )}
        {mission.dossier_number && (
          <p className="text-zinc-600 text-xs font-mono mt-0.5">{mission.dossier_number}</p>
        )}
      </div>

      <div className="px-4 mt-4 space-y-4">

        {/* Véhicule */}
        {(mission.vehicle_brand || mission.vehicle_plate) && (
          <Card>
            <SectionTitle icon="🚘" label="Véhicule" />
            <p className="text-white font-semibold">
              {[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')}
            </p>
            {mission.vehicle_plate && (
              <p className="text-zinc-400 text-xs font-mono uppercase tracking-widest mt-0.5">
                {mission.vehicle_plate}
              </p>
            )}
            {mission.vehicle_vin && (
              <p className="text-zinc-500 text-xs mt-0.5">VIN : {mission.vehicle_vin}</p>
            )}
          </Card>
        )}

        {/* Description */}
        {mission.incident_description && (
          <Card>
            <SectionTitle icon="📋" label="Description" />
            <p className="text-white text-sm whitespace-pre-wrap">{mission.incident_description}</p>
          </Card>
        )}

        {/* Lieu d'incident */}
        {(mission.incident_address || mission.incident_city) && (
          <Card>
            <SectionTitle icon="📍" label="Lieu d'intervention" />
            <p className="text-white text-sm">
              {mission.incident_address}{mission.incident_city ? `, ${mission.incident_city}` : ''}
            </p>
            <MapsButtons lat={mission.incident_lat} lng={mission.incident_lng} addr={mission.incident_address} />
          </Card>
        )}

        {/* Destination */}
        {mission.destination_address && (
          <Card>
            <SectionTitle icon="🏁" label="Destination" />
            <p className="text-zinc-400 text-xs mb-0.5">{mission.destination_name}</p>
            <p className="text-white text-sm">{mission.destination_address}</p>
            <MapsButtons addr={mission.destination_address} />
          </Card>
        )}

        {/* Remarques */}
        {mission.remarks_general && (
          <Card>
            <SectionTitle icon="📝" label="Remarques" />
            <p className="text-white text-sm whitespace-pre-wrap">{mission.remarks_general}</p>
          </Card>
        )}

        {/* Montant garanti */}
        {mission.amount_guaranteed != null && (
          <Card>
            <SectionTitle icon="💶" label="Montant garanti" />
            <p className="text-white font-bold text-xl">
              {mission.amount_guaranteed} {mission.amount_currency ?? '€'}
            </p>
          </Card>
        )}

        {/* Timeline */}
        <Card>
          <SectionTitle icon="🕐" label="Progression" />
          <Timeline mission={mission} />
        </Card>

        {/* Erreur */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">
            ⚠️ {error}
          </div>
        )}

        {/* Formulaire clôture */}
        {showClosing && (
          <ClosingForm mission={mission} onSubmit={handleComplete} loading={loading} />
        )}

        {/* CTA */}
        {!isReadOnly && !showClosing && (() => {
          if (mission.status === 'assigned') return (
            <button onClick={() => doAction('accept')} disabled={loading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-lg transition">
              {loading ? '⏳...' : '✅ Accepter la mission'}
            </button>
          )
          if (mission.status === 'accepted') return (
            <button onClick={() => doAction('on_way')} disabled={loading}
              className="w-full py-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-lg transition">
              {loading ? '⏳...' : '🚗 Je suis en route'}
            </button>
          )
          if (mission.status === 'in_progress' && !mission.on_site_at) return (
            <button onClick={() => doAction('on_site')} disabled={loading}
              className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-lg transition">
              {loading ? '⏳...' : '📍 Je suis sur place'}
            </button>
          )
          if (mission.status === 'in_progress' && mission.on_site_at) return (
            <button onClick={() => setShowClosing(true)}
              className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-2xl text-base shadow-lg transition">
              🏁 Terminer la mission
            </button>
          )
          return null
        })()}

      </div>
    </div>
  )
}
