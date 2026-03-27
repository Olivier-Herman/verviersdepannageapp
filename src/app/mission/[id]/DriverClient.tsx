'use client'
// src/app/mission/[id]/DriverClient.tsx — P9

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ─────────────────────────────────────────────────────────────────────
type MissionStatus = 'new'|'dispatching'|'assigned'|'accepted'|'in_progress'|'parked'|'completed'|'delivering'
type NavApp        = 'gmaps'|'waze'|'apple'
type ClosingMode   = 'dsp'|'rem'|'dpr'

interface Stop {
  id: string; type: string; label: string
  address: string; lat: number|null; lng: number|null
  arrived_at: string|null; sort_order: number
}
interface Mission {
  id: string; status: MissionStatus
  external_id?: string; dossier_number?: string; source?: string
  mission_type?: string; incident_description?: string
  client_name?: string; client_phone?: string
  vehicle_brand?: string; vehicle_model?: string; vehicle_plate?: string; vehicle_vin?: string
  incident_address?: string; incident_city?: string; incident_lat?: number; incident_lng?: number
  destination_address?: string; destination_name?: string; destination_lat?: number; destination_lng?: number
  remarks_general?: string
  accepted_at?: string; on_way_at?: string; on_site_at?: string
  completed_at?: string; parked_at?: string; delivering_at?: string
  amount_guaranteed?: number; amount_currency?: string; amount_to_collect?: number
  park_stage_name?: string; extra_addresses?: Stop[]
}
interface VrLocation   { id: string; name: string; address: string; lat: number|null; lng: number|null }
interface FleetStage   { id: number; name: string }
interface Props { mission: Mission; currentUserId: string; isReadOnly?: boolean; navApp?: NavApp }

// ── Helpers ───────────────────────────────────────────────────────────────────
const normalizePlate  = (v: string) => v.replace(/[-.\s]/g, '').toUpperCase()
const fmt             = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '—'

function buildNavUrl(app: NavApp, lat?: number, lng?: number, addr?: string): string|null {
  const q = lat && lng ? `${lat},${lng}` : encodeURIComponent(addr || '')
  if (!q) return null
  if (app === 'waze')  return `https://waze.com/ul?ll=${q}&navigate=yes`
  if (app === 'apple') return `https://maps.apple.com/?daddr=${q}&dirflg=d`
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`
}

const TYPE_CONFIG: Record<string, { short: string; label: string; color: string }> = {
  DSP:              { short: 'DSP', label: 'Dépannage sur place',      color: 'bg-orange-500' },
  REM:              { short: 'REM', label: 'Remorquage',               color: 'bg-blue-600'   },
  DPR:              { short: 'DPR', label: 'Déplacement pour rien',    color: 'bg-zinc-600'   },
  VR:               { short: 'VR',  label: 'Véhicule de remplacement', color: 'bg-teal-600'   },
  AUT:              { short: 'AUT', label: 'Autre',                    color: 'bg-zinc-500'   },
  depannage:        { short: 'DSP', label: 'Dépannage sur place',      color: 'bg-orange-500' },
  remorquage:       { short: 'REM', label: 'Remorquage',               color: 'bg-blue-600'   },
  trajet_vide:      { short: 'DPR', label: 'Déplacement pour rien',    color: 'bg-zinc-600'   },
  reparation_place: { short: 'DSP', label: 'Réparation sur place',     color: 'bg-orange-500' },
  transport:        { short: 'TRN', label: 'Transport',                color: 'bg-purple-600' },
  autre:            { short: 'AUT', label: 'Autre',                    color: 'bg-zinc-500'   },
}
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  assigned:    { label: 'À accepter',  color: 'text-blue-400',   bg: 'bg-blue-500/10'   },
  accepted:    { label: 'Acceptée',    color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
  in_progress: { label: 'En cours',    color: 'text-orange-400', bg: 'bg-orange-500/10' },
  parked:      { label: 'En dépôt',    color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  delivering:  { label: 'En livraison',color: 'text-teal-400',   bg: 'bg-teal-500/10'   },
  completed:   { label: 'Terminée',    color: 'text-green-400',  bg: 'bg-green-500/10'  },
}
const NAV_APPS = [
  { id: 'gmaps' as NavApp, label: 'Google Maps', icon: '🗺️' },
  { id: 'waze'  as NavApp, label: 'Waze',        icon: '🧭' },
  { id: 'apple' as NavApp, label: 'Plans',       icon: '📍' },
]

// ── SignatureCanvas ────────────────────────────────────────────────────────────
function SignatureCanvas({ onSave }: { onSave: (d: string) => void }) {
  const ref     = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [drawn, setDrawn] = useState(false)
  const pos = (e: React.TouchEvent|React.MouseEvent, c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect()
    const s = 'touches' in e ? e.touches[0] : e
    return { x: s.clientX - r.left, y: s.clientY - r.top }
  }
  const start = (e: React.TouchEvent|React.MouseEvent) => {
    e.preventDefault(); const c = ref.current; if (!c) return
    const p = pos(e, c); const ctx = c.getContext('2d')!
    ctx.beginPath(); ctx.moveTo(p.x, p.y); drawing.current = true
  }
  const move = (e: React.TouchEvent|React.MouseEvent) => {
    e.preventDefault(); if (!drawing.current) return
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!; const p = pos(e, c)
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

// ── AddressInput Google Places ─────────────────────────────────────────────────
function AddressInput({ value, onChange, onSelect, placeholder, mapsReady }: {
  value: string; onChange: (v: string) => void
  onSelect: (addr: string, lat: number, lng: number) => void
  placeholder?: string; mapsReady?: boolean
}) {
  const ref   = useRef<HTMLInputElement>(null)
  const acRef = useRef<any>(null)
  const [gps, setGps] = useState(false)

  useEffect(() => {
    const init = () => {
      if (!ref.current || !(window as any).google?.maps?.places || acRef.current) return
      // Pas de restriction de type → accepte adresses ET établissements
      acRef.current = new (window as any).google.maps.places.Autocomplete(ref.current, {
        fields: ['name', 'formatted_address', 'geometry'],
      })
      acRef.current.addListener('place_changed', () => {
        const p = acRef.current.getPlace()
        if (p?.geometry) {
          const addr = p.name && p.formatted_address
            ? `${p.name}, ${p.formatted_address}`
            : (p.formatted_address || p.name || '')
          onChange(addr)
          onSelect(addr, p.geometry.location.lat(), p.geometry.location.lng())
        }
      })
    }
    if ((window as any).google?.maps?.places) init()
    else { const t = setInterval(() => { if ((window as any).google?.maps?.places) { init(); clearInterval(t) } }, 300); return () => clearInterval(t) }
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
        placeholder={placeholder || 'Adresse ou nom d\'établissement…'}
        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600" />
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"></span>
        <span className="text-zinc-600 text-xs">Google Places — adresses et établissements</span>
      </div>
      {value && <p className="text-green-400 text-xs truncate">✓ {value}</p>}
    </div>
  )
}

// ── AddressMenu — tap sur une adresse ─────────────────────────────────────────
function AddressMenu({ address, lat, lng, navApp, onNav, onEdit, onClose, navLabel }: {
  address: string; lat?: number; lng?: number; navApp: NavApp
  onNav: () => void; onEdit: () => void; onClose: () => void; navLabel?: string
}) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={onClose}>
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 space-y-2" onClick={e => e.stopPropagation()}>
        <p className="text-zinc-500 text-xs mb-3 truncate">{address}</p>
        <button onClick={onNav}
          className="w-full flex items-center gap-4 px-4 py-3.5 bg-[#111] border border-[#2a2a2a] hover:border-blue-500 rounded-2xl transition">
          <span className="text-xl">🗺️</span>
          <div className="text-left">
            <p className="text-white font-medium text-sm">{navLabel || 'Naviguer'}</p>
            <p className="text-zinc-500 text-xs">{navLabel?.includes('route') ? 'Lance GPS + valide En route' : 'Ouvrir l\'app de navigation'}</p>
          </div>
        </button>
        <button onClick={onEdit}
          className="w-full flex items-center gap-4 px-4 py-3.5 bg-[#111] border border-[#2a2a2a] hover:border-zinc-500 rounded-2xl transition">
          <span className="text-xl">✏️</span>
          <div className="text-left">
            <p className="text-white font-medium text-sm">Modifier l'adresse</p>
            <p className="text-zinc-500 text-xs">Google Places — adresses et établissements</p>
          </div>
        </button>
        <button onClick={onClose} className="w-full py-3 text-zinc-500 text-sm">Annuler</button>
      </div>
    </div>
  )
}

// ── VehicleEditSheet ────────────────────────────────────────────────────────────
function VehicleEditSheet({ plate, brand, model, vin, onSave, onClose }: {
  plate: string; brand?: string; model?: string; vin?: string
  onSave: (p: string, b: string, m: string, v: string) => void; onClose: () => void
}) {
  const [p, setP] = useState(normalizePlate(plate))
  const [b, setB] = useState(brand || '')
  const [m, setM] = useState(model || '')
  const [v, setV] = useState(vin || '')
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={onClose}>
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-white font-bold text-lg">Modifier le véhicule</h2>
          <button onClick={onClose} className="text-zinc-500 text-2xl">×</button>
        </div>
        <div>
          <p className="text-zinc-500 text-xs mb-1.5">Plaque</p>
          <input value={p} onChange={e => setP(normalizePlate(e.target.value))}
            placeholder="1ABC123" style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }}
            className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand uppercase" />
          <p className="text-zinc-600 text-xs mt-1">Tirets et points ignorés automatiquement</p>
        </div>
        {[['Marque', b, setB], ['Modèle', m, setM]] .map(([label, val, setter]) => (
          <div key={label as string}>
            <p className="text-zinc-500 text-xs mb-1.5">{label as string}</p>
            <input value={val as string} onChange={e => (setter as (v: string) => void)(e.target.value)}
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand" />
          </div>
        ))}
        <div>
          <p className="text-zinc-500 text-xs mb-1.5">VIN / Châssis <span className="text-zinc-700">(optionnel)</span></p>
          <input value={v} onChange={e => setV(e.target.value)} placeholder="WBAXXXXXXXX"
            style={{ fontFamily: 'monospace', fontSize: '12px' }}
            className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand" />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">Annuler</button>
          <button onClick={() => onSave(p, b, m, v)} className="flex-1 py-3 bg-brand text-white font-bold rounded-2xl text-sm">Enregistrer</button>
        </div>
      </div>
    </div>
  )
}

// ── DechargeSheet ──────────────────────────────────────────────────────────────
function DechargeSheet({ onSave, onClose }: {
  onSave: (motif: string, name: string, sig: string) => void; onClose: () => void
}) {
  const [motif,   setMotif]   = useState('')
  const [name,    setName]    = useState('')
  const [sigData, setSigData] = useState('')
  const [showSig, setShowSig] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={onClose}>
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 max-h-[85vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">Décharge client</h2>
          <button onClick={onClose} className="text-zinc-500 text-2xl">×</button>
        </div>
        <div>
          <p className="text-zinc-500 text-xs mb-1.5">Motif de la décharge *</p>
          <textarea rows={3} value={motif} onChange={e => setMotif(e.target.value)}
            placeholder="Ex : client refuse le remorquage, véhicule laissé sur place, travaux impossibles car…"
            className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand resize-none" />
        </div>
        <div>
          <p className="text-zinc-500 text-xs mb-1.5">Nom du signataire</p>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Prénom Nom du client"
            className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand" />
        </div>
        <div>
          <p className="text-zinc-500 text-xs mb-1.5">Signature</p>
          {!sigData ? (
            showSig
              ? <SignatureCanvas onSave={d => { setSigData(d); setShowSig(false) }} />
              : <button onClick={() => setShowSig(true)}
                  className="w-full py-3 border border-dashed border-[#2a2a2a] rounded-xl text-zinc-400 text-sm">
                  ✍️ Faire signer le client
                </button>
          ) : (
            <div>
              <div className="border border-green-500/30 rounded-xl overflow-hidden bg-[#111] mb-1">
                <img src={sigData} alt="Signature" className="w-full max-h-20 object-contain" />
              </div>
              <div className="flex justify-between">
                <span className="text-green-400 text-xs">✅ Signé par {name || 'client'}</span>
                <button onClick={() => setSigData('')} className="text-zinc-500 text-xs">Refaire</button>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">Annuler</button>
          <button onClick={() => motif && onSave(motif, name, sigData)} disabled={!motif}
            className="flex-1 py-3 bg-amber-600 disabled:opacity-40 text-white font-bold rounded-2xl text-sm">
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}

// ── NavModal ────────────────────────────────────────────────────────────────────
function NavModal({ onSelect }: { onSelect: (app: NavApp) => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end">
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6">
        <h2 className="text-white font-bold text-lg mb-1">Choisir l'app de navigation</h2>
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

// ── ParkModal ────────────────────────────────────────────────────────────────────
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
          <p className="text-zinc-500 text-xs mb-2">Parc de destination</p>
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
          <p className="text-zinc-500 text-xs mb-2">Notes (optionnel)</p>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
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

// ── WizardRapport — Rapport Mission DSP/REM (km+photos+remarques) ──────────────
function WizardRapport({ mission, closingMode, navApp, mapsReady, onClose, onSubmit, loading }: {
  mission: Mission; closingMode: ClosingMode; navApp: NavApp; mapsReady: boolean
  onClose: () => void; onSubmit: (data: any) => void; loading: boolean
}) {
  const isREM = closingMode === 'rem'
  const isDPR = closingMode === 'dpr'

  // Stops REM
  const [remSubtype,   setRemSubtype]   = useState<'simple'|'vr'|'client'|null>(null)
  const [vrAddr,       setVrAddr]       = useState(''); const [vrLat, setVrLat] = useState<number|null>(null); const [vrLng, setVrLng] = useState<number|null>(null)
  const [clientAddr,   setClientAddr]   = useState(''); const [clientLat, setClientLat] = useState<number|null>(null); const [clientLng, setClientLng] = useState<number|null>(null)
  const [destAddr,     setDestAddr]     = useState(mission.destination_address || ''); const [destLat, setDestLat] = useState<number|null>(mission.destination_lat ?? null); const [destLng, setDestLng] = useState<number|null>(mission.destination_lng ?? null)
  const [vrLocations,  setVrLocations]  = useState<VrLocation[]>([])
  const [stops,        setStops]        = useState<any[]>([])
  const [stopsReady,   setStopsReady]   = useState(false)

  // Km + photos
  const [mileage,  setMileage]  = useState('')
  const [photos,   setPhotos]   = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [note,     setNote]     = useState('')

  // Decharge
  const [decharge,        setDecharge]        = useState<{motif:string;name:string;sig:string}|null>(null)
  const [showDecharge,    setShowDecharge]     = useState(false)
  const [showDestMenu,    setShowDestMenu]     = useState(false)
  const [showVrEditAddr,  setShowVrEditAddr]   = useState(false)
  const [showClntEditAddr,setShowClntEditAddr] = useState(false)
  const [showDestEdit,    setShowDestEdit]     = useState(false)
  const [errors,          setErrors]           = useState<string[]>([])

  const photoInput = useRef<HTMLInputElement>(null)

  // Screen state for REM
  type Screen = 'type'|'vr_addr'|'client_addr'|'stops'|'rapport'
  const [screen, setScreen] = useState<Screen>(isREM ? 'type' : isDPR ? 'rapport' : 'rapport')

  useEffect(() => {
    if (isREM) fetch('/api/vr-locations').then(r => r.json()).then(d => setVrLocations(Array.isArray(d) ? d : [])).catch(() => {})
  }, [isREM])

  const buildStops = () => {
    const s: any[] = []
    if (clientAddr) s.push({ id: crypto.randomUUID(), type: 'client', label: 'Reconduire le client', address: clientAddr, lat: clientLat, lng: clientLng, arrived_at: null, sort_order: s.length })
    if (vrAddr)     s.push({ id: crypto.randomUUID(), type: 'vr',     label: 'Livraison VR',         address: vrAddr,     lat: vrLat,     lng: vrLng,     arrived_at: null, sort_order: s.length })
    if (destAddr)   s.push({ id: crypto.randomUUID(), type: 'dest',   label: 'Destination véhicule', address: destAddr,   lat: destLat,   lng: destLng,   arrived_at: null, sort_order: s.length })
    else if (mission.destination_address) s.push({ id: crypto.randomUUID(), type: 'dest', label: 'Destination véhicule', address: mission.destination_address, lat: null, lng: null, arrived_at: null, sort_order: s.length })
    setStops(s); setStopsReady(true)
    setScreen('stops')
  }

  const addPhotos = (files: FileList|null) => {
    if (!files) return
    Array.from(files).forEach(f => {
      setPhotos(p => [...p, f])
      const r = new FileReader(); r.onload = e => setPreviews(p => [...p, e.target?.result as string]); r.readAsDataURL(f)
    })
  }

  const handleSubmit = () => {
    setErrors([])
    if (!isDPR) {
      const errs: string[] = []
      if (!mileage) errs.push('Kilométrage obligatoire')
      if (photos.length < 3) errs.push('Minimum 3 photos requises')
      if (errs.length > 0) { setErrors(errs); return }
    }
    onSubmit({ closingMode, mileage, photos, note, decharge, stops: stopsReady ? stops : [], destAddr, destLat, destLng, vrAddr, vrLat, vrLng, clientAddr, clientLat, clientLng })
  }

  // ── DPR flow — ultra léger ────────────────────────────────────────────────
  if (isDPR) {
    return (
      <div className="fixed inset-0 bg-[#0F0F0F] z-50 flex flex-col">
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={onClose} className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg">←</button>
            <p className="text-white font-bold text-base flex-1">Rapport Mission — DPR</p>
            <button onClick={onClose} className="text-zinc-500 text-2xl">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
          <div className="bg-zinc-600/20 border border-zinc-600/40 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">🚫</span>
            <div>
              <p className="text-white font-semibold text-sm">Déplacement pour rien</p>
              <p className="text-zinc-400 text-xs mt-1">Aucun kilométrage ni photo requis. Explique la situation si nécessaire.</p>
            </div>
          </div>
          <div>
            <p className="text-zinc-500 text-xs mb-2">Remarques <span className="text-zinc-700">(optionnel)</span></p>
            <textarea rows={4} value={note} onChange={e => setNote(e.target.value)}
              placeholder="Véhicule introuvable, accès impossible, client absent, annulation…"
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand resize-none" />
          </div>
        </div>
        <div className="flex-shrink-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4 space-y-2">
          <button onClick={() => setShowDecharge(true)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-2xl text-sm font-medium transition ${decharge ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
            📋 {decharge ? 'Décharge ajoutée ✓' : 'Ajouter une décharge'}
          </button>
          <button onClick={handleSubmit} disabled={loading}
            className="w-full py-4 bg-zinc-600 hover:bg-zinc-700 disabled:opacity-40 text-white font-bold rounded-2xl text-base transition">
            {loading ? '⏳…' : '🚫 Clôturer la mission'}
          </button>
        </div>
        {showDecharge && <DechargeSheet onClose={() => setShowDecharge(false)} onSave={(m,n,s) => { setDecharge({motif:m,name:n,sig:s}); setShowDecharge(false) }} />}
      </div>
    )
  }

  // ── REM — type selection ───────────────────────────────────────────────────
  if (isREM && screen === 'type') {
    const REM_BTNS = [
      { id: 'simple', icon: 'REM', color: 'bg-blue-600',  label: 'REM Confirmé',         sub: 'Remorquage simple' },
      { id: 'vr',     icon: '🚗',  color: 'bg-teal-700',  label: 'REM + VR',              sub: 'Véhicule de remplacement' },
      { id: 'client', icon: '👤',  color: 'bg-purple-700',label: 'REM + Reconduire client',sub: 'Dépôt client à une adresse' },
    ]
    return (
      <div className="fixed inset-0 bg-[#0F0F0F] z-50 flex flex-col">
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={onClose} className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg">←</button>
            <p className="text-white font-bold text-base flex-1">Rapport Mission — REM</p>
            <button onClick={onClose} className="text-zinc-500 text-2xl">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
          <p className="text-white font-semibold text-base">Type de remorquage</p>
          {REM_BTNS.map(b => (
            <button key={b.id} onClick={() => { setRemSubtype(b.id as any); if (b.id === 'vr') setScreen('vr_addr'); else if (b.id === 'client') setScreen('client_addr'); else buildStops() }}
              className="w-full flex items-center gap-4 px-5 py-4 bg-[#1A1A1A] border-2 border-[#2a2a2a] hover:border-zinc-600 text-white rounded-2xl transition active:scale-[0.98]">
              <div className={`${b.color} rounded-xl w-10 h-10 flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>{b.icon}</div>
              <div className="text-left"><p className="font-semibold">{b.label}</p><p className="text-zinc-400 text-xs">{b.sub}</p></div>
            </button>
          ))}
        </div>
        <div className="flex-shrink-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4">
          <button onClick={() => setShowDecharge(true)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-2xl text-sm font-medium ${decharge ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
            📋 {decharge ? 'Décharge ajoutée ✓' : 'Ajouter une décharge'}
          </button>
        </div>
        {showDecharge && <DechargeSheet onClose={() => setShowDecharge(false)} onSave={(m,n,s) => { setDecharge({motif:m,name:n,sig:s}); setShowDecharge(false) }} />}
      </div>
    )
  }

  // ── REM — saisie adresse VR ou client ─────────────────────────────────────
  if (isREM && (screen === 'vr_addr' || screen === 'client_addr')) {
    const isVR   = screen === 'vr_addr'
    const label  = isVR ? 'Où se trouve le VR ?' : 'Où reconduire le client ?'
    const ph     = isVR ? 'Rent A Car, garage, adresse…' : 'Domicile, gare, hôtel, adresse…'
    const addrV  = isVR ? vrAddr : clientAddr
    const setAddrV = isVR ? setVrAddr : setClientAddr
    const setLatV  = isVR ? setVrLat : setClientLat
    const setLngV  = isVR ? setVrLng : setClientLng
    return (
      <div className="fixed inset-0 bg-[#0F0F0F] z-50 flex flex-col">
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => setScreen('type')} className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg">←</button>
            <p className="text-white font-bold text-base flex-1">{label}</p>
            <button onClick={onClose} className="text-zinc-500 text-2xl">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
          {isVR && vrLocations.length > 0 && (
            <div>
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-2">⭐ Pré-enregistrés</p>
              <div className="space-y-2">
                {vrLocations.map(vr => (
                  <button key={vr.id} onClick={() => { setAddrV(`${vr.name}, ${vr.address}`); if (vr.lat) setLatV(vr.lat); if (vr.lng) setLngV(vr.lng) }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 text-left transition ${addrV.includes(vr.name) ? 'bg-teal-500/15 border-teal-500' : 'bg-[#1A1A1A] border-[#2a2a2a] hover:border-teal-500/50'}`}>
                    <span className="text-teal-400 text-lg flex-shrink-0">🚗</span>
                    <div className="min-w-0"><p className="text-white text-sm font-semibold truncate">{vr.name}</p><p className="text-zinc-500 text-xs truncate">{vr.address}</p></div>
                    {addrV.includes(vr.name) && <span className="text-teal-400 text-lg flex-shrink-0">✓</span>}
                  </button>
                ))}
              </div>
              <p className="text-zinc-600 text-xs mt-3 mb-1">— ou saisir une autre adresse —</p>
            </div>
          )}
          <AddressInput value={addrV} onChange={setAddrV}
            onSelect={(a, lat, lng) => { setAddrV(a); setLatV(lat); setLngV(lng) }}
            placeholder={ph} mapsReady={mapsReady} />
        </div>
        <div className="flex-shrink-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4 space-y-2">
          <button onClick={() => setShowDecharge(true)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-2xl text-sm font-medium ${decharge ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
            📋 {decharge ? 'Décharge ajoutée ✓' : 'Ajouter une décharge'}
          </button>
          <button onClick={buildStops} disabled={!addrV}
            className="w-full py-4 bg-brand disabled:opacity-40 text-white font-bold rounded-2xl text-base transition">
            Enregistrer →
          </button>
        </div>
        {showDecharge && <DechargeSheet onClose={() => setShowDecharge(false)} onSave={(m,n,s) => { setDecharge({motif:m,name:n,sig:s}); setShowDecharge(false) }} />}
      </div>
    )
  }

  // ── REM — itinéraire drag & drop ──────────────────────────────────────────
  if (isREM && screen === 'stops') {
    const STOP_COLORS: Record<string,string> = { client: '#7c3aed', vr: '#0f766e', dest: '#2563eb' }
    const STOP_ICONS:  Record<string,string> = { client: '👤', vr: '🚗', dest: '🏁' }
    const dragIdx = useRef<number|null>(null)
    const [, forceUpdate] = useState(0)

    const handleDragStart = (i: number) => { dragIdx.current = i }
    const handleDragOver  = (e: React.DragEvent) => { e.preventDefault() }
    const handleDrop      = (i: number) => {
      if (dragIdx.current === null || dragIdx.current === i) return
      const ns = [...stops]; const [m] = ns.splice(dragIdx.current, 1); ns.splice(i, 0, m)
      setStops(ns); dragIdx.current = null; forceUpdate(n => n+1)
    }

    return (
      <div className="fixed inset-0 bg-[#0F0F0F] z-50 flex flex-col">
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => setScreen(remSubtype === 'vr' ? 'vr_addr' : remSubtype === 'client' ? 'client_addr' : 'type')}
              className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg">←</button>
            <p className="text-white font-bold text-base flex-1">Rapport Mission — Itinéraire</p>
            <button onClick={onClose} className="text-zinc-500 text-2xl">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <p className="text-white font-semibold">Ordre des stops</p>
          <p className="text-zinc-500 text-xs">Glisser pour réordonner · 🗺️ pour naviguer</p>
          {stops.map((stop, i) => {
            const navUrl = buildNavUrl(navApp, stop.lat ?? undefined, stop.lng ?? undefined, stop.address)
            return (
              <div key={stop.id} draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(i)}
                className="bg-[#1A1A1A] border-2 border-[#2a2a2a] rounded-2xl p-4 flex items-start gap-3 cursor-grab active:opacity-60">
                <div className="flex flex-col gap-1 pt-1 flex-shrink-0">
                  {[0,1,2].map(j => <div key={j} className="w-4 h-0.5 bg-zinc-600 rounded" />)}
                </div>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: STOP_COLORS[stop.type] || '#2563eb' }}>
                  {STOP_ICONS[stop.type] || '📍'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm">{stop.label}</p>
                  <p className="text-zinc-500 text-xs truncate">{stop.address}</p>
                  {navUrl && (
                    <a href={navUrl} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-blue-600/15 border border-blue-500/30 rounded-lg text-blue-300 text-xs font-medium">
                      🗺️ Naviguer
                    </a>
                  )}
                </div>
                <span className="text-zinc-600 text-sm font-bold flex-shrink-0">{i+1}</span>
              </div>
            )
          })}
        </div>
        <div className="flex-shrink-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4 space-y-2">
          <button onClick={() => setShowDecharge(true)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-2xl text-sm font-medium ${decharge ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
            📋 {decharge ? 'Décharge ajoutée ✓' : 'Ajouter une décharge'}
          </button>
          <button onClick={() => setScreen('rapport')} className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl text-base">🏁 Remorquage Terminé</button>
          <button onClick={() => { onSubmit({ closingMode: 'rem_park', mileage: '0', photos: [], note, decharge, stops }) }}
            className="w-full py-4 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-2xl text-base">🅿️ Mise en parc</button>
        </div>
        {showDecharge && <DechargeSheet onClose={() => setShowDecharge(false)} onSave={(m,n,s) => { setDecharge({motif:m,name:n,sig:s}); setShowDecharge(false) }} />}
      </div>
    )
  }

  // ── Rapport km + photos + remarques (DSP et REM terminé/parc) ────────────
  const canSubmit = mileage.length > 0 && photos.length >= 3
  return (
    <div className="fixed inset-0 bg-[#0F0F0F] z-50 flex flex-col">
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => isREM ? setScreen('stops') : onClose()} className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg">←</button>
          <p className="text-white font-bold text-base flex-1">Rapport Mission</p>
          <button onClick={onClose} className="text-zinc-500 text-2xl">×</button>
        </div>
      </div>
      <div className="bg-[#111] border-b border-[#2a2a2a] px-4 py-2.5 flex items-center gap-2 flex-shrink-0">
        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold text-white ${isREM ? 'bg-blue-600' : 'bg-orange-500'}`}>{isREM ? 'REM' : 'DSP'}</span>
        {mission.client_name && <span className="text-white text-sm font-semibold">{mission.client_name}</span>}
        {mission.vehicle_plate && <span className="text-zinc-400 text-xs font-mono">{normalizePlate(mission.vehicle_plate)}</span>}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
        {/* Km */}
        <div>
          <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-2">Kilométrage *</p>
          <div className="bg-[#111] border-2 border-[#2a2a2a] rounded-2xl p-4 text-center focus-within:border-brand transition">
            <p className="text-zinc-600 text-xs mb-2">Relève le compteur du véhicule</p>
            <input type="number" inputMode="numeric" value={mileage} onChange={e => setMileage(e.target.value)}
              placeholder="— — — — —"
              className="bg-transparent border-none text-white text-4xl font-mono text-center w-full focus:outline-none" />
            <p className="text-zinc-600 text-xs mt-1">km</p>
          </div>
        </div>
        {/* Photos */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest">Photos *</p>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${photos.length >= 3 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {photos.length >= 3 ? `${photos.length} ✓` : `${photos.length} / min. 3`}
            </span>
          </div>
          <p className="text-zinc-600 text-xs mb-3">Châssis · Plaque · Vue générale</p>
          {previews.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {previews.map((src, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button onClick={() => { setPhotos(p => p.filter((_,j)=>j!==i)); setPreviews(p => p.filter((_,j)=>j!==i)) }}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-white text-xs flex items-center justify-center">✕</button>
                </div>
              ))}
            </div>
          )}
          <input ref={photoInput} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => addPhotos(e.target.files)} />
          <button onClick={() => photoInput.current?.click()}
            className="w-full py-3.5 border-2 border-dashed border-[#2a2a2a] hover:border-brand rounded-2xl text-zinc-400 hover:text-white text-sm transition flex items-center justify-center gap-2">
            📷 Prendre des photos
          </button>
        </div>
        {/* Remarques */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest">Remarques</p>
            <span className="text-zinc-700 text-xs">optionnel</span>
          </div>
          <textarea rows={3} value={note} onChange={e => setNote(e.target.value)}
            placeholder="Difficultés, observations, infos importantes…"
            className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-brand resize-none" />
        </div>
        {errors.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
            {errors.map((e, i) => <p key={i} className="text-red-400 text-sm">⚠️ {e}</p>)}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4 space-y-2">
        <button onClick={() => setShowDecharge(true)}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-2xl text-sm font-medium ${decharge ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
          📋 {decharge ? 'Décharge ajoutée ✓' : 'Ajouter une décharge'}
        </button>
        <button onClick={handleSubmit} disabled={loading || !canSubmit}
          className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-bold rounded-2xl text-base transition">
          {loading ? '⏳ Envoi…' : '🏁 Terminer la mission'}
        </button>
      </div>
      {showDecharge && <DechargeSheet onClose={() => setShowDecharge(false)} onSave={(m,n,s) => { setDecharge({motif:m,name:n,sig:s}); setShowDecharge(false) }} />}
    </div>
  )
}

// ── StopsDeliveryScreen ────────────────────────────────────────────────────────
function StopsDeliveryScreen({ mission, navApp, onArrive, onReorder, onFinish, loading }: {
  mission: Mission; navApp: NavApp; loading: boolean
  onArrive: (id: string) => void; onReorder: (s: Stop[]) => void
  onFinish: (mode: string, depot: any) => void
}) {
  const stops      = [...(mission.extra_addresses || [])].sort((a,b) => a.sort_order - b.sort_order)
  const allArrived = stops.length > 0 && stops.every(s => s.arrived_at)
  const closingMode= stops.find(s => s.type === 'depot') ? 'depot' : 'direct'
  const depotStop  = stops.find(s => s.type === 'depot')
  const [dragIdx, setDragIdx]       = useState<number|null>(null)
  const [dragOver, setDragOver]     = useState<number|null>(null)

  return (
    <div className="min-h-screen bg-[#0F0F0F] pb-40">
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 sticky top-0 z-20">
        <div className="flex items-center gap-2 mb-1">
          <span className="px-2.5 py-1 bg-teal-600 rounded-lg text-xs font-bold text-white">EN LIVRAISON</span>
          <span className="text-white font-bold truncate">{mission.client_name}</span>
        </div>
        <p className="text-zinc-500 text-xs">{stops.filter(s=>s.arrived_at).length}/{stops.length} stops effectués</p>
        <div className="h-1 bg-[#2a2a2a] rounded-full overflow-hidden mt-2">
          <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${stops.length ? (stops.filter(s=>s.arrived_at).length / stops.length * 100) : 0}%` }} />
        </div>
      </div>
      <div className="px-4 mt-4 space-y-3">
        <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Glisser pour réordonner</p>
        {stops.map((stop, i) => {
          const isDone = !!stop.arrived_at
          const isNext = !isDone && stops.slice(0, i).every(s => s.arrived_at)
          const navUrl = buildNavUrl(navApp, stop.lat ?? undefined, stop.lng ?? undefined, stop.address)
          const COLORS: Record<string,string> = { client: '#7c3aed', vr: '#0f766e', dest: '#2563eb', depot: '#d97706' }
          return (
            <div key={stop.id} draggable={!isDone}
              onDragStart={() => setDragIdx(i)}
              onDragOver={e => { e.preventDefault(); setDragOver(i) }}
              onDrop={() => {
                if (dragIdx === null || dragIdx === i) { setDragIdx(null); setDragOver(null); return }
                const ns = [...stops]; const [m] = ns.splice(dragIdx, 1); ns.splice(i, 0, m)
                onReorder(ns); setDragIdx(null); setDragOver(null)
              }}
              className={`bg-[#1A1A1A] border-2 rounded-2xl p-4 transition ${isDone ? 'border-green-500/30 opacity-60' : isNext ? 'border-teal-500' : dragOver === i ? 'border-brand' : 'border-[#2a2a2a]'}`}>
              <div className="flex items-start gap-3">
                {!isDone && (<div className="flex flex-col gap-1 pt-1 flex-shrink-0 cursor-grab">{[0,1,2].map(j=><div key={j} className="w-4 h-0.5 bg-zinc-600 rounded"/>)}</div>)}
                {isDone  && <span className="text-green-400 text-xl flex-shrink-0">✓</span>}
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: COLORS[stop.type] || '#2563eb' }}>
                  {stop.type === 'vr' ? '🚗' : stop.type === 'client' ? '👤' : stop.type === 'depot' ? '🅿️' : '🏁'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-white font-bold text-sm">{stop.label}</p>
                    {isNext && <span className="px-1.5 py-0.5 bg-teal-500/20 border border-teal-500/40 text-teal-300 text-xs rounded">Prochain</span>}
                  </div>
                  <p className="text-zinc-400 text-xs truncate">{stop.address}</p>
                  {isDone && stop.arrived_at && <p className="text-green-400 text-xs mt-1">Arrivé à {fmt(stop.arrived_at)}</p>}
                  {isNext && navUrl && (
                    <a href={navUrl} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-blue-600/15 border border-blue-500/30 rounded-lg text-blue-300 text-xs font-medium">
                      🗺️ Naviguer
                    </a>
                  )}
                </div>
              </div>
              {isNext && (
                <button onClick={() => onArrive(stop.id)} disabled={loading}
                  className="w-full mt-3 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-bold rounded-xl text-sm transition">
                  {loading ? '⏳' : '✅ Arrivé'}
                </button>
              )}
            </div>
          )
        })}
        {allArrived && (
          <div className="mt-4 space-y-3">
            <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 text-center">
              <p className="text-green-400 font-bold text-lg mb-1">🎉 Tous les stops effectués</p>
              <p className="text-zinc-400 text-sm">Confirme la fin de la mission</p>
            </div>
            {closingMode === 'depot' ? (
              <button onClick={() => onFinish('depot', depotStop ? { name: depotStop.label } : null)} disabled={loading}
                className="w-full py-4 bg-yellow-500 disabled:opacity-40 text-black font-bold rounded-2xl">
                {loading ? '⏳' : '🅿️ Confirmer la mise en dépôt'}
              </button>
            ) : (
              <button onClick={() => onFinish('direct', null)} disabled={loading}
                className="w-full py-4 bg-green-600 disabled:opacity-40 text-white font-bold rounded-2xl">
                {loading ? '⏳' : '🏁 Terminer la mission'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────
export default function DriverClient({ mission: initial, currentUserId, isReadOnly = false, navApp: initialNavApp }: Props) {
  const router = useRouter()
  const [mission,        setMission]        = useState<Mission>(initial)
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState<string|null>(null)
  const [navApp,         setNavApp]         = useState<NavApp>(initialNavApp || 'gmaps')
  const [mapsReady,      setMapsReady]      = useState(!!(window as any)?.google?.maps?.places)
  const [showNavModal,   setShowNavModal]   = useState(false)
  const [showWizard,     setShowWizard]     = useState(false)
  const [wizardMode,     setWizardMode]     = useState<ClosingMode>('dsp')
  const [showPark,       setShowPark]       = useState(false)
  const [stages,         setStages]         = useState<FleetStage[]>([])
  const [stagesLoaded,   setStagesLoaded]   = useState(false)
  const [showVehicleEdit,setShowVehicleEdit]= useState(false)
  const [showDecharge,   setShowDecharge]   = useState(false)
  const [decharge,       setDecharge]       = useState<{motif:string;name:string;sig:string}|null>(null)
  const [paid,           setPaid]           = useState(false)
  // Address menus
  const [addrMenuType,   setAddrMenuType]   = useState<'incident'|'dest'|null>(null)
  const [editAddrType,   setEditAddrType]   = useState<'incident'|'dest'|null>(null)

  const typeInfo   = TYPE_CONFIG[mission.mission_type || 'autre'] ?? TYPE_CONFIG.autre
  const statusConf = STATUS_CONFIG[mission.status] || { label: mission.status, color: 'text-zinc-400', bg: 'bg-zinc-500/10' }
  const isREM      = ['REM','remorquage'].includes(mission.mission_type || '')

  // Charger Google Maps
  useEffect(() => {
    if ((window as any).google?.maps?.places) { setMapsReady(true); return }
    const existing = document.getElementById('gm-driver-script')
    if (existing) { const t = setInterval(() => { if ((window as any).google?.maps?.places) { setMapsReady(true); clearInterval(t) } }, 200); return () => clearInterval(t) }
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; if (!key) return
    const s = document.createElement('script'); s.id = 'gm-driver-script'
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&language=fr`
    s.onload = () => setMapsReady(true); document.head.appendChild(s)
  }, [])

  const loadStages = async () => {
    if (stagesLoaded) return
    try { const r = await fetch('/api/odoo/fleet-stages'); setStages(await r.json() || []) } catch {}
    setStagesLoaded(true)
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
      if (action === 'on_site') { setWizardMode(isREM ? 'rem' : 'dsp'); setShowWizard(true) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur inconnue') }
    finally { setLoading(false) }
  }

  const handleOnWay = async (selectedApp?: NavApp) => {
    const app = selectedApp || navApp
    await doAction('on_way')
    const url = buildNavUrl(app, mission.incident_lat, mission.incident_lng, mission.incident_address)
    if (url) window.open(url, '_blank')
  }

  const handleNavChoice = async (app: NavApp) => {
    setNavApp(app); setShowNavModal(false)
    await fetch('/api/users/nav-preference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nav_app: app }) })
    await handleOnWay(app)
  }

  const handleNavDest = async () => {
    // Naviguer vers destination → valide "En route vers destination"
    const url = buildNavUrl(navApp, mission.destination_lat, mission.destination_lng, mission.destination_address)
    if (url) window.open(url, '_blank')
    setAddrMenuType(null)
    // Note : pas d'action API ici car "en route vers destination" est géré par delivering status
  }

  const uploadPhotos = async (missionId: string, files: File[]): Promise<string[]> => {
    const urls: string[] = []
    for (const file of files) {
      const ext  = file.name.split('.').pop() || 'jpg'
      const path = `${missionId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('mission-photos').upload(path, file)
      if (!error) { const { data } = supabase.storage.from('mission-photos').getPublicUrl(path); urls.push(data.publicUrl) }
    }
    return urls
  }

  const handleComplete = async (data: any) => {
    setLoading(true); setError(null)
    try {
      const photoUrls = await uploadPhotos(mission.id, data.photos || [])
      const isREMFinished = ['rem','rem_park'].includes(data.closingMode)
      const action  = (isREMFinished && data.stops?.length > 0) ? 'start_delivery'
                    : data.closingMode === 'rem_park'            ? 'park'
                    : 'completed'

      const closing: Record<string,unknown> = {
        final_mission_type:  data.closingMode === 'dpr' ? 'DPR' : isREMFinished ? 'REM' : 'DSP',
        mileage:             data.mileage ? parseInt(data.mileage) : undefined,
        destination_address: data.destAddr || undefined,
        stops:               data.stops?.length > 0 ? data.stops : undefined,
        photo_urls:          photoUrls,
        closing_notes:       data.note || undefined,
        closing_mode:        data.closingMode,
      }
      if (data.decharge) { (closing as any).discharge_motif = data.decharge.motif; (closing as any).discharge_name = data.decharge.name; (closing as any).discharge_sig = data.decharge.sig }

      const park_data = data.closingMode === 'rem_park' ? { stage_name: 'En parc' } : undefined

      const res = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: mission.id, action, closing_data: closing, park_data }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erreur serveur')
      setMission(json.mission); setShowWizard(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur inconnue') }
    finally { setLoading(false) }
  }

  const handleArriveStop = async (stopId: string) => {
    setLoading(true)
    try {
      const res  = await fetch('/api/missions/driver-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_id: mission.id, action: 'arrive_stop', stop_id: stopId }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMission(json.mission)
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur') }
    finally { setLoading(false) }
  }

  const handleReorderStops = async (newStops: Stop[]) => {
    const reordered = newStops.map((s, i) => ({ ...s, sort_order: i }))
    setMission(m => ({ ...m, extra_addresses: reordered }))
    try { await fetch('/api/missions/driver-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_id: mission.id, action: 'arrive_stop', stops: reordered }) }) } catch {}
  }

  const handleCompleteDelivery = async (closingMode: string, depot: any) => {
    setLoading(true)
    try {
      const action = closingMode === 'depot' ? 'park' : 'complete_delivery'
      const res    = await fetch('/api/missions/driver-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_id: mission.id, action, closing_data: { closing_mode: closingMode, depot }, park_data: closingMode === 'depot' && depot ? { stage_name: depot.name } : undefined }) })
      const json   = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMission(json.mission)
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur') }
    finally { setLoading(false) }
  }

  const handlePark = async (stageId: number, stageName: string, notes: string) => {
    await doAction('park', { park_data: { stage_id: stageId, stage_name: stageName, notes } })
    setShowPark(false)
  }

  const handleVehicleSave = async (plate: string, brand: string, model: string, vin: string) => {
    setMission(m => ({ ...m, vehicle_plate: plate, vehicle_brand: brand, vehicle_model: model, vehicle_vin: vin }))
    setShowVehicleEdit(false)
    try {
      await fetch('/api/missions/update-vehicle', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: mission.id, vehicle_plate: plate, vehicle_brand: brand, vehicle_model: model, vehicle_vin: vin }) })
    } catch {}
  }

  const handleAddrEdit = async (addr: string, lat: number, lng: number, type: 'incident'|'dest') => {
    if (type === 'incident') setMission(m => ({ ...m, incident_address: addr, incident_lat: lat, incident_lng: lng }))
    else setMission(m => ({ ...m, destination_address: addr, destination_lat: lat, destination_lng: lng }))
    setEditAddrType(null)
    try {
      await fetch('/api/missions/update-address', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: mission.id, type, address: addr, lat, lng }) })
    } catch {}
  }

  const encUrl = paid ? null : (mission.amount_to_collect && mission.amount_to_collect > 0
    ? `/encaissement?prefill_mission_id=${mission.id}&prefill_plate=${normalizePlate(mission.vehicle_plate||'')}&prefill_brand=${mission.vehicle_brand||''}&prefill_model=${mission.vehicle_model||''}&prefill_amount=${mission.amount_to_collect}&return_to=/mission/${mission.id}`
    : null)

  // ── Delivering screen ──────────────────────────────────────────────────────
  if (mission.status === 'delivering') {
    return <StopsDeliveryScreen mission={mission} navApp={navApp} loading={loading} onArrive={handleArriveStop} onReorder={handleReorderStops} onFinish={handleCompleteDelivery} />
  }

  // ── Completed screen ───────────────────────────────────────────────────────
  if (mission.status === 'completed') {
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl mb-4">🏁</div>
        <h1 className="text-white font-bold text-xl mb-2">Mission terminée !</h1>
        <p className="text-zinc-500 text-sm mb-6">{mission.client_name} — {mission.vehicle_plate && normalizePlate(mission.vehicle_plate)}</p>
        <button onClick={() => router.push('/mission')} className="px-6 py-3 bg-[#1A1A1A] border border-[#2a2a2a] text-white rounded-2xl text-sm">← Retour à mes missions</button>
      </div>
    )
  }

  // ── Main mission screen ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0F0F0F] pb-52">

      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 sticky top-0 z-20">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => router.push('/mission')} className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white">←</button>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold text-white ${typeInfo.color}`}>{typeInfo.short}</span>
            <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${statusConf.bg} ${statusConf.color}`}>{statusConf.label}</span>
          </div>
        </div>
        <h1 className="text-white font-bold text-lg truncate">{mission.client_name || 'Client inconnu'}</h1>
        <div className="flex items-center gap-3 mt-0.5">
          {mission.client_phone && (
            <a href={`tel:${mission.client_phone}`}
              className="inline-flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1 text-red-400 text-sm font-medium">
              📞 {mission.client_phone}
            </a>
          )}
          {mission.dossier_number && <p className="text-zinc-600 text-xs font-mono">{mission.dossier_number}</p>}
        </div>
      </div>

      <div className="px-4 mt-4 space-y-3">

        {/* En dépôt */}
        {mission.status === 'parked' && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4">
            <p className="text-yellow-400 font-bold text-sm mb-1">🅿️ Véhicule en dépôt</p>
            {mission.park_stage_name && <p className="text-yellow-300 text-xs">{mission.park_stage_name}</p>}
            {mission.parked_at && <p className="text-yellow-500/60 text-xs">Depuis {fmt(mission.parked_at)}</p>}
          </div>
        )}

        {/* Navigation en cours */}
        {mission.status === 'in_progress' && mission.on_way_at && !mission.on_site_at && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
            <p className="text-amber-400 font-bold text-sm mb-1">🚗 En route</p>
            {mission.incident_address && <p className="text-amber-300 text-xs">{mission.incident_address}</p>}
            {mission.on_way_at && <p className="text-amber-500/60 text-xs">Depuis {fmt(mission.on_way_at)}</p>}
            <button onClick={() => { const url = buildNavUrl(navApp, mission.incident_lat, mission.incident_lng, mission.incident_address); if (url) window.open(url, '_blank') }}
              className="mt-2 flex items-center gap-1.5 text-amber-400 text-xs font-medium">
              🗺️ Rouvrir la navigation
            </button>
          </div>
        )}

        {/* Véhicule — cliquable */}
        {(mission.vehicle_brand || mission.vehicle_plate) && (
          <button onClick={() => setShowVehicleEdit(true)}
            className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 text-left hover:border-zinc-600 transition">
            <div className="flex items-center justify-between mb-1">
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest">Véhicule</p>
              <span className="text-red-400 text-xs font-medium">✏️ Modifier</span>
            </div>
            <p className="text-white font-semibold">{[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')}</p>
            {mission.vehicle_plate && <p className="text-zinc-400 text-xs font-mono uppercase tracking-widest mt-0.5">{normalizePlate(mission.vehicle_plate)}</p>}
            {mission.vehicle_vin   && <p className="text-zinc-500 text-xs mt-0.5">VIN : {mission.vehicle_vin}</p>}
            <p className="text-zinc-700 text-xs mt-1">Appuyer pour modifier</p>
          </button>
        )}

        {/* Description */}
        {mission.incident_description && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-2">Description</p>
            <p className="text-white text-sm whitespace-pre-wrap">{mission.incident_description}</p>
          </div>
        )}

        {/* Lieu d'intervention — cliquable */}
        {(mission.incident_address || mission.incident_city) && (
          <button onClick={() => setAddrMenuType('incident')}
            className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 text-left hover:border-zinc-600 transition">
            <div className="flex items-center justify-between mb-1">
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest">Lieu d'intervention</p>
              <span className="text-zinc-600 text-xs">Appuyer</span>
            </div>
            <p className="text-white text-sm">{mission.incident_address}{mission.incident_city ? `, ${mission.incident_city}` : ''}</p>
          </button>
        )}

        {/* Destination — cliquable */}
        {mission.destination_address && (
          <button onClick={() => setAddrMenuType('dest')}
            className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 text-left hover:border-zinc-600 transition">
            <div className="flex items-center justify-between mb-1">
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest">Destination</p>
              <span className="text-zinc-600 text-xs">Appuyer</span>
            </div>
            {mission.destination_name && <p className="text-zinc-400 text-xs mb-0.5">{mission.destination_name}</p>}
            <p className="text-white text-sm">{mission.destination_address}</p>
          </button>
        )}

        {/* Montant garanti */}
        {mission.amount_guaranteed != null && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-1">Montant garanti</p>
            <p className="text-white font-bold text-xl">{mission.amount_guaranteed} {mission.amount_currency ?? '€'}</p>
          </div>
        )}

        {/* Remarques */}
        {mission.remarks_general && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-2">Remarques</p>
            <p className="text-white text-sm whitespace-pre-wrap">{mission.remarks_general}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">⚠️ {error}</div>
        )}
      </div>

      {/* ── Boutons fixes bas ───────────────────────────────────────────────── */}
      {!isReadOnly && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4 z-10 space-y-2">

          {/* Paiement persistant */}
          {encUrl && !paid && (
            <a href={encUrl} onClick={() => setTimeout(() => setPaid(true), 3000)}
              className="w-full flex items-center justify-between px-5 py-4 bg-brand rounded-2xl text-white font-bold text-base shadow-lg">
              <span>💳 Encaisser le paiement</span>
              <span className="text-xl font-black">{mission.amount_to_collect} €</span>
            </a>
          )}
          {paid && (
            <div className="w-full flex items-center justify-between px-5 py-4 bg-green-600/20 border border-green-500/40 rounded-2xl">
              <span className="text-green-400 font-bold">✅ Paiement encaissé</span>
              <span className="text-green-400 font-black">{mission.amount_to_collect} €</span>
            </div>
          )}

          {/* Bouton décharge (après sur place) */}
          {mission.on_site_at && (
            <button onClick={() => setShowDecharge(true)}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-2xl text-sm font-medium transition ${decharge ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
              📋 {decharge ? 'Décharge ajoutée ✓' : 'Ajouter une décharge'}
            </button>
          )}

          {/* Actions principales */}
          {mission.status === 'assigned' && (
            <button onClick={() => doAction('accept')} disabled={loading}
              className="w-full py-4 bg-blue-600 disabled:opacity-50 text-white font-bold rounded-2xl text-base">
              {loading ? '⏳…' : '✅ Accepter la mission'}
            </button>
          )}

          {mission.status === 'accepted' && (
            <button onClick={() => initialNavApp ? handleOnWay() : setShowNavModal(true)} disabled={loading}
              className="w-full py-4 bg-amber-500 disabled:opacity-50 text-white font-bold rounded-2xl text-base">
              {loading ? '⏳…' : '🚗 En route'}
            </button>
          )}

          {mission.status === 'in_progress' && !mission.on_site_at && (
            <button onClick={() => doAction('on_site')} disabled={loading}
              className="w-full py-4 bg-orange-500 disabled:opacity-50 text-white font-bold rounded-2xl text-base">
              {loading ? '⏳…' : '📍 Sur place'}
            </button>
          )}

          {/* Sur place — 3 boutons DSP */}
          {mission.status === 'in_progress' && mission.on_site_at && !isREM && (
            <div className="space-y-2">
              <button onClick={() => { setWizardMode('dsp'); setShowWizard(true) }}
                className="w-full flex items-center gap-3 px-5 py-4 bg-orange-500 text-white font-bold rounded-2xl text-sm">
                <div className="bg-black/20 rounded-lg w-9 h-9 flex items-center justify-center font-black text-xs flex-shrink-0">DSP</div>
                <div className="text-left"><p className="font-bold">DSP réussi</p><p className="opacity-75 text-xs font-normal">Dépannage effectué sur place</p></div>
              </button>
              <button onClick={() => { setWizardMode('rem'); setShowWizard(true) }}
                className="w-full flex items-center gap-3 px-5 py-4 bg-blue-600 text-white font-bold rounded-2xl text-sm">
                <div className="bg-black/20 rounded-lg w-9 h-9 flex items-center justify-center font-black text-xs flex-shrink-0">→</div>
                <div className="text-left"><p className="font-bold">DSP → REM</p><p className="opacity-75 text-xs font-normal">Finalement remorquage nécessaire</p></div>
              </button>
              <button onClick={() => { setWizardMode('dpr'); setShowWizard(true) }}
                className="w-full flex items-center gap-3 px-5 py-4 bg-zinc-600 text-white font-bold rounded-2xl text-sm">
                <div className="bg-black/20 rounded-lg w-9 h-9 flex items-center justify-center font-black text-xs flex-shrink-0">DPR</div>
                <div className="text-left"><p className="font-bold">DPR</p><p className="opacity-75 text-xs font-normal">Déplacement pour rien</p></div>
              </button>
            </div>
          )}

          {/* Sur place — 5 boutons REM */}
          {mission.status === 'in_progress' && mission.on_site_at && isREM && (
            <div className="space-y-2">
              {[
                { mode: 'rem' as ClosingMode, color: 'bg-blue-600',   icon: 'REM', label: 'REM Confirmé',          sub: 'Remorquage simple' },
                { mode: 'rem' as ClosingMode, color: 'bg-teal-700',   icon: '🚗',  label: 'REM + VR',               sub: 'Véhicule de remplacement', sub2: 'vr' },
                { mode: 'rem' as ClosingMode, color: 'bg-purple-700', icon: '👤',  label: 'REM + Reconduire client',sub: 'Dépôt client à une adresse', sub2: 'client' },
                { mode: 'dsp' as ClosingMode, color: 'bg-orange-500', icon: '→',   label: 'REM → DSP',              sub: 'Finalement réparé sur place' },
                { mode: 'dpr' as ClosingMode, color: 'bg-zinc-600',   icon: 'DPR', label: 'DPR',                    sub: 'Déplacement pour rien' },
              ].map((b, i) => (
                <button key={i} onClick={() => { setWizardMode(b.mode); setShowWizard(true) }}
                  className={`w-full flex items-center gap-3 px-5 py-3.5 ${b.color} text-white font-bold rounded-2xl text-sm`}>
                  <div className="bg-black/20 rounded-lg w-9 h-9 flex items-center justify-center font-black text-xs flex-shrink-0">{b.icon}</div>
                  <div className="text-left"><p className="font-bold text-sm">{b.label}</p><p className="opacity-75 text-xs font-normal">{b.sub}</p></div>
                </button>
              ))}
            </div>
          )}

          {mission.status === 'parked' && (
            <button onClick={() => { setWizardMode(isREM ? 'rem' : 'dsp'); setShowWizard(true) }}
              className="w-full py-4 bg-green-600 text-white font-bold rounded-2xl text-base">
              📋 Rapport Mission
            </button>
          )}
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────────── */}
      {showNavModal && <NavModal onSelect={handleNavChoice} />}

      {showPark && <ParkModal stages={stages} onClose={() => setShowPark(false)} onSubmit={handlePark} loading={loading} />}

      {showVehicleEdit && (
        <VehicleEditSheet
          plate={mission.vehicle_plate || ''} brand={mission.vehicle_brand} model={mission.vehicle_model} vin={mission.vehicle_vin}
          onClose={() => setShowVehicleEdit(false)} onSave={handleVehicleSave}
        />
      )}

      {showDecharge && (
        <DechargeSheet onClose={() => setShowDecharge(false)}
          onSave={(m, n, s) => { setDecharge({ motif: m, name: n, sig: s }); setShowDecharge(false) }} />
      )}

      {/* Address menus */}
      {addrMenuType === 'incident' && (
        <AddressMenu
          address={`${mission.incident_address || ''}${mission.incident_city ? `, ${mission.incident_city}` : ''}`}
          lat={mission.incident_lat} lng={mission.incident_lng} navApp={navApp}
          onClose={() => setAddrMenuType(null)}
          onNav={() => { const url = buildNavUrl(navApp, mission.incident_lat, mission.incident_lng, mission.incident_address); if (url) window.open(url, '_blank'); setAddrMenuType(null) }}
          onEdit={() => { setAddrMenuType(null); setEditAddrType('incident') }}
          navLabel="Naviguer vers ce lieu"
        />
      )}
      {addrMenuType === 'dest' && (
        <AddressMenu
          address={mission.destination_address || ''} lat={mission.destination_lat} lng={mission.destination_lng} navApp={navApp}
          onClose={() => setAddrMenuType(null)} onNav={handleNavDest}
          onEdit={() => { setAddrMenuType(null); setEditAddrType('dest') }}
          navLabel="Naviguer — En route vers destination"
        />
      )}

      {/* Address edit sheets */}
      {editAddrType && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end">
          <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-bold text-lg">{editAddrType === 'dest' ? 'Modifier la destination' : 'Modifier le lieu'}</h2>
              <button onClick={() => setEditAddrType(null)} className="text-zinc-500 text-2xl">×</button>
            </div>
            <AddressInput
              value={editAddrType === 'dest' ? (mission.destination_address || '') : (mission.incident_address || '')}
              onChange={() => {}}
              onSelect={(addr, lat, lng) => handleAddrEdit(addr, lat, lng, editAddrType)}
              mapsReady={mapsReady}
            />
            <button onClick={() => setEditAddrType(null)} className="w-full py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">Annuler</button>
          </div>
        </div>
      )}

      {/* Wizard */}
      {showWizard && (
        <WizardRapport
          mission={mission} closingMode={wizardMode} navApp={navApp} mapsReady={mapsReady}
          onClose={() => setShowWizard(false)} onSubmit={handleComplete} loading={loading}
        />
      )}
    </div>
  )
}
