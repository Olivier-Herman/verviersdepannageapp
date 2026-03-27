'use client'
// src/app/mission/[id]/DriverClient.tsx — v2 (grille d'actions, style TowSoft)

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ─────────────────────────────────────────────────────────────────────
type MissionStatus = 'new'|'dispatching'|'assigned'|'accepted'|'in_progress'|'parked'|'completed'|'delivering'
type NavApp        = 'gmaps'|'waze'|'apple'
type CloseType     = 'dsp'|'rem'|'dpr'
type Screen        = 'grid'|'photos'|'km_note'|'signature'|'decharge'|'encaissement'|'cloturer'|'stops'|'dpr_close'|'done'

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
  vehicle_brand?: string; vehicle_model?: string
  vehicle_plate?: string; vehicle_vin?: string
  incident_address?: string; incident_city?: string
  incident_lat?: number; incident_lng?: number
  destination_address?: string; destination_name?: string
  destination_lat?: number; destination_lng?: number
  remarks_general?: string
  accepted_at?: string; on_way_at?: string; on_site_at?: string
  completed_at?: string; parked_at?: string
  amount_guaranteed?: number; amount_currency?: string
  amount_to_collect?: number
  park_stage_name?: string; extra_addresses?: Stop[]
}
interface VrLocation { id: string; name: string; address: string; lat: number|null; lng: number|null }
interface Props { mission: Mission; currentUserId: string; isReadOnly?: boolean; navApp?: NavApp }

// ── Helpers ───────────────────────────────────────────────────────────────────
const normPlate = (v: string) => v.replace(/[-.\s]/g, '').toUpperCase()
const fmt       = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '—'
const isREM     = (t?: string) => ['REM','remorquage','transport'].includes(t || '')
const isDSP     = (t?: string) => ['DSP','depannage','reparation_place'].includes(t || '')

function navUrl(app: NavApp, lat?: number, lng?: number, addr?: string) {
  const q = lat && lng ? `${lat},${lng}` : encodeURIComponent(addr || '')
  if (!q) return null
  if (app === 'waze')  return `https://waze.com/ul?ll=${q}&navigate=yes`
  if (app === 'apple') return `https://maps.apple.com/?daddr=${q}&dirflg=d`
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`
}

const TYPE_LABEL: Record<string,string> = {
  DSP:'DSP', REM:'REM', DPR:'DPR',
  depannage:'DSP', remorquage:'REM', trajet_vide:'DPR',
  reparation_place:'DSP', transport:'REM', autre:'AUT',
}
const TYPE_COLOR: Record<string,string> = {
  DSP:'bg-orange-500', REM:'bg-blue-600', DPR:'bg-zinc-600',
  depannage:'bg-orange-500', remorquage:'bg-blue-600', trajet_vide:'bg-zinc-600',
  reparation_place:'bg-orange-500', transport:'bg-blue-600', autre:'bg-zinc-600',
}

// ── Sous-composants simples ───────────────────────────────────────────────────

function Pill({ label, color }: { label: string; color?: string }) {
  return <span className={`px-2.5 py-0.5 rounded-md text-xs font-medium text-white ${color || 'bg-zinc-600'}`}>{label}</span>
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-base flex-shrink-0">
      ←
    </button>
  )
}

// ── SignatureCanvas ───────────────────────────────────────────────────────────
function SignatureCanvas({ onSave }: { onSave: (d: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [drawn, setDrawn] = useState(false)
  const pos = (e: React.TouchEvent | React.MouseEvent, c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect()
    const s = 'touches' in e ? e.touches[0] : e
    return { x: s.clientX - r.left, y: s.clientY - r.top }
  }
  const start = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault(); const c = ref.current; if (!c) return
    const p = pos(e, c); const ctx = c.getContext('2d')!
    ctx.beginPath(); ctx.moveTo(p.x, p.y); drawing.current = true
  }
  const move = (e: React.TouchEvent | React.MouseEvent) => {
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
      <div className="border border-[#2a2a2a] rounded-xl overflow-hidden bg-[#111] mb-3">
        <canvas ref={ref} width={340} height={140} className="w-full touch-none"
          onMouseDown={start} onMouseMove={move} onMouseUp={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
      </div>
      <div className="flex gap-2">
        <button onClick={clear} className="flex-1 py-2.5 bg-[#2a2a2a] text-zinc-400 rounded-xl text-sm">Effacer</button>
        <button onClick={() => ref.current && onSave(ref.current.toDataURL())} disabled={!drawn}
          className="flex-1 py-2.5 bg-green-600 disabled:opacity-40 text-white rounded-xl text-sm font-medium">
          ✅ Valider
        </button>
      </div>
    </div>
  )
}

// ── AddressInput ──────────────────────────────────────────────────────────────
function AddressInput({ value, onChange, onSelect, placeholder }: {
  value: string; onChange: (v: string) => void
  onSelect: (addr: string, lat: number, lng: number) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const ac  = useRef<any>(null)
  const [gps, setGps] = useState(false)

  useEffect(() => {
    const init = () => {
      if (!ref.current || !(window as any).google?.maps?.places || ac.current) return
      ac.current = new (window as any).google.maps.places.Autocomplete(ref.current, {
        fields: ['name', 'formatted_address', 'geometry'],
      })
      ac.current.addListener('place_changed', () => {
        const p = ac.current.getPlace()
        if (p?.geometry) {
          const a = p.name && p.formatted_address ? `${p.name}, ${p.formatted_address}` : (p.formatted_address || p.name || '')
          onChange(a); onSelect(a, p.geometry.location.lat(), p.geometry.location.lng())
        }
      })
    }
    if ((window as any).google?.maps?.places) init()
    else { const t = setInterval(() => { if ((window as any).google?.maps?.places) { init(); clearInterval(t) } }, 300); return () => clearInterval(t) }
  }, [])

  const handleGPS = () => {
    if (!navigator.geolocation) return; setGps(true)
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords
      const g = (window as any).google
      if (g?.maps) {
        new g.maps.Geocoder().geocode({ location: { lat, lng } }, (r: any[], s: string) => {
          setGps(false)
          if (s === 'OK' && r[0]) { onChange(r[0].formatted_address); onSelect(r[0].formatted_address, lat, lng) }
        })
      } else { setGps(false) }
    }, () => setGps(false), { enableHighAccuracy: true, timeout: 10000 })
  }

  return (
    <div className="space-y-2">
      <button onClick={handleGPS} disabled={gps} type="button"
        className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600/15 border border-blue-500/30 text-blue-300 rounded-xl text-sm font-medium disabled:opacity-50">
        {gps ? '⏳ Localisation…' : '📍 Ma position actuelle'}
      </button>
      <input ref={ref} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder || 'Adresse ou établissement…'}
        className="w-full bg-[#111] border border-[#2a2a2a] focus:border-brand rounded-xl px-3 py-3 text-white text-sm outline-none placeholder:text-zinc-600" />
      {value && <p className="text-green-400 text-xs truncate">✓ {value}</p>}
    </div>
  )
}

// ── NavModal ──────────────────────────────────────────────────────────────────
function NavModal({ onSelect }: { onSelect: (a: NavApp) => void }) {
  const apps: [NavApp, string, string][] = [
    ['gmaps', '🗺️', 'Google Maps'],
    ['waze',  '🧭', 'Waze'],
    ['apple', '📍', 'Plans Apple'],
  ]
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end">
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 space-y-2">
        <p className="text-white font-semibold text-base mb-1">App de navigation</p>
        <p className="text-zinc-500 text-sm mb-4">Ce choix sera mémorisé</p>
        {apps.map(([id, icon, label]) => (
          <button key={id} onClick={() => onSelect(id)}
            className="w-full flex items-center gap-4 px-4 py-3.5 bg-[#111] border border-[#2a2a2a] hover:border-brand rounded-2xl">
            <span className="text-2xl">{icon}</span>
            <span className="text-white font-medium">{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── VehicleEditSheet ──────────────────────────────────────────────────────────
function VehicleEditSheet({ plate, brand, model, vin, onSave, onClose }: {
  plate: string; brand?: string; model?: string; vin?: string
  onSave: (p: string, b: string, m: string, v: string) => void; onClose: () => void
}) {
  const [p, setP] = useState(normPlate(plate))
  const [b, setB] = useState(brand || '')
  const [m, setM] = useState(model || '')
  const [v, setV] = useState(vin || '')
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={onClose}>
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-lg">Modifier le véhicule</h2>
          <button onClick={onClose} className="text-zinc-500 text-2xl">×</button>
        </div>
        {[
          ['Plaque', p, (v: string) => setP(normPlate(v)), 'monospace', true],
          ['Marque', b, setB, '', false],
          ['Modèle', m, setM, '', false],
          ['VIN (optionnel)', v, setV, 'monospace', false],
        ].map(([label, val, setter, font, upper]) => (
          <div key={label as string}>
            <p className="text-zinc-500 text-xs mb-1.5">{label as string}</p>
            <input value={val as string}
              onChange={e => (setter as (v: string) => void)(e.target.value)}
              style={font ? { fontFamily: 'monospace' } : {}}
              className={`w-full bg-[#111] border border-[#2a2a2a] focus:border-brand rounded-xl px-3 py-3 text-white text-sm outline-none ${upper ? 'uppercase' : ''}`} />
          </div>
        ))}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">Annuler</button>
          <button onClick={() => onSave(p, b, m, v)} className="flex-1 py-3 bg-brand text-white font-semibold rounded-2xl text-sm">Enregistrer</button>
        </div>
      </div>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function DriverClient({ mission: init, currentUserId, isReadOnly = false, navApp: initNav }: Props) {
  const router = useRouter()

  // State principal
  const [mission,        setMission]        = useState<Mission>(init)
  const [screen,         setScreen]         = useState<Screen>('grid')
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [navApp,         setNavApp]         = useState<NavApp>(initNav || 'gmaps')
  const [showNavModal,   setShowNavModal]   = useState(false)
  const [showVehicleEdit,setShowVehicleEdit]= useState(false)

  // Données collectées (persistées en localStorage)
  const DRAFT_KEY = `vd_v2_${mission.id}`
  const loadDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') } catch { return {} } }
  const draft = loadDraft()

  const [photos,      setPhotos]      = useState<File[]>([])
  const [photoUrls,   setPhotoUrls]   = useState<string[]>(draft.photoUrls || [])
  const [previews,    setPreviews]    = useState<string[]>(draft.photoUrls || [])
  const [mileage,     setMileage]     = useState(draft.mileage || '')
  const [note,        setNote]        = useState(draft.note || '')
  const [sigData,     setSigData]     = useState(draft.sig || '')
  const [decharge,    setDecharge]    = useState<{motif:string;name:string;sig:string}|null>(draft.decharge || null)
  const [paid,        setPaid]        = useState(false)

  // Clôture REM
  const [closeType,   setCloseType]   = useState<CloseType>('rem')
  const [destAddr,    setDestAddr]    = useState(mission.destination_address || '')
  const [destLat,     setDestLat]     = useState<number|null>(mission.destination_lat ?? null)
  const [destLng,     setDestLng]     = useState<number|null>(mission.destination_lng ?? null)
  const [vrAddr,      setVrAddr]      = useState('')
  const [vrLat,       setVrLat]       = useState<number|null>(null)
  const [vrLng,       setVrLng]       = useState<number|null>(null)
  const [clientAddr,  setClientAddr]  = useState('')
  const [clientLat,   setClientLat]   = useState<number|null>(null)
  const [clientLng,   setClientLng]   = useState<number|null>(null)
  const [vrLocations, setVrLocations] = useState<VrLocation[]>([])

  // Décharge locale
  const [dMotif,  setDMotif]  = useState('')
  const [dName,   setDName]   = useState('')
  const [dSig,    setDSig]    = useState('')
  const [showDSig,setShowDSig]= useState(false)

  const photoInput = useRef<HTMLInputElement>(null)
  const mapsReady  = useRef(false)

  const missionType = mission.mission_type || ''
  const isRem = isREM(missionType)
  const isDsp = isDSP(missionType)
  const typeLabel = TYPE_LABEL[missionType] || 'AUT'
  const typeColor = TYPE_COLOR[missionType] || 'bg-zinc-600'
  const totalPhotos = photos.length + photoUrls.length

  // Sauvegarder le brouillon
  const saveDraft = (updates: Record<string, unknown>) => {
    const current = loadDraft()
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...current, ...updates })) } catch {}
  }
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY) } catch {} }

  // Charger Google Maps
  useEffect(() => {
    if ((window as any).google?.maps?.places) { mapsReady.current = true; return }
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; if (!key) return
    if (document.getElementById('gm-v2')) return
    const s = document.createElement('script'); s.id = 'gm-v2'
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&language=fr`
    s.onload = () => { mapsReady.current = true }
    document.head.appendChild(s)
  }, [])

  // Charger VR locations pour REM
  useEffect(() => {
    if (isRem) fetch('/api/vr-locations').then(r => r.json()).then(d => setVrLocations(Array.isArray(d) ? d : [])).catch(() => {})
  }, [isRem])

  // API call
  const doAction = async (action: string, extra?: Record<string, unknown>) => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: mission.id, action, ...extra }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erreur serveur')
      setMission(json.mission)
      window.location.href = window.location.pathname + '?t=' + Date.now()
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur') }
    finally { setLoading(false) }
  }

  // Upload photos
  const uploadPhotos = async (files: File[]): Promise<string[]> => {
    const urls: string[] = []
    for (const file of files) {
      const ext  = file.name.split('.').pop() || 'jpg'
      const path = `${mission.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('mission-photos').upload(path, file)
      if (!error) { const { data } = supabase.storage.from('mission-photos').getPublicUrl(path); urls.push(data.publicUrl) }
    }
    return urls
  }

  // Clôturer la mission
  const handleClose = async (type: CloseType, park = false) => {
    setLoading(true); setError(null)
    try {
      // Upload nouvelles photos
      const newUrls = await uploadPhotos(photos)
      const allUrls = [...photoUrls, ...newUrls]

      // Construire les stops
      const stops: Stop[] = []
      if (clientAddr) stops.push({ id: crypto.randomUUID(), type: 'client', label: 'Reconduire le client', address: clientAddr, lat: clientLat, lng: clientLng, arrived_at: null, sort_order: 0 })
      if (vrAddr)     stops.push({ id: crypto.randomUUID(), type: 'vr',     label: 'Livraison VR',         address: vrAddr,     lat: vrLat,     lng: vrLng,     arrived_at: null, sort_order: stops.length })
      const da = destAddr || mission.destination_address
      if (da) stops.push({ id: crypto.randomUUID(), type: 'dest', label: 'Destination véhicule', address: da, lat: destLat ?? null, lng: destLng ?? null, arrived_at: null, sort_order: stops.length })

      const action = (type === 'rem' && stops.length > 0) ? 'start_delivery'
                   : park                                   ? 'park'
                   : 'completed'

      const closing = {
        final_mission_type: type.toUpperCase(),
        mileage:            mileage ? parseInt(mileage) : undefined,
        photo_urls:         allUrls,
        closing_notes:      note || undefined,
        closing_mode:       park ? 'parked' : type,
        destination_address: da || undefined,
        stops:              stops.length > 0 ? stops : undefined,
        discharge_motif:    decharge?.motif,
        discharge_name:     decharge?.name,
        discharge_sig:      decharge?.sig,
        signature:          sigData || undefined,
      }

      const res = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_id: mission.id, action, closing_data: closing,
          park_data: park ? { stage_name: 'En parc' } : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erreur serveur')
      clearDraft()
      setMission(json.mission)
      setScreen('done')
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur') }
    finally { setLoading(false) }
  }

  const handleArriveStop = async (stopId: string) => {
    setLoading(true)
    try {
      const res  = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: mission.id, action: 'arrive_stop', stop_id: stopId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMission(json.mission)
      window.location.href = window.location.pathname + '?t=' + Date.now()
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur') }
    finally { setLoading(false) }
  }

  const handleVehicleSave = async (plate: string, brand: string, model: string, vin: string) => {
    setMission(m => ({ ...m, vehicle_plate: plate, vehicle_brand: brand, vehicle_model: model, vehicle_vin: vin }))
    setShowVehicleEdit(false)
    try {
      await fetch('/api/missions/update-vehicle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: mission.id, vehicle_plate: plate, vehicle_brand: brand, vehicle_model: model, vehicle_vin: vin }),
      })
    } catch {}
  }

  const handleNavChoice = async (app: NavApp) => {
    setNavApp(app); setShowNavModal(false)
    await fetch('/api/users/nav-preference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nav_app: app }) })
    const url = navUrl(app, mission.incident_lat, mission.incident_lng, mission.incident_address)
    if (url) window.open(url, '_blank')
    await doAction('on_way')
  }

  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    const newFiles = Array.from(files)
    setPhotos(p => [...p, ...newFiles])
    newFiles.forEach(f => { const r = new FileReader(); r.onload = e => setPreviews(p => [...p, e.target?.result as string]); r.readAsDataURL(f) })
    // Upload immédiat pour persistance
    const newUrls: string[] = []
    for (const file of newFiles) {
      const ext  = file.name.split('.').pop() || 'jpg'
      const path = `${mission.id}/draft-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('mission-photos').upload(path, file)
      if (!error) { const { data } = supabase.storage.from('mission-photos').getPublicUrl(path); newUrls.push(data.publicUrl) }
    }
    setPhotoUrls(prev => {
      const updated = [...prev, ...newUrls]
      saveDraft({ photoUrls: updated })
      return updated
    })
  }

  // ── Layout wrapper ────────────────────────────────────────────────────────
  const ScreenWrap = ({ title, sub, onBack, children }: {
    title: string; sub?: string; onBack?: () => void; children: React.ReactNode
  }) => (
    <div className="fixed inset-0 bg-[#0F0F0F] z-40 flex flex-col">
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          {onBack && <BackBtn onClick={onBack} />}
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-base truncate">{title}</p>
            {sub && <p className="text-zinc-500 text-xs truncate">{sub}</p>}
          </div>
        </div>
      </div>
      {children}
    </div>
  )

  // ── Écran: PHOTOS ─────────────────────────────────────────────────────────
  if (screen === 'photos') return (
    <ScreenWrap title="Photos du véhicule" sub="Châssis · Plaque · Vue générale" onBack={() => setScreen('grid')}>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">Photos</p>
          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${totalPhotos >= 3 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
            {totalPhotos >= 3 ? `${totalPhotos} ✓` : `${totalPhotos} / min. 3`}
          </span>
        </div>
        {previews.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {photoUrls.map((url, i) => (
              <div key={`u${i}`} className="relative aspect-square rounded-xl overflow-hidden">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <div className="absolute bottom-0 left-0 right-0 bg-green-600/70 text-white text-xs text-center py-0.5">✓</div>
              </div>
            ))}
            {previews.slice(photoUrls.length).map((src, i) => (
              <div key={`f${i}`} className="relative aspect-square rounded-xl overflow-hidden">
                <img src={src} alt="" className="w-full h-full object-cover" />
                <button onClick={() => { setPhotos(p => p.filter((_, j) => j !== i)); setPreviews(p => p.filter((_, j) => j !== i + photoUrls.length)) }}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-white text-xs flex items-center justify-center">✕</button>
              </div>
            ))}
          </div>
        )}
        <input ref={photoInput} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => addPhotos(e.target.files)} />
        <button onClick={() => photoInput.current?.click()}
          className="w-full py-3.5 border-2 border-dashed border-[#2a2a2a] hover:border-brand rounded-2xl text-zinc-400 text-sm flex items-center justify-center gap-2">
          📷 Prendre des photos
        </button>
      </div>
      <div className="px-4 py-4 border-t border-[#2a2a2a] flex-shrink-0">
        <button onClick={() => setScreen('grid')} className="w-full py-3.5 bg-brand text-white font-semibold rounded-2xl">
          Enregistrer →
        </button>
      </div>
    </ScreenWrap>
  )

  // ── Écran: KM / NOTE ──────────────────────────────────────────────────────
  if (screen === 'km_note') return (
    <ScreenWrap title="Km & Remarques" onBack={() => setScreen('grid')}>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <div>
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-2">Kilométrage</p>
          <div className="bg-[#111] border-2 border-[#2a2a2a] focus-within:border-brand rounded-2xl p-4 text-center transition">
            <input type="number" inputMode="numeric" value={mileage}
              onChange={e => { setMileage(e.target.value); saveDraft({ mileage: e.target.value }) }}
              placeholder="— — — — —"
              className="bg-transparent border-none text-white text-4xl font-mono text-center w-full outline-none placeholder:text-zinc-700" />
            <p className="text-zinc-600 text-xs mt-1">km</p>
          </div>
        </div>
        <div>
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-2">
            Remarques <span className="text-zinc-700 normal-case tracking-normal">(optionnel)</span>
          </p>
          <textarea rows={3} value={note}
            onChange={e => { setNote(e.target.value); saveDraft({ note: e.target.value }) }}
            placeholder="Observations, difficultés, état du véhicule…"
            className="w-full bg-[#111] border border-[#2a2a2a] focus:border-brand rounded-xl px-3 py-3 text-white text-sm outline-none resize-none" />
        </div>
      </div>
      <div className="px-4 py-4 border-t border-[#2a2a2a] flex-shrink-0">
        <button onClick={() => setScreen('grid')} className="w-full py-3.5 bg-brand text-white font-semibold rounded-2xl">
          Enregistrer →
        </button>
      </div>
    </ScreenWrap>
  )

  // ── Écran: SIGNATURE ──────────────────────────────────────────────────────
  if (screen === 'signature') return (
    <ScreenWrap title="Signature client" onBack={() => setScreen('grid')}>
      <div className="flex-1 px-4 py-4">
        {sigData ? (
          <div>
            <div className="border border-green-500/30 rounded-xl overflow-hidden bg-[#111] mb-3">
              <img src={sigData} alt="Signature" className="w-full max-h-36 object-contain" />
            </div>
            <p className="text-green-400 text-sm text-center mb-4">✅ Signature enregistrée</p>
            <button onClick={() => setSigData('')} className="w-full py-3 bg-[#2a2a2a] text-zinc-400 rounded-xl text-sm">Refaire</button>
          </div>
        ) : (
          <SignatureCanvas onSave={d => { setSigData(d); saveDraft({ sig: d }) }} />
        )}
      </div>
      {sigData && (
        <div className="px-4 py-4 border-t border-[#2a2a2a] flex-shrink-0">
          <button onClick={() => setScreen('grid')} className="w-full py-3.5 bg-brand text-white font-semibold rounded-2xl">
            Retour aux actions →
          </button>
        </div>
      )}
    </ScreenWrap>
  )

  // ── Écran: DÉCHARGE ───────────────────────────────────────────────────────
  if (screen === 'decharge') return (
    <ScreenWrap title="Décharge client" onBack={() => setScreen('grid')}>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-2">Motif *</p>
          <textarea rows={3} value={dMotif} onChange={e => setDMotif(e.target.value)}
            placeholder="Client refuse le remorquage, véhicule laissé sur place…"
            className="w-full bg-[#111] border border-[#2a2a2a] focus:border-brand rounded-xl px-3 py-3 text-white text-sm outline-none resize-none" />
        </div>
        <div>
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-2">Nom du signataire</p>
          <input value={dName} onChange={e => setDName(e.target.value)} placeholder="Prénom Nom"
            className="w-full bg-[#111] border border-[#2a2a2a] focus:border-brand rounded-xl px-3 py-3 text-white text-sm outline-none" />
        </div>
        <div>
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-2">Signature</p>
          {!dSig ? (
            showDSig
              ? <SignatureCanvas onSave={d => { setDSig(d); setShowDSig(false) }} />
              : <button onClick={() => setShowDSig(true)} className="w-full py-3 border border-dashed border-[#2a2a2a] rounded-xl text-zinc-400 text-sm">
                  ✍️ Faire signer le client
                </button>
          ) : (
            <div>
              <div className="border border-green-500/30 rounded-xl overflow-hidden bg-[#111] mb-2">
                <img src={dSig} alt="" className="w-full max-h-20 object-contain" />
              </div>
              <div className="flex justify-between">
                <span className="text-green-400 text-xs">✅ Signé</span>
                <button onClick={() => setDSig('')} className="text-zinc-500 text-xs">Refaire</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="px-4 py-4 border-t border-[#2a2a2a] flex-shrink-0 flex gap-3">
        <button onClick={() => setScreen('grid')} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">Annuler</button>
        <button onClick={() => {
          if (!dMotif) return
          const d = { motif: dMotif, name: dName, sig: dSig }
          setDecharge(d); saveDraft({ decharge: d }); setScreen('grid')
        }} disabled={!dMotif}
          className="flex-1 py-3 bg-amber-600 disabled:opacity-40 text-white font-semibold rounded-2xl text-sm">
          Enregistrer
        </button>
      </div>
    </ScreenWrap>
  )

  // ── Écran: ENCAISSEMENT ───────────────────────────────────────────────────
  if (screen === 'encaissement') {
    const amount = mission.amount_to_collect || 0
    const encUrl = `/encaissement?prefill_mission_id=${mission.id}&prefill_plate=${normPlate(mission.vehicle_plate || '')}&prefill_brand=${mission.vehicle_brand || ''}&prefill_model=${mission.vehicle_model || ''}&prefill_amount=${amount}&return_to=/mission/${mission.id}`
    return (
      <ScreenWrap title="Encaisser le paiement" onBack={() => setScreen('grid')}>
        <div className="flex-1 px-4 py-4 space-y-4">
          <div className="bg-brand rounded-2xl p-6 text-center">
            <p className="text-white/70 text-sm mb-1">Montant à encaisser</p>
            <p className="text-white text-4xl font-semibold">{amount.toFixed(2)} €</p>
          </div>
          {paid ? (
            <div className="bg-green-600/20 border border-green-500/30 rounded-2xl p-4 text-center">
              <p className="text-green-400 font-semibold text-base">✅ Paiement encaissé</p>
            </div>
          ) : (
            <a href={encUrl} onClick={() => setTimeout(() => setPaid(true), 3000)}
              className="w-full flex items-center justify-center py-4 bg-brand text-white font-semibold rounded-2xl text-base">
              💳 Ouvrir l'encaissement
            </a>
          )}
        </div>
        <div className="px-4 py-4 border-t border-[#2a2a2a] flex-shrink-0">
          <button onClick={() => setScreen('grid')} className="w-full py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">← Retour</button>
        </div>
      </ScreenWrap>
    )
  }

  // ── Écran: CLÔTURER ───────────────────────────────────────────────────────
  if (screen === 'cloturer') return (
    <ScreenWrap title="Clôturer la mission"
      sub={`${mission.client_name || ''} · ${mission.vehicle_brand || ''} · ${normPlate(mission.vehicle_plate || '')}`}
      onBack={() => setScreen('grid')}>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">Résultat de l'intervention</p>

        {/* Options de clôture */}
        {[
          isRem && { type: 'rem' as CloseType, color: 'bg-blue-600', icon: 'REM', label: 'REM Confirmé', sub: 'Remorquage' },
          isDsp && { type: 'dsp' as CloseType, color: 'bg-orange-500', icon: 'DSP', label: 'DSP Réussi', sub: 'Dépannage effectué sur place' },
          isRem && { type: 'rem' as CloseType, color: 'bg-teal-700', icon: '🚗', label: 'REM + VR', sub: 'Ajouter véhicule de remplacement' },
          isRem && { type: 'rem' as CloseType, color: 'bg-purple-700', icon: '👤', label: 'REM + Reconduire client', sub: 'Déposer le client à une adresse' },
          { type: 'dsp' as CloseType, color: 'bg-orange-500', icon: '→', label: isRem ? 'REM → DSP' : 'DSP Réussi', sub: isRem ? 'Finalement réparé sur place' : 'Dépannage effectué' },
          { type: 'dpr' as CloseType, color: 'bg-zinc-600',   icon: 'DPR', label: 'DPR', sub: 'Déplacement pour rien' },
        ].filter(Boolean).filter((v, i, a) => a.findIndex(x => (x as any).label === (v as any).label) === i).map((opt: any, i) => (
          <button key={i} onClick={() => {
            setCloseType(opt.type)
            if (opt.type === 'dpr') setScreen('dpr_close')
            else setScreen('cloturer')
            // Pour REM+VR / REM+Reconduire : on reste sur cloturer mais on marque les extras
          }}
            className={`w-full flex items-center gap-3 px-4 py-3.5 ${closeType === opt.type && opt.label !== 'DPR' ? opt.color + ' opacity-100' : '#1A1A1A border border-[#2a2a2a]'} rounded-2xl transition`}
            style={{ background: closeType === opt.type && screen !== 'dpr_close' ? '' : '#1A1A1A', border: '1px solid #2a2a2a' }}>
            <div className={`${opt.color} rounded-lg w-9 h-9 flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>{opt.icon}</div>
            <div className="text-left">
              <p className="text-white font-medium text-sm">{opt.label}</p>
              <p className="text-zinc-500 text-xs">{opt.sub}</p>
            </div>
            {closeType === opt.type && <span className="text-green-400 ml-auto">✓</span>}
          </button>
        ))}

        {/* Destination */}
        {isRem && (
          <div>
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-2 mt-2">Destination véhicule</p>
            <AddressInput value={destAddr} onChange={setDestAddr}
              onSelect={(a, lat, lng) => { setDestAddr(a); setDestLat(lat); setDestLng(lng) }}
              placeholder="Garage, domicile, fourrière…" />
            <button onClick={() => { setDestAddr(''); setCloseType('rem') }}
              className="w-full mt-2 py-2.5 bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-xl text-sm">
              🅿️ Client ne sait pas encore — mise en dépôt
            </button>
          </div>
        )}

        {/* Récap */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3">
          <p className="text-zinc-600 text-xs mb-2">Récap avant clôture</p>
          <div className="flex gap-4 flex-wrap">
            <span className={`text-sm ${totalPhotos >= 3 ? 'text-green-400' : 'text-zinc-600'}`}>📷 {totalPhotos} {totalPhotos >= 3 ? '✓' : '/ min. 3'}</span>
            <span className={`text-sm ${mileage ? 'text-green-400' : 'text-zinc-600'}`}>⚙️ {mileage ? `${parseInt(mileage).toLocaleString('fr-BE')} km ✓` : 'Km manquant'}</span>
            <span className={`text-sm ${sigData ? 'text-green-400' : 'text-zinc-600'}`}>✍️ {sigData ? 'Signé ✓' : '—'}</span>
            <span className={`text-sm ${decharge ? 'text-amber-400' : 'text-zinc-600'}`}>📋 {decharge ? 'Décharge ✓' : '—'}</span>
          </div>
          {totalPhotos < 3 && <p className="text-amber-400 text-xs mt-2">⚠️ {3 - totalPhotos} photo(s) manquante(s)</p>}
          {!mileage && <p className="text-amber-400 text-xs mt-1">⚠️ Kilométrage non encodé</p>}
        </div>

        {error && <p className="text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2">⚠️ {error}</p>}
      </div>

      <div className="px-4 py-4 border-t border-[#2a2a2a] flex-shrink-0 space-y-2">
        {/* Mettre en parc — seulement pour REM */}
        {isRem && (
          <button onClick={() => handleClose(closeType, true)} disabled={loading}
            className="w-full py-3 bg-amber-600/20 border border-amber-600/40 text-amber-300 font-medium rounded-2xl text-sm disabled:opacity-40">
            {loading ? '⏳…' : '🅿️ Mettre en parc'}
          </button>
        )}
        <button onClick={() => handleClose(closeType)} disabled={loading || totalPhotos < 3 || !mileage}
          className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-semibold rounded-2xl disabled:cursor-not-allowed">
          {loading ? '⏳ Envoi…' : '✅ Confirmer la clôture'}
        </button>
      </div>
    </ScreenWrap>
  )

  // ── Écran: DPR ────────────────────────────────────────────────────────────
  if (screen === 'dpr_close') return (
    <ScreenWrap title="Déplacement pour rien" onBack={() => setScreen('cloturer')}>
      <div className="flex-1 px-4 py-4 space-y-4">
        <div className="bg-zinc-600/20 border border-zinc-600/40 rounded-2xl p-4 flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">🚫</span>
          <div>
            <p className="text-white font-medium text-sm">Déplacement pour rien</p>
            <p className="text-zinc-400 text-xs mt-1">Aucune photo ni km requis.</p>
          </div>
        </div>
        <div>
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-2">
            Remarques <span className="text-zinc-700 normal-case tracking-normal">(optionnel)</span>
          </p>
          <textarea rows={4} value={note} onChange={e => setNote(e.target.value)}
            placeholder="Véhicule introuvable, accès impossible, client absent…"
            className="w-full bg-[#111] border border-[#2a2a2a] focus:border-brand rounded-xl px-3 py-3 text-white text-sm outline-none resize-none" />
        </div>
        {error && <p className="text-red-400 text-sm">⚠️ {error}</p>}
      </div>
      <div className="px-4 py-4 border-t border-[#2a2a2a] flex-shrink-0 flex gap-3">
        <button onClick={() => setScreen('cloturer')} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">Annuler</button>
        <button onClick={() => handleClose('dpr')} disabled={loading}
          className="flex-2 px-6 py-3 bg-zinc-600 disabled:opacity-40 text-white font-semibold rounded-2xl text-sm">
          {loading ? '⏳…' : '🚫 Clôturer DPR'}
        </button>
      </div>
    </ScreenWrap>
  )

  // ── Écran: STOPS (delivering) ─────────────────────────────────────────────
  if (screen === 'stops' || mission.status === 'delivering') {
    const stops = [...(mission.extra_addresses || [])].sort((a, b) => a.sort_order - b.sort_order)
    const allArrived = stops.length > 0 && stops.every(s => s.arrived_at)
    const COLORS: Record<string, string> = { client: '#7c3aed', vr: '#0f766e', dest: '#2563eb', depot: '#d97706' }
    const ICONS:  Record<string, string> = { client: '👤', vr: '🚗', dest: '🏁', depot: '🅿️' }
    return (
      <div className="min-h-screen bg-[#0F0F0F] pb-32">
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 sticky top-0 z-20">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-1 bg-teal-600 rounded-lg text-xs font-bold text-white">EN LIVRAISON</span>
            <span className="text-white font-semibold truncate">{mission.client_name}</span>
          </div>
          <p className="text-zinc-500 text-xs">{stops.filter(s => s.arrived_at).length}/{stops.length} stops effectués</p>
          <div className="h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden mt-2">
            <div className="h-full bg-teal-500 rounded-full transition-all"
              style={{ width: `${stops.length ? stops.filter(s => s.arrived_at).length / stops.length * 100 : 0}%` }} />
          </div>
        </div>
        <div className="px-4 mt-4 space-y-3">
          {stops.map((stop, i) => {
            const isDone = !!stop.arrived_at
            const isNext = !isDone && stops.slice(0, i).every(s => s.arrived_at)
            const url    = navUrl(navApp, stop.lat ?? undefined, stop.lng ?? undefined, stop.address)
            return (
              <div key={stop.id} className={`bg-[#1A1A1A] border-2 rounded-2xl p-4 transition ${isDone ? 'border-green-500/30 opacity-60' : isNext ? 'border-teal-500' : 'border-[#2a2a2a]'}`}>
                <div className="flex items-start gap-3">
                  {isDone && <span className="text-green-400 text-xl flex-shrink-0">✓</span>}
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: COLORS[stop.type] || '#2563eb' }}>
                    {ICONS[stop.type] || '📍'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white font-semibold text-sm">{stop.label}</p>
                      {isNext && <span className="px-1.5 py-0.5 bg-teal-500/20 border border-teal-500/40 text-teal-300 text-xs rounded">Prochain</span>}
                    </div>
                    <p className="text-zinc-500 text-xs truncate">{stop.address}</p>
                    {isDone && stop.arrived_at && <p className="text-green-400 text-xs mt-1">Arrivé à {fmt(stop.arrived_at)}</p>}
                    {isNext && url && (
                      <a href={url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-blue-600/15 border border-blue-500/30 rounded-lg text-blue-300 text-xs font-medium">
                        🗺️ Naviguer
                      </a>
                    )}
                  </div>
                </div>
                {isNext && (
                  <button onClick={() => handleArriveStop(stop.id)} disabled={loading}
                    className="w-full mt-3 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-semibold rounded-xl text-sm">
                    {loading ? '⏳' : '✅ Arrivé'}
                  </button>
                )}
              </div>
            )
          })}
          {allArrived && (
            <div className="mt-2 space-y-3">
              <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 text-center">
                <p className="text-green-400 font-semibold text-base mb-1">Tous les stops effectués !</p>
              </div>
              <button onClick={() => doAction('complete_delivery')} disabled={loading}
                className="w-full py-4 bg-green-600 disabled:opacity-40 text-white font-semibold rounded-2xl">
                {loading ? '⏳…' : '🏁 Terminer la mission'}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Écran: DONE ───────────────────────────────────────────────────────────
  if (screen === 'done' || mission.status === 'completed') return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6 text-center gap-4">
      <div className="text-6xl">🏁</div>
      <h1 className="text-white font-semibold text-xl">Mission terminée</h1>
      <p className="text-zinc-500 text-sm">{mission.client_name} · {mission.vehicle_plate && normPlate(mission.vehicle_plate)}</p>
      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 w-full text-left space-y-0">
        {[
          ['Type', typeLabel],
          ['Km',   mileage ? `${parseInt(mileage).toLocaleString('fr-BE')} km` : '—'],
          ['Photos', totalPhotos > 0 ? `${totalPhotos} ✓` : '—'],
          ['Paiement', paid ? `${mission.amount_to_collect} € ✓` : '—'],
        ].map(([l, v]) => (
          <div key={l} className="flex justify-between py-2 border-b border-[#1f1f1f] last:border-none">
            <span className="text-zinc-500 text-sm">{l}</span>
            <span className="text-white text-sm font-medium">{v}</span>
          </div>
        ))}
      </div>
      <button onClick={() => router.push('/mission')} className="w-full py-3 bg-[#1A1A1A] border border-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">
        ← Retour à mes missions
      </button>
    </div>
  )

  // ── Écran: GRILLE PRINCIPALE ──────────────────────────────────────────────

  // Infos sur l'avancement
  const onSite = !!mission.on_site_at
  const inProgress = mission.status === 'in_progress'

  // Tiles selon le statut
  const tiles = []

  if (mission.status === 'assigned') {
    tiles.push({ label: 'Accepter', icon: '✅', color: 'blue', action: () => doAction('accept') })
  } else if (mission.status === 'accepted') {
    tiles.push({ label: 'En route', icon: '🚗', color: 'green', action: () => initNav ? doAction('on_way') : setShowNavModal(true) })
  } else if (inProgress && !onSite) {
    tiles.push({ label: 'Sur place', icon: '📍', color: 'green', action: () => doAction('on_site') })
    tiles.push({ label: 'Photos', icon: '📷', color: '', badge: totalPhotos > 0 ? `${totalPhotos}` : '', action: () => setScreen('photos') })
    tiles.push({ label: 'Km / Note', icon: '⚙️', color: '', badge: mileage ? '✓' : '', action: () => setScreen('km_note') })
  } else if (onSite || mission.status === 'parked') {
    tiles.push({ label: 'Photos', icon: '📷', color: totalPhotos >= 3 ? 'green' : '', badge: `${totalPhotos}`, action: () => setScreen('photos') })
    tiles.push({ label: 'Km / Note', icon: '⚙️', color: mileage ? 'green' : '', badge: mileage ? '✓' : '', action: () => setScreen('km_note') })
    tiles.push({ label: 'Signature', icon: '✍️', color: sigData ? 'green' : '', badge: sigData ? '✓' : '', action: () => setScreen('signature') })
    tiles.push({ label: 'Décharge', icon: '📋', color: decharge ? 'amber' : '', badge: decharge ? '✓' : '', action: () => setScreen('decharge') })
    if (mission.amount_to_collect && mission.amount_to_collect > 0) {
      tiles.push({ label: 'Encaisser', icon: '💳', color: paid ? 'green' : '', badge: paid ? '✓' : `${mission.amount_to_collect}€`, action: () => setScreen('encaissement') })
    }
    tiles.push({ label: 'Clôturer', icon: '🏁', color: 'primary', action: () => setScreen('cloturer') })
    // Mise en parc seulement pour REM
    if (isRem) {
      tiles.push({ label: 'Mettre en parc', icon: '🅿️', color: 'amber', action: () => {
        if (confirm('Mettre ce véhicule en dépôt ?')) doAction('park', { park_data: { stage_name: 'En parc' } })
      }})
    }
  }

  const TILE_COLORS: Record<string, string> = {
    primary: 'bg-[#CC0000] border-[#CC0000]',
    green:   'bg-green-600 border-green-600',
    amber:   'bg-amber-600 border-amber-600',
    blue:    'bg-blue-600 border-blue-600',
    '':      'bg-[#1A1A1A] border-[#2a2a2a]',
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] pb-8">

      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 sticky top-0 z-20">
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => router.push('/mission')} className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white">←</button>
          <div className="flex items-center gap-2">
            <Pill label={typeLabel} color={typeColor} />
            <Pill label={mission.status === 'in_progress' ? (onSite ? 'Sur place' : mission.on_way_at ? 'En route' : 'En cours') : mission.status === 'parked' ? 'En dépôt' : mission.status === 'assigned' ? 'À accepter' : mission.status === 'accepted' ? 'Acceptée' : mission.status}
              color={onSite ? 'bg-orange-500' : mission.status === 'parked' ? 'bg-amber-600' : 'bg-zinc-600'} />
          </div>
        </div>
        <h1 className="text-white font-semibold text-lg truncate">{mission.client_name || 'Client inconnu'}</h1>
        {mission.client_phone && (
          <a href={`tel:${mission.client_phone}`}
            className="inline-flex items-center gap-1.5 mt-1 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1 text-red-400 text-sm font-medium">
            📞 {mission.client_phone}
          </a>
        )}
      </div>

      {/* Onglets */}
      <div className="flex bg-[#111] border-b border-[#2a2a2a] sticky top-[88px] z-10">
        {['Info', 'Client', 'Véhicule', 'Facture'].map((tab, i) => (
          <button key={tab}
            className={`flex-1 py-2.5 text-xs font-medium border-b-2 transition ${i === 0 ? 'text-[#CC0000] border-[#CC0000]' : 'text-zinc-500 border-transparent'}`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Contenu onglet Info */}
      <div className="px-4 py-4 space-y-3">

        {/* Description */}
        {mission.incident_description && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-2">Description</p>
            <p className="text-white text-sm">{mission.incident_description}</p>
          </div>
        )}

        {/* Lieu */}
        {mission.incident_address && (
          <button onClick={() => {
            const url = navUrl(navApp, mission.incident_lat, mission.incident_lng, mission.incident_address)
            if (url) window.open(url, '_blank')
          }} className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 text-left hover:border-zinc-600 transition">
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-1">Lieu d'intervention</p>
            <p className="text-white text-sm">{mission.incident_address}{mission.incident_city ? `, ${mission.incident_city}` : ''}</p>
            <p className="text-blue-400 text-xs mt-1">🗺️ Tap pour naviguer</p>
          </button>
        )}

        {/* Destination */}
        {mission.destination_address && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-1">Destination</p>
            {mission.destination_name && <p className="text-zinc-400 text-xs mb-0.5">{mission.destination_name}</p>}
            <p className="text-white text-sm">{mission.destination_address}</p>
          </div>
        )}

        {/* Véhicule */}
        <button onClick={() => setShowVehicleEdit(true)}
          className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 text-left hover:border-zinc-600 transition">
          <div className="flex justify-between mb-1">
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">Véhicule</p>
            <span className="text-red-400 text-xs">✏️ Modifier</span>
          </div>
          <p className="text-white font-semibold">{[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')}</p>
          {mission.vehicle_plate && <p className="text-zinc-400 text-xs font-mono uppercase tracking-widest mt-0.5">{normPlate(mission.vehicle_plate)}</p>}
        </button>

        {/* Dossier */}
        {mission.dossier_number && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-1">Dossier</p>
            <p className="text-white text-sm font-mono">{mission.dossier_number}</p>
            {mission.source && <p className="text-zinc-500 text-xs mt-0.5">{mission.source}</p>}
          </div>
        )}

        {/* Remarques */}
        {mission.remarks_general && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-1">Remarques</p>
            <p className="text-white text-sm whitespace-pre-wrap">{mission.remarks_general}</p>
          </div>
        )}

        {error && <p className="text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2">⚠️ {error}</p>}
      </div>

      {/* Grille d'actions */}
      {!isReadOnly && tiles.length > 0 && (
        <div className="px-4 mt-2">
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mb-3">Actions</p>
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((tile, i) => (
              <button key={i} onClick={tile.action} disabled={loading}
                className={`relative ${TILE_COLORS[tile.color]} border rounded-2xl py-5 flex flex-col items-center justify-center gap-2 transition active:scale-95 disabled:opacity-50`}>
                <span className="text-2xl">{tile.icon}</span>
                <span className={`text-sm font-medium ${tile.color ? 'text-white' : 'text-zinc-300'}`}>{tile.label}</span>
                {tile.badge && (
                  <span className={`absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-xs font-bold ${tile.badge === '✓' ? 'bg-green-500 text-white' : 'bg-white/20 text-white'}`}>
                    {tile.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {showNavModal && <NavModal onSelect={handleNavChoice} />}
      {showVehicleEdit && (
        <VehicleEditSheet
          plate={mission.vehicle_plate || ''} brand={mission.vehicle_brand} model={mission.vehicle_model} vin={mission.vehicle_vin}
          onClose={() => setShowVehicleEdit(false)} onSave={handleVehicleSave}
        />
      )}
    </div>
  )
}
