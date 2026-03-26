'use client'
// src/app/mission/[id]/DriverClient.tsx

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ─────────────────────────────────────────────────────────────────────
type MissionStatus = 'new'|'dispatching'|'assigned'|'accepted'|'in_progress'|'parked'|'completed'

interface Mission {
  id: string; status: MissionStatus
  external_id?: string; dossier_number?: string; source?: string
  mission_type?: string; incident_type?: string; incident_description?: string
  client_name?: string; client_phone?: string
  vehicle_brand?: string; vehicle_model?: string; vehicle_plate?: string; vehicle_vin?: string
  incident_address?: string; incident_city?: string; incident_lat?: number; incident_lng?: number
  destination_address?: string; destination_name?: string
  remarks_general?: string
  accepted_at?: string; on_way_at?: string; on_site_at?: string
  completed_at?: string; assigned_at?: string; parked_at?: string
  amount_guaranteed?: number; amount_currency?: string
  park_stage_name?: string
}

interface FleetStage { id: number; name: string }
interface Props { mission: Mission; currentUserId: string; isReadOnly?: boolean }

// ── Constantes ────────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<string, { short: string; label: string; color: string }> = {
  depannage:        { short: 'DSP', label: 'Dépannage sur place', color: 'bg-orange-500' },
  remorquage:       { short: 'REM', label: 'Remorquage',          color: 'bg-blue-600'   },
  transport:        { short: 'TRN', label: 'Transport',           color: 'bg-purple-600' },
  trajet_vide:      { short: 'TVD', label: 'Trajet vide',         color: 'bg-zinc-600'   },
  reparation_place: { short: 'RPL', label: 'Réparation sur place',color: 'bg-green-600'  },
  autre:            { short: 'AUT', label: 'Autre',               color: 'bg-zinc-500'   },
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  assigned:    { label: 'À accepter',    color: 'text-blue-400',   bg: 'bg-blue-500/10'   },
  accepted:    { label: 'Acceptée',      color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
  in_progress: { label: 'En cours',      color: 'text-orange-400', bg: 'bg-orange-500/10' },
  parked:      { label: 'En dépôt',      color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  completed:   { label: 'Terminée',      color: 'text-green-400',  bg: 'bg-green-500/10'  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mapsUrl(lat?: number, lng?: number, addr?: string, app: 'gmaps'|'waze'|'apple' = 'gmaps') {
  const q = lat && lng ? `${lat},${lng}` : encodeURIComponent(addr || '')
  if (!q) return null
  if (app === 'waze')  return `https://waze.com/ul?ll=${q}&navigate=yes`
  if (app === 'apple') return `https://maps.apple.com/?q=${q}`
  return `https://www.google.com/maps?q=${q}`
}
function fmt(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}

// ── UI Helpers ────────────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 ${className}`}>{children}</div>
}
function Label({ icon, text }: { icon: string; text: string }) {
  return <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5"><span>{icon}</span>{text}</p>
}
function MapsRow({ lat, lng, addr }: { lat?: number; lng?: number; addr?: string }) {
  if (!lat && !lng && !addr) return null
  return (
    <div className="flex gap-2 mt-2 flex-wrap">
      {([['gmaps','Google Maps','🗺️'],['waze','Waze','🧭'],['apple','Plans','📍']] as const).map(([app,label,icon]) => {
        const url = mapsUrl(lat, lng, addr, app)
        return url ? (
          <a key={app} href={url} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 bg-[#2a2a2a] hover:bg-[#333] px-3 py-1.5 rounded-xl text-xs text-white transition">
            <span>{icon}</span>{label}
          </a>
        ) : null
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
    ...(mission.parked_at ? [{ label: `En dépôt${mission.park_stage_name ? ` — ${mission.park_stage_name}` : ''}`, ts: mission.parked_at, icon: '🅿️' }] : []),
    { label: 'Terminée',  ts: mission.completed_at, icon: '🏁' },
  ]
  return (
    <ol className="relative border-l border-[#2a2a2a] ml-2 space-y-3 pt-1">
      {steps.map((s, i) => (
        <li key={i} className={`ml-4 ${s.ts ? '' : 'opacity-30'}`}>
          <span className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full text-xs ring-2 ring-[#0F0F0F] ${s.ts ? 'bg-green-500/20 text-green-400' : 'bg-[#2a2a2a] text-zinc-500'}`}>{s.icon}</span>
          <div className="flex items-baseline gap-2">
            <span className={`text-sm ${s.ts ? 'font-semibold text-white' : 'text-zinc-500'}`}>{s.label}</span>
            {s.ts && <span className="text-xs text-zinc-500">{fmt(s.ts)}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

// ── Signature Canvas ──────────────────────────────────────────────────────────
function SignatureCanvas({ onSave }: { onSave: (d: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [drawn, setDrawn] = useState(false)

  const pos = (e: React.TouchEvent|React.MouseEvent, c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect()
    const s = 'touches' in e ? e.touches[0] : e
    return { x: s.clientX - r.left, y: s.clientY - r.top }
  }
  const start = (e: React.TouchEvent|React.MouseEvent) => {
    e.preventDefault()
    const c = ref.current; if (!c) return
    const p = pos(e, c)
    c.getContext('2d')!.beginPath(); c.getContext('2d')!.moveTo(p.x, p.y)
    drawing.current = true
  }
  const move = (e: React.TouchEvent|React.MouseEvent) => {
    e.preventDefault()
    if (!drawing.current) return
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    const p = pos(e, c)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#fff'
    ctx.lineTo(p.x, p.y); ctx.stroke(); setDrawn(true)
  }
  const end = () => { drawing.current = false }
  const clear = () => {
    const c = ref.current; if (!c) return
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setDrawn(false)
  }

  return (
    <div>
      <div className="border border-[#2a2a2a] rounded-xl overflow-hidden bg-[#111] mb-2">
        <canvas ref={ref} width={340} height={140} className="w-full touch-none"
          onMouseDown={start} onMouseMove={move} onMouseUp={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
      </div>
      <div className="flex gap-2">
        <button onClick={clear} className="flex-1 py-2 bg-[#2a2a2a] text-zinc-400 rounded-xl text-sm">🗑️ Effacer</button>
        <button onClick={() => ref.current && onSave(ref.current.toDataURL())} disabled={!drawn}
          className="flex-1 py-2 bg-brand disabled:opacity-40 text-white rounded-xl text-sm font-semibold">✅ Valider</button>
      </div>
    </div>
  )
}

// ── Modal Dépôt ───────────────────────────────────────────────────────────────
function ParkModal({ stages, onClose, onSubmit, loading }: {
  stages:   FleetStage[]
  onClose:  () => void
  onSubmit: (stageId: number, stageName: string, notes: string) => void
  loading:  boolean
}) {
  const [stageId,   setStageId]   = useState<number | null>(null)
  const [stageName, setStageName] = useState('')
  const [notes,     setNotes]     = useState('')

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end" onClick={onClose}>
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 space-y-4 max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-white font-bold text-lg">🅿️ Mettre en dépôt</h2>
          <button onClick={onClose} className="text-zinc-500 text-2xl">×</button>
        </div>

        <div>
          <Label icon="📦" text="Parc de destination" />
          {stages.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {stages.map(s => (
                <button key={s.id} onClick={() => { setStageId(s.id); setStageName(s.name) }}
                  className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition text-left ${
                    stageId === s.id
                      ? 'bg-brand border-brand text-white'
                      : 'border-[#2a2a2a] bg-[#111] text-zinc-400 hover:text-white'
                  }`}>
                  {s.name}
                </button>
              ))}
            </div>
          ) : (
            <input value={stageName} onChange={e => setStageName(e.target.value)}
              placeholder="Nom du parc..."
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand"
            />
          )}
        </div>

        <div>
          <Label icon="📝" text="Notes (optionnel)" />
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Remarques sur le dépôt..."
            className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand resize-none"
          />
        </div>

        <button
          onClick={() => stageId && onSubmit(stageId, stageName, notes)}
          disabled={loading || (!stageId && !stageName)}
          className="w-full py-3 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-40 text-black font-bold rounded-xl text-sm transition">
          {loading ? '⏳ En cours...' : '🅿️ Confirmer le dépôt'}
        </button>
      </div>
    </div>
  )
}

// ── Modal Clôture ─────────────────────────────────────────────────────────────
function CloseModal({ mission, onClose, onSubmit, loading }: {
  mission:  Mission
  onClose:  () => void
  onSubmit: (data: ClosingData) => void
  loading:  boolean
}) {
  const [missionType,     setMissionType]     = useState(mission.mission_type || 'depannage')
  const [mileage,         setMileage]         = useState('')
  const [destinationAddr, setDestinationAddr] = useState(mission.destination_address || '')
  const [extraAddresses,  setExtraAddresses]  = useState<string[]>([])
  const [photos,          setPhotos]          = useState<File[]>([])
  const [photoPreviews,   setPhotoPreviews]   = useState<string[]>([])
  const [signatureData,   setSignatureData]   = useState('')
  const [signatureName,   setSignatureName]   = useState(mission.client_name || '')
  const [showSig,         setShowSig]         = useState(false)
  const [note,            setNote]            = useState('')
  const [errors,          setErrors]          = useState<string[]>([])
  const photoInput = useRef<HTMLInputElement>(null)

  const isRem = missionType === 'remorquage'

  const addPhoto = (files: FileList | null) => {
    if (!files) return
    const arr = Array.from(files)
    setPhotos(p => [...p, ...arr])
    arr.forEach(f => {
      const r = new FileReader()
      r.onload = e => setPhotoPreviews(p => [...p, e.target?.result as string])
      r.readAsDataURL(f)
    })
  }

  const validate = () => {
    const errs: string[] = []
    if (!mileage)               errs.push('Kilométrage obligatoire')
    if (photos.length === 0)    errs.push('Au moins une photo obligatoire')
    if (photos.length < 3)      errs.push('Minimum 3 photos (châssis, plaque, véhicule général)')
    if (isRem && !destinationAddr) errs.push('Adresse de destination obligatoire (remorquage)')
    setErrors(errs); return errs.length === 0
  }

  const submit = () => {
    if (!validate()) return
    onSubmit({ finalMissionType: missionType, mileage, destinationAddr, extraAddresses, photos, signatureData, signatureName, note })
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end overflow-hidden">
      <div className="bg-[#0F0F0F] w-full rounded-t-3xl max-h-[92vh] flex flex-col">

        {/* Header modal */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[#2a2a2a] flex-shrink-0">
          <h2 className="text-white font-bold text-lg">🏁 Clôture de mission</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-2xl">×</button>
        </div>

        {/* Récapitulatif mission */}
        <div className="px-5 py-3 bg-[#1A1A1A] border-b border-[#2a2a2a] flex-shrink-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold text-white ${TYPE_LABELS[mission.mission_type||'autre'].color}`}>
              {TYPE_LABELS[mission.mission_type||'autre'].short}
            </span>
            <span className="text-white font-semibold text-sm truncate">{mission.client_name}</span>
            {mission.vehicle_plate && (
              <span className="text-zinc-400 text-xs font-mono">{mission.vehicle_plate}</span>
            )}
            {mission.incident_address && (
              <span className="text-zinc-500 text-xs truncate">{mission.incident_address}</span>
            )}
          </div>
        </div>

        {/* Formulaire scrollable */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Type mission */}
          <div>
            <Label icon="🔧" text="Type de mission" />
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(TYPE_LABELS).map(([key, val]) => (
                <button key={key} onClick={() => setMissionType(key)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition ${
                    missionType === key ? `${val.color} border-transparent text-white` : 'border-[#2a2a2a] bg-[#111] text-zinc-400 hover:text-white'
                  }`}>
                  <span className="font-bold text-xs">{val.short}</span>
                  <span className="truncate text-xs">{val.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Destination REM */}
          {isRem && (
            <div>
              <Label icon="📍" text="Destination de remorquage *" />
              <input value={destinationAddr} onChange={e => setDestinationAddr(e.target.value)}
                placeholder="Garage, domicile, fourrière..."
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand"
              />
            </div>
          )}

          {/* Adresses supplémentaires */}
          <div>
            <Label icon="🗺️" text="Adresses supplémentaires" />
            {extraAddresses.map((addr, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input value={addr} onChange={e => {
                  const a = [...extraAddresses]; a[i] = e.target.value; setExtraAddresses(a)
                }} className="flex-1 bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand" placeholder="Adresse..." />
                <button onClick={() => setExtraAddresses(a => a.filter((_, j) => j !== i))}
                  className="w-9 h-9 flex items-center justify-center bg-red-500/10 text-red-400 rounded-xl text-sm">✕</button>
              </div>
            ))}
            <button onClick={() => setExtraAddresses(a => [...a, ''])}
              className="w-full py-2 border border-dashed border-[#2a2a2a] rounded-xl text-zinc-500 hover:text-white text-sm transition">
              + Ajouter une adresse
            </button>
          </div>

          {/* Kilométrage */}
          <div>
            <Label icon="🔢" text="Kilométrage du véhicule *" />
            <input type="number" inputMode="numeric" value={mileage} onChange={e => setMileage(e.target.value)}
              placeholder="Ex: 87450"
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand"
            />
          </div>

          {/* Photos */}
          <div>
            <Label icon="📷" text={`Photos du véhicule * (${photos.length}/min.3)`} />
            <p className="text-zinc-600 text-xs mb-2">Châssis, plaque, vue générale obligatoires</p>
            {photoPreviews.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                {photoPreviews.map((src, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => {
                      setPhotos(p => p.filter((_, j) => j !== i))
                      setPhotoPreviews(p => p.filter((_, j) => j !== i))
                    }} className="absolute top-1 right-1 w-6 h-6 bg-black/70 rounded-full text-white text-xs flex items-center justify-center">✕</button>
                  </div>
                ))}
              </div>
            )}
            <input ref={photoInput} type="file" accept="image/*" multiple capture="environment"
              className="hidden" onChange={e => addPhoto(e.target.files)} />
            <button onClick={() => photoInput.current?.click()}
              className="w-full py-3 border border-dashed border-[#2a2a2a] rounded-xl text-zinc-400 hover:text-white text-sm transition flex items-center justify-center gap-2">
              📸 Prendre des photos
            </button>
          </div>

          {/* Signature */}
          <div>
            <Label icon="✍️" text="Décharge / Signature client (optionnel)" />
            <div className="mb-2">
              <input value={signatureName} onChange={e => setSignatureName(e.target.value)}
                placeholder="Nom du signataire"
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand mb-2"
              />
              {!signatureData ? (
                showSig ? (
                  <SignatureCanvas onSave={d => { setSignatureData(d); setShowSig(false) }} />
                ) : (
                  <button onClick={() => setShowSig(true)}
                    className="w-full py-2.5 border border-dashed border-[#2a2a2a] rounded-xl text-zinc-400 hover:text-white text-sm transition">
                    ✍️ Faire signer le client
                  </button>
                )
              ) : (
                <div>
                  <div className="border border-green-500/30 rounded-xl overflow-hidden mb-1 bg-[#111]">
                    <img src={signatureData} alt="Signature" className="w-full max-h-24 object-contain" />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-green-400 text-xs">✅ Signé par {signatureName || 'client'}</span>
                    <button onClick={() => { setSignatureData(''); setShowSig(false) }} className="text-zinc-500 text-xs">Refaire</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Note */}
          <div>
            <Label icon="📝" text="Note (optionnel)" />
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
              placeholder="Remarques, difficultés..."
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand resize-none"
            />
          </div>

          {/* Erreurs */}
          {errors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
              {errors.map((e, i) => <p key={i} className="text-red-400 text-sm">⚠️ {e}</p>)}
            </div>
          )}

          {/* Bouton terminer */}
          <button onClick={submit} disabled={loading}
            className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-lg transition mb-4">
            {loading ? '⏳ Envoi en cours...' : '🏁 Terminer la mission'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ClosingData {
  finalMissionType: string; mileage: string; destinationAddr: string
  extraAddresses: string[]; photos: File[]; signatureData: string
  signatureName: string; note: string
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function DriverClient({ mission: initial, isReadOnly = false }: Props) {
  const router = useRouter()
  const [mission,      setMission]      = useState<Mission>(initial)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [showClose,    setShowClose]    = useState(false)
  const [showPark,     setShowPark]     = useState(false)
  const [stages,       setStages]       = useState<FleetStage[]>([])
  const [stagesLoaded, setStagesLoaded] = useState(false)

  const typeInfo   = TYPE_LABELS[mission.mission_type || 'autre'] || TYPE_LABELS.autre
  const statusConf = STATUS_CONFIG[mission.status] || { label: mission.status, color: 'text-zinc-400', bg: 'bg-zinc-500/10' }

  const loadStages = async () => {
    if (stagesLoaded) return
    try {
      const res = await fetch('/api/odoo/fleet-stages')
      const data = await res.json()
      setStages(data || [])
    } catch {}
    setStagesLoaded(true)
  }

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

  const doAction = async (action: string, extra?: Record<string, unknown>) => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch('/api/missions/driver-action', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: mission.id, action, ...extra }),
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

  const handlePark = async (stageId: number, stageName: string, notes: string) => {
    await doAction('park', { park_data: { stage_id: stageId, stage_name: stageName, notes } })
    setShowPark(false)
  }

  const handleComplete = async (data: ClosingData) => {
    setLoading(true); setError(null)
    try {
      const photoUrls = await uploadPhotos(mission.id, data.photos)
      const res = await fetch('/api/missions/driver-action', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
      setMission(json.mission); setShowClose(false); router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  // Mission terminée
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
    <div className="min-h-screen bg-[#0F0F0F] pb-28">

      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 sticky top-0 z-20">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => router.push('/mission')}
            className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white">←</button>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold text-white ${typeInfo.color}`}>
              {typeInfo.short}
            </span>
            <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${statusConf.bg} ${statusConf.color}`}>
              {statusConf.label}
            </span>
          </div>
        </div>
        <h1 className="text-white font-bold text-lg truncate">{mission.client_name || 'Client inconnu'}</h1>
        {mission.client_phone && (
          <a href={`tel:${mission.client_phone}`} className="text-brand text-sm font-medium flex items-center gap-1 mt-0.5">
            📞 {mission.client_phone}
          </a>
        )}
        {mission.dossier_number && <p className="text-zinc-600 text-xs font-mono mt-0.5">{mission.dossier_number}</p>}
      </div>

      <div className="px-4 mt-4 space-y-4">

        {/* En dépôt */}
        {mission.status === 'parked' && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4">
            <p className="text-yellow-400 font-bold text-sm mb-1">🅿️ Véhicule en dépôt</p>
            {mission.park_stage_name && <p className="text-yellow-300 text-xs">{mission.park_stage_name}</p>}
            {mission.parked_at && <p className="text-yellow-500/60 text-xs">Depuis {fmt(mission.parked_at)}</p>}
          </div>
        )}

        {/* Véhicule */}
        {(mission.vehicle_brand || mission.vehicle_plate) && (
          <Card>
            <Label icon="🚘" text="Véhicule" />
            <p className="text-white font-semibold">{[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')}</p>
            {mission.vehicle_plate && <p className="text-zinc-400 text-xs font-mono uppercase tracking-widest mt-0.5">{mission.vehicle_plate}</p>}
            {mission.vehicle_vin   && <p className="text-zinc-500 text-xs mt-0.5">VIN : {mission.vehicle_vin}</p>}
          </Card>
        )}

        {/* Description */}
        {mission.incident_description && (
          <Card>
            <Label icon="📋" text="Description" />
            <p className="text-white text-sm whitespace-pre-wrap">{mission.incident_description}</p>
          </Card>
        )}

        {/* Lieu incident */}
        {(mission.incident_address || mission.incident_city) && (
          <Card>
            <Label icon="📍" text="Lieu d'intervention" />
            <p className="text-white text-sm">{mission.incident_address}{mission.incident_city ? `, ${mission.incident_city}` : ''}</p>
            <MapsRow lat={mission.incident_lat} lng={mission.incident_lng} addr={mission.incident_address} />
          </Card>
        )}

        {/* Destination */}
        {mission.destination_address && (
          <Card>
            <Label icon="🏁" text="Destination" />
            {mission.destination_name && <p className="text-zinc-400 text-xs mb-0.5">{mission.destination_name}</p>}
            <p className="text-white text-sm">{mission.destination_address}</p>
            <MapsRow addr={mission.destination_address} />
          </Card>
        )}

        {/* Remarques */}
        {mission.remarks_general && (
          <Card>
            <Label icon="📝" text="Remarques" />
            <p className="text-white text-sm whitespace-pre-wrap">{mission.remarks_general}</p>
          </Card>
        )}

        {/* Montant garanti */}
        {mission.amount_guaranteed != null && (
          <Card>
            <Label icon="💶" text="Montant garanti" />
            <p className="text-white font-bold text-xl">{mission.amount_guaranteed} {mission.amount_currency ?? '€'}</p>
          </Card>
        )}

        {/* Timeline */}
        <Card>
          <Label icon="🕐" text="Progression" />
          <Timeline mission={mission} />
        </Card>

        {/* Erreur */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">⚠️ {error}</div>
        )}

      </div>

      {/* Boutons action — fixés en bas */}
      {!isReadOnly && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4 z-10 space-y-2 safe-bottom">

          {mission.status === 'assigned' && (
            <button onClick={() => doAction('accept')} disabled={loading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-lg transition">
              {loading ? '⏳...' : '✅ Accepter la mission'}
            </button>
          )}

          {mission.status === 'accepted' && (
            <button onClick={() => doAction('on_way')} disabled={loading}
              className="w-full py-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-lg transition">
              {loading ? '⏳...' : '🚗 Je suis en route'}
            </button>
          )}

          {mission.status === 'in_progress' && !mission.on_site_at && (
            <button onClick={() => doAction('on_site')} disabled={loading}
              className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-lg transition">
              {loading ? '⏳...' : '📍 Je suis sur place'}
            </button>
          )}

          {mission.status === 'in_progress' && mission.on_site_at && (
            <div className="flex gap-2">
              <button onClick={() => { loadStages(); setShowPark(true) }}
                className="flex-1 py-3.5 bg-yellow-500/20 border border-yellow-500/40 hover:bg-yellow-500/30 text-yellow-400 font-bold rounded-2xl text-sm transition">
                🅿️ Mettre en dépôt
              </button>
              <button onClick={() => setShowClose(true)}
                className="flex-1 py-3.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-2xl text-sm transition">
                🏁 Clôturer
              </button>
            </div>
          )}

          {mission.status === 'parked' && (
            <div className="flex gap-2">
              <button onClick={() => doAction('redeliver')} disabled={loading}
                className="flex-1 py-3.5 bg-brand hover:bg-brand/80 disabled:opacity-50 text-white font-bold rounded-2xl text-sm transition">
                {loading ? '⏳...' : '🚚 Relivrer'}
              </button>
              <button onClick={() => setShowClose(true)}
                className="flex-1 py-3.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-2xl text-sm transition">
                🏁 Clôturer
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showPark  && <ParkModal  stages={stages} onClose={() => setShowPark(false)}  onSubmit={handlePark}     loading={loading} />}
      {showClose && <CloseModal mission={mission} onClose={() => setShowClose(false)} onSubmit={handleComplete} loading={loading} />}
    </div>
  )
}
