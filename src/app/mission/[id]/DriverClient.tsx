'use client'
// src/app/mission/[id]/DriverClient.tsx
// P7 — Wizard de clôture guidé : DSP / REM avec étapes dynamiques + GPS + retour arrière

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ─────────────────────────────────────────────────────────────────────

type MissionStatus = 'new'|'dispatching'|'assigned'|'accepted'|'in_progress'|'parked'|'completed'
type NavApp = 'gmaps'|'waze'|'apple'
type WizardStepId =
  'type' | 'destination' | 'rem_options' |
  'vr_address' | 'client_address' | 'depot_select' |
  'mileage' | 'photos' | 'signature' | 'note'

interface Mission {
  id: string; status: MissionStatus
  external_id?: string; dossier_number?: string; source?: string
  mission_type?: string; incident_description?: string
  client_name?: string; client_phone?: string
  vehicle_brand?: string; vehicle_model?: string; vehicle_plate?: string; vehicle_vin?: string
  incident_address?: string; incident_city?: string; incident_lat?: number; incident_lng?: number
  destination_address?: string; destination_name?: string
  remarks_general?: string
  accepted_at?: string; on_way_at?: string; on_site_at?: string
  completed_at?: string; assigned_at?: string; parked_at?: string
  amount_guaranteed?: number; amount_currency?: string
  amount_to_collect?: number
  park_stage_name?: string
}

interface Depot { id: string; name: string; address: string; lat: number|null; lng: number|null; is_default: boolean }
interface FleetStage { id: number; name: string }
interface Props { mission: Mission; currentUserId: string; isReadOnly?: boolean; navApp?: NavApp }

// ── Constantes ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, { short: string; label: string; color: string }> = {
  depannage:        { short: 'DSP', label: 'Dépannage sur place',      color: 'bg-orange-500' },
  remorquage:       { short: 'REM', label: 'Remorquage',               color: 'bg-blue-600'   },
  transport:        { short: 'TRN', label: 'Transport',                color: 'bg-purple-600' },
  trajet_vide:      { short: 'TVD', label: 'Trajet vide',              color: 'bg-zinc-600'   },
  reparation_place: { short: 'RPL', label: 'Réparation sur place',     color: 'bg-green-600'  },
  autre:            { short: 'AUT', label: 'Autre',                    color: 'bg-zinc-500'   },
  DSP:              { short: 'DSP', label: 'Dépannage sur place',      color: 'bg-orange-500' },
  REM:              { short: 'REM', label: 'Remorquage',               color: 'bg-blue-600'   },
  DPR:              { short: 'DPR', label: 'Déplacement pour rien',    color: 'bg-zinc-600'   },
  VR:               { short: 'VR',  label: 'Véhicule de remplacement', color: 'bg-teal-600'   },
  AUT:              { short: 'AUT', label: 'Autre',                    color: 'bg-zinc-500'   },
}

// Types proposés dans le wizard (5 canonical)
const WIZARD_TYPES = [
  { value: 'DSP', label: 'Dépannage sur place',      color: 'bg-orange-500' },
  { value: 'REM', label: 'Remorquage',               color: 'bg-blue-600'   },
  { value: 'DPR', label: 'Déplacement pour rien',    color: 'bg-zinc-600'   },
  { value: 'VR',  label: 'Véhicule de remplacement', color: 'bg-teal-600'   },
  { value: 'AUT', label: 'Autre',                    color: 'bg-zinc-500'   },
]

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  assigned:    { label: 'À accepter', color: 'text-blue-400',   bg: 'bg-blue-500/10'   },
  accepted:    { label: 'Acceptée',   color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
  in_progress: { label: 'En cours',   color: 'text-orange-400', bg: 'bg-orange-500/10' },
  parked:      { label: 'En dépôt',   color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  completed:   { label: 'Terminée',   color: 'text-green-400',  bg: 'bg-green-500/10'  },
}

const NAV_APPS: { id: NavApp; label: string; icon: string }[] = [
  { id: 'gmaps', label: 'Google Maps', icon: '🗺️' },
  { id: 'waze',  label: 'Waze',        icon: '🧭' },
  { id: 'apple', label: 'Plans',       icon: '📍' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeType(t: string | null | undefined): string {
  const map: Record<string, string> = {
    depannage: 'DSP', reparation_place: 'DSP',
    remorquage: 'REM', transport: 'AUT', trajet_vide: 'DPR', autre: 'AUT',
  }
  if (!t) return 'DSP'
  return map[t] || t
}

function getWizardSteps(
  finalType: string,
  needsVR: boolean,
  needsClientRide: boolean,
  closingMode: 'direct' | 'depot' | null
): WizardStepId[] {
  const isRem = ['REM', 'remorquage'].includes(finalType)
  const steps: WizardStepId[] = ['type']
  if (isRem) {
    steps.push('destination')
    steps.push('rem_options')
    if (needsVR) steps.push('vr_address')
    if (needsClientRide) steps.push('client_address')
    if (closingMode === 'depot') steps.push('depot_select')
  }
  steps.push('mileage', 'photos', 'signature', 'note')
  return steps
}

function buildNavUrl(app: NavApp, lat?: number, lng?: number, addr?: string): string | null {
  const q = lat && lng ? `${lat},${lng}` : encodeURIComponent(addr || '')
  if (!q) return null
  if (app === 'waze')  return `https://waze.com/ul?ll=${q}&navigate=yes`
  if (app === 'apple') return `https://maps.apple.com/?daddr=${q}&dirflg=d`
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`
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

// ── AddressWithGPS ────────────────────────────────────────────────────────────

function AddressWithGPS({ value, onChange, onSelect, placeholder, mapsReady }: {
  value: string
  onChange: (v: string) => void
  onSelect: (addr: string, lat: number, lng: number) => void
  placeholder?: string
  mapsReady?: boolean
}) {
  const ref        = useRef<HTMLInputElement>(null)
  const acRef      = useRef<any>(null)
  const [gps, setGps] = useState(false)

  useEffect(() => {
    if (!mapsReady && !(window as any).google?.maps?.places) return
    const init = () => {
      if (!ref.current || !(window as any).google?.maps?.places || acRef.current) return
      acRef.current = new (window as any).google.maps.places.Autocomplete(ref.current, {
        componentRestrictions: { country: ['be','lu','fr','nl','de'] },
        fields: ['formatted_address','geometry'],
      })
      acRef.current.addListener('place_changed', () => {
        const p = acRef.current.getPlace()
        if (p?.geometry) {
          const addr = p.formatted_address || ''
          onChange(addr)
          onSelect(addr, p.geometry.location.lat(), p.geometry.location.lng())
        }
      })
    }
    init()
  }, [mapsReady])

  const handleGPS = () => {
    if (!navigator.geolocation) return
    setGps(true)
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords
      const g = (window as any).google
      if (g?.maps) {
        new g.maps.Geocoder().geocode({ location: { lat, lng } }, (r: any[], s: string) => {
          setGps(false)
          if (s === 'OK' && r[0]) { onChange(r[0].formatted_address); onSelect(r[0].formatted_address, lat, lng) }
        })
      } else { setGps(false); const raw = `${lat.toFixed(6)}, ${lng.toFixed(6)}`; onChange(raw); onSelect(raw, lat, lng) }
    }, () => setGps(false), { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
  }

  return (
    <div className="space-y-2">
      <button onClick={handleGPS} disabled={gps} type="button"
        className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600/15 border border-blue-500/30 hover:bg-blue-600/25 disabled:opacity-50 text-blue-300 rounded-xl text-sm font-medium transition">
        {gps ? '⏳ Localisation…' : '📍 Ma position actuelle'}
      </button>
      <input ref={ref} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder || 'Adresse…'}
        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
      {value && <p className="text-green-400 text-xs truncate">✓ {value}</p>}
    </div>
  )
}

// ── SignatureCanvas ───────────────────────────────────────────────────────────

function SignatureCanvas({ onSave }: { onSave: (d: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [drawn, setDrawn] = useState(false)
  const getPos = (e: React.TouchEvent|React.MouseEvent, c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect()
    const s = 'touches' in e ? e.touches[0] : e
    return { x: s.clientX - r.left, y: s.clientY - r.top }
  }
  const start = (e: React.TouchEvent|React.MouseEvent) => {
    e.preventDefault(); const c = ref.current; if (!c) return
    const p = getPos(e, c); c.getContext('2d')!.beginPath(); c.getContext('2d')!.moveTo(p.x, p.y); drawing.current = true
  }
  const move = (e: React.TouchEvent|React.MouseEvent) => {
    e.preventDefault(); if (!drawing.current) return
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!; const p = getPos(e, c)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#fff'
    ctx.lineTo(p.x, p.y); ctx.stroke(); setDrawn(true)
  }
  const end = () => { drawing.current = false }
  const clear = () => { ref.current?.getContext('2d')!.clearRect(0, 0, 340, 140); setDrawn(false) }
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

// ── NavModal ──────────────────────────────────────────────────────────────────

function NavModal({ onSelect }: { onSelect: (app: NavApp) => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end">
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6">
        <h2 className="text-white font-bold text-lg mb-1">Choisir l&apos;app de navigation</h2>
        <p className="text-zinc-500 text-sm mb-4">Ce choix sera mémorisé</p>
        <div className="space-y-2">
          {NAV_APPS.map(app => (
            <button key={app.id} onClick={() => onSelect(app.id)}
              className="w-full flex items-center gap-4 px-4 py-3.5 bg-[#111] border border-[#2a2a2a] hover:border-brand rounded-2xl transition">
              <span className="text-2xl">{app.icon}</span>
              <span className="text-white font-semibold">{app.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── ParkModal ─────────────────────────────────────────────────────────────────

function ParkModal({ stages, onClose, onSubmit, loading }: {
  stages: FleetStage[]; onClose: () => void
  onSubmit: (stageId: number, stageName: string, notes: string) => void; loading: boolean
}) {
  const [stageId, setStageId]     = useState<number|null>(null)
  const [stageName, setStageName] = useState('')
  const [notes, setNotes]         = useState('')
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end" onClick={onClose}>
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 space-y-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
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
                    stageId === s.id ? 'bg-brand border-brand text-white' : 'border-[#2a2a2a] bg-[#111] text-zinc-400 hover:text-white'
                  }`}>{s.name}</button>
              ))}
            </div>
          ) : (
            <input value={stageName} onChange={e => setStageName(e.target.value)} placeholder="Nom du parc..."
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand" />
          )}
        </div>
        <div>
          <Label icon="📝" text="Notes (optionnel)" />
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Remarques..."
            className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand resize-none" />
        </div>
        <button onClick={() => (stageId || stageName) && onSubmit(stageId || 0, stageName, notes)}
          disabled={loading || (!stageId && !stageName)}
          className="w-full py-3 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-40 text-black font-bold rounded-xl text-sm transition">
          {loading ? '⏳…' : '🅿️ Confirmer le dépôt'}
        </button>
      </div>
    </div>
  )
}

// ── NavButton — bouton navigation vers une adresse ───────────────────────────
function NavButton({ label, addr, lat, lng, app }: {
  label: string; addr: string; lat: number|null; lng: number|null; app: NavApp
}) {
  if (!addr) return null
  const url = buildNavUrl(app, lat ?? undefined, lng ?? undefined, addr)
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-600/20 border border-blue-500/40 hover:bg-blue-600/30 text-blue-300 font-semibold rounded-2xl text-base transition active:scale-[0.98]">
      🗺️ {label}
    </a>
  )
}

// ── WizardClose — Wizard de clôture complet ───────────────────────────────────

function WizardClose({ mission, onClose, onSubmit, loading, onPark, navApp }: {
  mission: Mission; onClose: () => void
  onSubmit: (data: any) => void; loading: boolean; onPark: () => void
  navApp: NavApp
}) {
  const [stepIndex,       setStepIndex]       = useState(0)
  const [finalType,       setFinalType]       = useState(normalizeType(mission.mission_type))
  const [destAddr,        setDestAddr]        = useState(mission.destination_address || '')
  const [destLat,         setDestLat]         = useState<number|null>(null)
  const [destLng,         setDestLng]         = useState<number|null>(null)
  const [needsVR,         setNeedsVR]         = useState(false)
  const [vrAddr,          setVrAddr]          = useState('')
  const [vrLat,           setVrLat]           = useState<number|null>(null)
  const [vrLng,           setVrLng]           = useState<number|null>(null)
  const [needsClientRide, setNeedsClientRide] = useState(false)
  const [clientAddr,      setClientAddr]      = useState('')
  const [clientLat,       setClientLat]       = useState<number|null>(null)
  const [clientLng,       setClientLng]       = useState<number|null>(null)
  const [closingMode,     setClosingMode]     = useState<'direct'|'depot'|null>(null)
  const [selectedDepot,   setSelectedDepot]   = useState<Depot|null>(null)
  const [depots,          setDepots]          = useState<Depot[]>([])
  const [mapsReady,       setMapsReady]       = useState(!!(window as any)?.google?.maps?.places)
  const [mileage,         setMileage]         = useState('')
  const [photos,          setPhotos]          = useState<File[]>([])
  const [previews,        setPreviews]        = useState<string[]>([])
  const [sigData,         setSigData]         = useState('')
  const [sigName,         setSigName]         = useState(mission.client_name || '')
  const [showSig,         setShowSig]         = useState(false)
  const [note,            setNote]            = useState('')
  const [errors,          setErrors]          = useState<string[]>([])

  const photoInput = useRef<HTMLInputElement>(null)

  // Charge les dépôts + Google Maps
  useEffect(() => {
    fetch('/api/depots').then(r => r.json()).then(d => setDepots(Array.isArray(d) ? d : [])).catch(() => {})
    // Charge Maps si pas encore présent
    if ((window as any).google?.maps?.places) { setMapsReady(true); return }
    const existingScript = document.getElementById('gm-wizard-script')
    if (existingScript) {
      const t = setInterval(() => { if ((window as any).google?.maps?.places) { setMapsReady(true); clearInterval(t) } }, 200)
      return () => clearInterval(t)
    }
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!key) return
    const s = document.createElement('script')
    s.id  = 'gm-wizard-script'
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&language=fr`
    s.onload = () => setMapsReady(true)
    document.head.appendChild(s)
  }, [])

  const steps = getWizardSteps(finalType, needsVR, needsClientRide, closingMode)
  const currentStep = steps[stepIndex]
  const totalSteps  = steps.length
  const progress    = Math.round((stepIndex / (totalSteps - 1)) * 100)

  const goBack = () => {
    setErrors([])
    if (stepIndex > 0) setStepIndex(i => i - 1)
    else onClose()
  }

  const goNext = () => {
    setErrors([])
    setStepIndex(i => i + 1)
  }

  const addPhotos = (files: FileList|null) => {
    if (!files) return
    Array.from(files).forEach(f => {
      setPhotos(p => [...p, f])
      const r = new FileReader()
      r.onload = e => setPreviews(p => [...p, e.target?.result as string])
      r.readAsDataURL(f)
    })
  }

  const validateAndSubmit = () => {
    const errs: string[] = []
    if (!mileage) errs.push('Kilométrage obligatoire')
    if (photos.length < 3) errs.push('Minimum 3 photos requises')
    if (['REM','remorquage'].includes(finalType) && !destAddr) errs.push('Adresse de destination obligatoire')
    if (errs.length > 0) { setErrors(errs); return }

    const extraAddresses = [vrAddr, clientAddr].filter(Boolean)
    onSubmit({
      finalMissionType: finalType,
      mileage,
      destinationAddr: destAddr,
      destinationLat:  destLat,
      destinationLng:  destLng,
      extraAddresses,
      photos,
      signatureData: sigData,
      signatureName: sigName,
      note,
      paymentMethod:   '',
      amountCollected: '',
      depot: selectedDepot ? { id: selectedDepot.id, name: selectedDepot.name } : null,
      closingMode,
    })
  }

  const canContinue = (): boolean => {
    switch (currentStep) {
      case 'destination':   return destAddr.length > 3
      case 'rem_options':   return closingMode !== null
      case 'vr_address':    return vrAddr.length > 3
      case 'client_address': return clientAddr.length > 3
      case 'mileage':      return mileage.length > 0
      case 'photos':       return photos.length >= 3
      default: return true
    }
  }

  const isLastStep = stepIndex === totalSteps - 1

  // ── Encaissement link ──────────────────────────────────────────────────────
  const encaissementUrl = mission.amount_to_collect && mission.amount_to_collect > 0
    ? `/encaissement?prefill_mission_id=${mission.id}&prefill_plate=${mission.vehicle_plate||''}&prefill_brand=${mission.vehicle_brand||''}&prefill_model=${mission.vehicle_model||''}&prefill_amount=${mission.amount_to_collect}&return_to=/mission/${mission.id}`
    : null

  // ── Render steps ───────────────────────────────────────────────────────────

  const renderStep = () => {
    switch (currentStep) {

      case 'type':
        return (
          <div className="space-y-3">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Que s&apos;est-il passé ?</p>
            {WIZARD_TYPES.map(t => (
              <button key={t.value} onClick={() => { setFinalType(t.value); goNext() }}
                className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 transition active:scale-[0.98] ${
                  finalType === t.value
                    ? `${t.color} border-transparent text-white`
                    : 'bg-[#1A1A1A] border-[#2a2a2a] text-white hover:border-zinc-600'
                }`}>
                <span className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-black text-lg flex-shrink-0 ${t.color}`}>
                  {t.value}
                </span>
                <span className="text-base font-medium text-left">{t.label}</span>
              </button>
            ))}
          </div>
        )

      case 'destination':
        return (
          <div className="space-y-4">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Où livrez-vous le véhicule ?</p>
            <AddressWithGPS value={destAddr} onChange={setDestAddr}
              onSelect={(a, lat, lng) => { setDestAddr(a); setDestLat(lat); setDestLng(lng) }}
              placeholder="Garage, domicile, fourrière…" mapsReady={mapsReady} />
            {destAddr && (
              <NavButton label="Y aller" addr={destAddr} lat={destLat} lng={destLng} app={navApp} />
            )}
          </div>
        )

      case 'rem_options':
        return (
          <div className="space-y-4">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Que se passe-t-il ensuite ?</p>
            <p className="text-zinc-600 text-xs">Sélectionne tout ce qui s&apos;applique, puis la destination du véhicule</p>

            {/* VR */}
            <button onClick={() => setNeedsVR(!needsVR)}
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 transition active:scale-[0.98] ${
                needsVR ? 'bg-teal-500/20 border-teal-500 text-white' : 'bg-[#1A1A1A] border-[#2a2a2a] text-zinc-300'
              }`}>
              <span className="text-2xl">🚗</span>
              <div className="text-left flex-1">
                <p className="font-bold">Véhicule de remplacement</p>
                <p className="text-xs text-zinc-500">Le client a besoin d&apos;un VR</p>
              </div>
              <span className="text-xl">{needsVR ? '✅' : '◻️'}</span>
            </button>

            {/* Client ride */}
            <button onClick={() => setNeedsClientRide(!needsClientRide)}
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 transition active:scale-[0.98] ${
                needsClientRide ? 'bg-blue-500/20 border-blue-500 text-white' : 'bg-[#1A1A1A] border-[#2a2a2a] text-zinc-300'
              }`}>
              <span className="text-2xl">👤</span>
              <div className="text-left flex-1">
                <p className="font-bold">Reconduire le client</p>
                <p className="text-xs text-zinc-500">Dépôt du client à une adresse</p>
              </div>
              <span className="text-xl">{needsClientRide ? '✅' : '◻️'}</span>
            </button>

            {/* Destination du véhicule — obligatoire, choix unique */}
            <div>
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-2">Destination du véhicule</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setClosingMode('direct')}
                  className={`flex flex-col items-center gap-2 py-4 rounded-2xl border-2 transition active:scale-[0.98] ${
                    closingMode === 'direct' ? 'bg-green-500/20 border-green-500 text-white' : 'bg-[#1A1A1A] border-[#2a2a2a] text-zinc-300'
                  }`}>
                  <span className="text-3xl">🚛</span>
                  <p className="font-bold text-sm">Livraison directe</p>
                </button>
                <button onClick={() => setClosingMode('depot')}
                  className={`flex flex-col items-center gap-2 py-4 rounded-2xl border-2 transition active:scale-[0.98] ${
                    closingMode === 'depot' ? 'bg-yellow-500/20 border-yellow-500 text-white' : 'bg-[#1A1A1A] border-[#2a2a2a] text-zinc-300'
                  }`}>
                  <span className="text-3xl">🅿️</span>
                  <p className="font-bold text-sm">Mise en dépôt</p>
                </button>
              </div>
            </div>
          </div>
        )

      case 'vr_address':
        return (
          <div className="space-y-4">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Adresse de livraison du VR</p>
            <AddressWithGPS value={vrAddr} onChange={setVrAddr}
              onSelect={(a, lat, lng) => { setVrAddr(a); setVrLat(lat); setVrLng(lng) }}
              placeholder="Où livrer le véhicule de remplacement ?" mapsReady={mapsReady} />
            {vrAddr && (
              <NavButton label="Y aller — VR" addr={vrAddr} lat={vrLat} lng={vrLng} app={navApp} />
            )}
          </div>
        )

      case 'client_address':
        return (
          <div className="space-y-4">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Adresse de dépôt du client</p>
            <AddressWithGPS value={clientAddr} onChange={setClientAddr}
              onSelect={(a, lat, lng) => { setClientAddr(a); setClientLat(lat); setClientLng(lng) }}
              placeholder="Domicile, gare, hôtel…" mapsReady={mapsReady} />
            {clientAddr && (
              <NavButton label="Y aller — client" addr={clientAddr} lat={clientLat} lng={clientLng} app={navApp} />
            )}
          </div>
        )

      case 'depot_select':
        return (
          <div className="space-y-4">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Quel dépôt ?</p>
            {depots.length > 0 ? (
              <div className="space-y-3">
                {depots.map(d => (
                  <button key={d.id} onClick={() => { setSelectedDepot(d); goNext() }}
                    className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 transition active:scale-[0.98] ${
                      selectedDepot?.id === d.id
                        ? 'bg-yellow-500/20 border-yellow-500 text-white'
                        : 'bg-[#1A1A1A] border-[#2a2a2a] text-white hover:border-yellow-500/50'
                    }`}>
                    <span className="text-2xl">🅿️</span>
                    <div className="text-left">
                      <p className="font-bold">{d.name}</p>
                      {d.is_default && <span className="text-yellow-400 text-xs">Par défaut</span>}
                      <p className="text-zinc-500 text-xs truncate">{d.address}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <p className="text-zinc-500 text-sm mb-3">Aucun dépôt configuré — saisir manuellement</p>
                <input value={selectedDepot?.name || ''} placeholder="Nom du dépôt…"
                  onChange={e => setSelectedDepot(d => ({ ...(d || { id:'', address:'', lat:null, lng:null, is_default:false }), name: e.target.value }))}
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand" />
              </div>
            )}
          </div>
        )

      case 'mileage':
        return (
          <div className="space-y-4">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Kilométrage du véhicule *</p>
            <input type="number" inputMode="numeric" value={mileage}
              onChange={e => setMileage(e.target.value)} placeholder="Ex: 87450" autoFocus
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-4 py-5 text-white text-2xl text-center font-mono focus:outline-none focus:border-brand" />
            <p className="text-zinc-600 text-xs text-center">Relève le compteur sur le véhicule</p>
          </div>
        )

      case 'photos':
        return (
          <div className="space-y-4">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">
              Photos du véhicule * ({photos.length}/min.3)
            </p>
            <p className="text-zinc-600 text-xs">Châssis · Plaque · Vue générale</p>
            {previews.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {previews.map((src, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => { setPhotos(p => p.filter((_,j)=>j!==i)); setPreviews(p => p.filter((_,j)=>j!==i)) }}
                      className="absolute top-1 right-1 w-6 h-6 bg-black/70 rounded-full text-white text-xs flex items-center justify-center">✕</button>
                  </div>
                ))}
              </div>
            )}
            <input ref={photoInput} type="file" accept="image/*" multiple capture="environment"
              className="hidden" onChange={e => addPhotos(e.target.files)} />
            <button onClick={() => photoInput.current?.click()}
              className="w-full py-4 border-2 border-dashed border-[#2a2a2a] hover:border-brand rounded-2xl text-zinc-400 hover:text-white text-sm transition flex items-center justify-center gap-2">
              📷 Prendre des photos
            </button>
          </div>
        )

      case 'signature':
        return (
          <div className="space-y-4">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Décharge client (optionnel)</p>
            <input value={sigName} onChange={e => setSigName(e.target.value)} placeholder="Nom du signataire"
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand" />
            {!sigData ? (
              showSig
                ? <SignatureCanvas onSave={d => { setSigData(d); setShowSig(false) }} />
                : <button onClick={() => setShowSig(true)}
                    className="w-full py-3 border border-dashed border-[#2a2a2a] rounded-xl text-zinc-400 hover:text-white text-sm transition">
                    ✍️ Faire signer le client
                  </button>
            ) : (
              <div>
                <div className="border border-green-500/30 rounded-xl overflow-hidden mb-1 bg-[#111]">
                  <img src={sigData} alt="Signature" className="w-full max-h-24 object-contain" />
                </div>
                <div className="flex justify-between">
                  <span className="text-green-400 text-xs">✅ Signé par {sigName || 'client'}</span>
                  <button onClick={() => { setSigData(''); setShowSig(false) }} className="text-zinc-500 text-xs">Refaire</button>
                </div>
              </div>
            )}
          </div>
        )

      case 'note':
        return (
          <div className="space-y-4">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Note (optionnel)</p>
            <textarea rows={4} value={note} onChange={e => setNote(e.target.value)}
              placeholder="Remarques, difficultés, infos importantes…" autoFocus
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand resize-none" />
          </div>
        )

      default: return null
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-[#0F0F0F] z-50 flex flex-col">

      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={goBack}
            className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg flex-shrink-0">
            ←
          </button>
          <div className="flex-1">
            <p className="text-white font-bold text-base">Clôture — étape {stepIndex + 1}/{totalSteps}</p>
            <p className="text-zinc-500 text-xs capitalize">{currentStep.replace('_', ' ')}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 text-2xl flex-shrink-0">×</button>
        </div>
        {/* Progress */}
        <div className="h-1 bg-[#2a2a2a] rounded-full overflow-hidden">
          <div className="h-full bg-brand rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Récap mission */}
      <div className="bg-[#111] border-b border-[#2a2a2a] px-4 py-2.5 flex items-center gap-2 flex-wrap flex-shrink-0">
        {(() => { const ti = TYPE_LABELS[finalType] ?? TYPE_LABELS.DSP; return (
          <span className={`px-2.5 py-1 rounded-lg text-xs font-bold text-white ${ti.color}`}>{ti.short}</span>
        )})()}
        {mission.client_name && <span className="text-white text-sm font-semibold">{mission.client_name}</span>}
        {mission.vehicle_plate && <span className="text-zinc-400 text-xs font-mono">{mission.vehicle_plate}</span>}
      </div>

      {/* Bouton dépôt en parc (accès rapide) */}
      <div className="px-4 pt-3 flex-shrink-0">
        <button onClick={onPark}
          className="w-full py-2.5 bg-yellow-500/15 border border-yellow-500/30 hover:bg-yellow-500/25 text-yellow-400 font-medium rounded-xl text-sm transition flex items-center justify-center gap-2">
          🅿️ Mettre en dépôt directement
        </button>
      </div>

      {/* Contenu de l'étape */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {renderStep()}

        {errors.length > 0 && (
          <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
            {errors.map((e, i) => <p key={i} className="text-red-400 text-sm">⚠️ {e}</p>)}
          </div>
        )}
      </div>

      {/* Boutons fixes en bas */}
      <div className="flex-shrink-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4 space-y-2">

        {/* Bouton paiement flottant */}
        {encaissementUrl && (
          <a href={encaissementUrl}
            className="w-full flex items-center justify-between px-5 py-3.5 bg-brand rounded-2xl text-white font-bold text-base shadow-lg">
            <span>💳 Encaisser le paiement</span>
            <span className="text-xl font-black">{mission.amount_to_collect} €</span>
          </a>
        )}

        {/* Continue / Submit — seulement sur les étapes qui ont un bouton explicite */}
        {!['type','rem_options','depot_select'].includes(currentStep) && (
          isLastStep ? (
            <button onClick={validateAndSubmit} disabled={loading || !canContinue()}
              className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-bold rounded-2xl text-base transition">
              {loading ? '⏳ Envoi en cours…' : '🏁 Terminer la mission'}
            </button>
          ) : (
            <button onClick={goNext} disabled={!canContinue()}
              className="w-full py-4 bg-brand disabled:opacity-40 text-white font-bold rounded-2xl text-base transition">
              Continuer →
            </button>
          )
        )}
      </div>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function DriverClient({ mission: initial, currentUserId, isReadOnly = false, navApp: initialNavApp }: Props) {
  const router = useRouter()
  const [mission,      setMission]      = useState<Mission>(initial)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string|null>(null)
  const [showWizard,   setShowWizard]   = useState(false)
  const [showPark,     setShowPark]     = useState(false)
  const [showNavModal, setShowNavModal] = useState(false)
  const [navApp,       setNavApp]       = useState<NavApp>(initialNavApp || 'gmaps')
  const [stages,       setStages]       = useState<FleetStage[]>([])
  const [stagesLoaded, setStagesLoaded] = useState(false)

  const typeInfo   = TYPE_LABELS[mission.mission_type || 'autre'] ?? TYPE_LABELS.autre
  const statusConf = STATUS_CONFIG[mission.status] || { label: mission.status, color: 'text-zinc-400', bg: 'bg-zinc-500/10' }

  const loadStages = async () => {
    if (stagesLoaded) return
    try {
      const res = await fetch('/api/odoo/fleet-stages')
      setStages(await res.json() || [])
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ mission_id: mission.id, action, ...extra }),
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

  const handleOnWay = async (selectedApp?: NavApp) => {
    const app = selectedApp || navApp
    await doAction('on_way')
    const url = buildNavUrl(app, mission.incident_lat, mission.incident_lng, mission.incident_address)
    if (url) window.open(url, '_blank')
  }

  const handleNavChoice = async (app: NavApp) => {
    setNavApp(app); setShowNavModal(false)
    await fetch('/api/users/nav-preference', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ nav_app: app }),
    })
    await handleOnWay(app)
  }

  const handlePark = async (stageId: number, stageName: string, notes: string) => {
    await doAction('park', { park_data: { stage_id: stageId, stage_name: stageName, notes } })
    setShowPark(false)
  }

  const handleComplete = async (data: any) => {
    setLoading(true); setError(null)
    try {
      const photoUrls = await uploadPhotos(mission.id, data.photos)
      const res = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_id:   mission.id,
          action:       'completed',
          closing_data: {
            final_mission_type:  data.finalMissionType,
            mileage:             data.mileage ? parseInt(data.mileage) : undefined,
            destination_address: data.destinationAddr || undefined,
            extra_addresses:     data.extraAddresses?.filter(Boolean) || [],
            photo_urls:          photoUrls,
            signature_data:      data.signatureData || undefined,
            signature_name:      data.signatureName || undefined,
            closing_notes:       data.note || undefined,
            closing_mode:        data.closingMode || undefined,
            depot:               data.depot || undefined,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erreur serveur')
      setMission(json.mission); setShowWizard(false); router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  // ── Encaissement link ─────────────────────────────────────────────────────
  const encaissementUrl = mission.amount_to_collect && mission.amount_to_collect > 0
    ? `/encaissement?prefill_mission_id=${mission.id}&prefill_plate=${mission.vehicle_plate||''}&prefill_brand=${mission.vehicle_brand||''}&prefill_model=${mission.vehicle_model||''}&prefill_amount=${mission.amount_to_collect}&return_to=/mission/${mission.id}`
    : null

  if (mission.status === 'completed') {
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl mb-4">🏁</div>
        <h1 className="text-white font-bold text-xl mb-2">Mission terminée !</h1>
        <p className="text-zinc-500 text-sm mb-6">{mission.client_name} — {mission.vehicle_plate}</p>
        <button onClick={() => router.push('/mission')}
          className="px-6 py-3 bg-[#1A1A1A] border border-[#2a2a2a] text-white rounded-2xl text-sm">
          ← Retour à mes missions
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] pb-48">

      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 sticky top-0 z-20">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => router.push('/mission')}
            className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white">←</button>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold text-white ${typeInfo.color}`}>{typeInfo.short}</span>
            <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${statusConf.bg} ${statusConf.color}`}>{statusConf.label}</span>
          </div>
        </div>
        <h1 className="text-white font-bold text-lg truncate">{mission.client_name || 'Client inconnu'}</h1>
        <div className="flex items-center gap-3 mt-0.5">
          {mission.client_phone && (
            <a href={`tel:${mission.client_phone}`} className="text-brand text-sm font-medium">
              📞 {mission.client_phone}
            </a>
          )}
          {mission.dossier_number && <p className="text-zinc-600 text-xs font-mono">{mission.dossier_number}</p>}
        </div>
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

        {/* Lieu */}
        {(mission.incident_address || mission.incident_city) && (
          <Card>
            <Label icon="📍" text="Lieu d'intervention" />
            <p className="text-white text-sm">{mission.incident_address}{mission.incident_city ? `, ${mission.incident_city}` : ''}</p>
          </Card>
        )}

        {/* Destination */}
        {mission.destination_address && (
          <Card>
            <Label icon="🏁" text="Destination" />
            {mission.destination_name && <p className="text-zinc-400 text-xs mb-0.5">{mission.destination_name}</p>}
            <p className="text-white text-sm">{mission.destination_address}</p>
          </Card>
        )}

        {/* Montant garanti */}
        {mission.amount_guaranteed != null && (
          <Card>
            <Label icon="💶" text="Montant garanti" />
            <p className="text-white font-bold text-xl">{mission.amount_guaranteed} {mission.amount_currency ?? '€'}</p>
          </Card>
        )}

        {/* Remarques */}
        {mission.remarks_general && (
          <Card>
            <Label icon="📝" text="Remarques" />
            <p className="text-white text-sm whitespace-pre-wrap">{mission.remarks_general}</p>
          </Card>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">⚠️ {error}</div>
        )}
      </div>

      {/* ── Boutons fixes en bas ──────────────────────────────────────────────── */}
      {!isReadOnly && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4 z-10 space-y-2">

          {/* Bouton paiement — toujours visible si montant à réclamer */}
          {encaissementUrl && (
            <a href={encaissementUrl}
              className="w-full flex items-center justify-between px-5 py-4 bg-brand rounded-2xl text-white font-bold text-base shadow-lg">
              <span>💳 Encaisser le paiement</span>
              <span className="text-xl font-black">{mission.amount_to_collect} €</span>
            </a>
          )}

          {mission.status === 'assigned' && (
            <button onClick={() => doAction('accept')} disabled={loading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-lg">
              {loading ? '⏳…' : '✅ Accepter la mission'}
            </button>
          )}

          {mission.status === 'accepted' && (
            <button onClick={() => initialNavApp ? handleOnWay() : setShowNavModal(true)} disabled={loading}
              className="w-full py-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-lg">
              {loading ? '⏳…' : '🚗 Je suis en route → Navigation'}
            </button>
          )}

          {mission.status === 'in_progress' && !mission.on_site_at && (
            <button onClick={() => doAction('on_site')} disabled={loading}
              className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold rounded-2xl text-base shadow-lg">
              {loading ? '⏳…' : '📍 Je suis sur place'}
            </button>
          )}

          {mission.status === 'in_progress' && mission.on_site_at && (
            <button onClick={() => setShowWizard(true)}
              className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-2xl text-base shadow-lg">
              🏁 Clôturer la mission
            </button>
          )}

          {mission.status === 'parked' && (
            <button onClick={() => setShowWizard(true)}
              className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-2xl text-base shadow-lg">
              🏁 Clôturer la mission
            </button>
          )}
        </div>
      )}

      {/* Modals */}
      {showNavModal && <NavModal onSelect={handleNavChoice} />}
      {showPark && <ParkModal stages={stages} onClose={() => setShowPark(false)} onSubmit={handlePark} loading={loading} />}
      {showWizard && (
        <WizardClose
          mission={mission}
          onClose={() => setShowWizard(false)}
          onSubmit={handleComplete}
          loading={loading}
          navApp={navApp}
          onPark={() => { setShowWizard(false); loadStages(); setShowPark(true) }}
        />
      )}
    </div>
  )
}
