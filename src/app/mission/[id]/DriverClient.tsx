'use client'
// DriverClient v4 — spec figée — DSP/REM, stops, mise en parc, realtime

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

// ─── Types ────────────────────────────────────────────────────────────────────
type NavApp = 'gmaps' | 'waze' | 'apple'
type Screen = 'main' | 'photos' | 'decharge' | 'sig' | 'encaissement' | 'close' | 'add-stop' | 'modify-addr'

interface Stop {
  id: string; type: string; label: string; address: string
  lat: number | null; lng: number | null; arrived_at: string | null; sort_order: number
}
interface Mission {
  id: string; status: string; mission_type?: string
  client_name?: string; client_phone?: string
  billed_to_name?: string; source?: string; dossier_number?: string; external_id?: string
  vehicle_brand?: string; vehicle_model?: string; vehicle_plate?: string; vehicle_vin?: string
  incident_address?: string; incident_city?: string; incident_lat?: number; incident_lng?: number
  incident_description?: string; remarks_general?: string
  destination_address?: string; destination_name?: string; redelivery_address?: string
  accepted_at?: string; on_way_at?: string; on_site_at?: string
  completed_at?: string; parked_at?: string; delivering_at?: string
  amount_guaranteed?: number; amount_currency?: string; amount_to_collect?: number
  park_stage_name?: string; extra_addresses?: Stop[]; driver_photos?: string[]
}
interface VrLoc { id: string; name: string; address: string; lat: number | null; lng: number | null }
interface Props { mission: Mission; currentUserId?: string; isReadOnly?: boolean; navApp?: NavApp }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const plate = (v = '') => v.replace(/[-.\s]/g, '').toUpperCase()
const isREM = (t = '') => ['REM', 'remorquage', 'transport'].includes(t)
const gUrl  = (app: NavApp, lat?: number, lng?: number, addr?: string) => {
  const q = lat && lng ? `${lat},${lng}` : encodeURIComponent(addr || ''); if (!q) return null
  if (app === 'waze')  return `https://waze.com/ul?ll=${q}&navigate=yes`
  if (app === 'apple') return `https://maps.apple.com/?daddr=${q}&dirflg=d`
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`
}
const TYPE_BADGE: Record<string, [string, string]> = {
  DSP: ['DSP', 'bg-[#CC0000]'], REM: ['REM', 'bg-blue-600'], DPR: ['DPR', 'bg-zinc-600'],
  depannage: ['DSP', 'bg-[#CC0000]'], remorquage: ['REM', 'bg-blue-600'],
  reparation_place: ['DSP', 'bg-[#CC0000]'], transport: ['REM', 'bg-blue-600'],
}
const STATUS_BADGE: Record<string, [string, string]> = {
  assigned:    ['À accepter',  'bg-blue-600'],
  accepted:    ['Acceptée',    'bg-indigo-600'],
  in_progress: ['En cours',    'bg-orange-500'],
  parked:      ['En dépôt',    'bg-amber-600'],
  delivering:  ['En livraison','bg-teal-600'],
  completed:   ['Terminée',    'bg-green-600'],
}
const STOP_COLORS: Record<string, string> = {
  client: '#7c3aed', vr: '#0f766e', dest: '#2563eb', depot: '#d97706', custom: '#64748b',
}

// ─── SigPad ───────────────────────────────────────────────────────────────────
function SigPad({ onSave }: { onSave: (d: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null); const pen = useRef(false); const [drawn, setDrawn] = useState(false)
  const xy = (e: React.TouchEvent | React.MouseEvent, c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect(); const s = 'touches' in e ? e.touches[0] : e
    return { x: s.clientX - r.left, y: s.clientY - r.top }
  }
  const down = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault(); const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!; const p = xy(e, c); ctx.beginPath(); ctx.moveTo(p.x, p.y); pen.current = true
  }
  const move = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault(); if (!pen.current) return; const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!; const p = xy(e, c)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#fff'; ctx.lineTo(p.x, p.y); ctx.stroke(); setDrawn(true)
  }
  const clear = () => { ref.current?.getContext('2d')!.clearRect(0, 0, 340, 130); setDrawn(false) }
  return (
    <div>
      <div className="border border-[#2a2a2a] rounded-xl overflow-hidden bg-[#111] mb-3">
        <canvas ref={ref} width={340} height={130} className="w-full touch-none"
          onMouseDown={down} onMouseMove={move} onMouseUp={() => { pen.current = false }}
          onTouchStart={down} onTouchMove={move} onTouchEnd={() => { pen.current = false }} />
      </div>
      <div className="flex gap-2">
        <button onClick={clear} className="flex-1 py-2.5 bg-[#2a2a2a] text-zinc-400 rounded-xl text-sm">Effacer</button>
        <button onClick={() => ref.current && onSave(ref.current.toDataURL())} disabled={!drawn}
          className="flex-1 py-2.5 bg-green-600 disabled:opacity-40 text-white rounded-xl text-sm font-medium">✅ Valider</button>
      </div>
    </div>
  )
}

// ─── AddrInput ────────────────────────────────────────────────────────────────
function AddrInput({ value, onChange, onPick, placeholder }: {
  value: string; onChange: (v: string) => void
  onPick: (addr: string, lat: number, lng: number) => void; placeholder?: string
}) {
  const ref = useRef<HTMLInputElement>(null); const ac = useRef<any>(null)
  useEffect(() => {
    const init = () => {
      if (!ref.current || !(window as any).google?.maps?.places || ac.current) return
      ac.current = new (window as any).google.maps.places.Autocomplete(ref.current, { fields: ['name', 'formatted_address', 'geometry'] })
      ac.current.addListener('place_changed', () => {
        const p = ac.current.getPlace(); if (!p?.geometry) return
        const a = p.name && p.formatted_address ? `${p.name}, ${p.formatted_address}` : (p.formatted_address || p.name || '')
        onChange(a); onPick(a, p.geometry.location.lat(), p.geometry.location.lng())
      })
    }
    if ((window as any).google?.maps?.places) init()
    else { const t = setInterval(() => { if ((window as any).google?.maps?.places) { init(); clearInterval(t) } }, 300); return () => clearInterval(t) }
  }, [])
  return (
    <input ref={ref} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || 'Adresse ou établissement…'}
      className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#CC0000] rounded-xl px-3 py-3 text-white text-sm outline-none placeholder:text-zinc-600" />
  )
}

// ─── VehSheet ─────────────────────────────────────────────────────────────────
function VehSheet({ m, onSave, onClose }: { m: Mission; onSave: (p: string, b: string, mo: string, v: string) => void; onClose: () => void }) {
  const [p, setP] = useState(plate(m.vehicle_plate)); const [b, setB] = useState(m.vehicle_brand || '')
  const [mo, setMo] = useState(m.vehicle_model || ''); const [v, setV] = useState(m.vehicle_vin || '')
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={onClose}>
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between"><h2 className="text-white font-semibold text-lg">Modifier le véhicule</h2><button onClick={onClose} className="text-zinc-500 text-2xl">×</button></div>
        {([['Plaque', p, setP], ['Marque', b, setB], ['Modèle', mo, setMo], ['VIN (optionnel)', v, setV]] as [string, string, (v: string) => void][]).map(([l, val, set]) => (
          <div key={l}><p className="text-zinc-500 text-xs mb-1.5">{l}</p>
            <input value={val} onChange={e => set(e.target.value)}
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#CC0000] rounded-xl px-3 py-3 text-white text-sm outline-none" /></div>
        ))}
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">Annuler</button>
          <button onClick={() => onSave(plate(p), b, mo, v)} className="flex-1 py-3 bg-[#CC0000] text-white font-semibold rounded-2xl text-sm">Enregistrer</button>
        </div>
      </div>
    </div>
  )
}

// ─── NavModal ─────────────────────────────────────────────────────────────────
function NavModal({ onPick }: { onPick: (a: NavApp) => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end">
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 space-y-2">
        <p className="text-white font-semibold text-base mb-4">App de navigation</p>
        {([['gmaps', '🗺️', 'Google Maps'], ['waze', '🧭', 'Waze'], ['apple', '📍', 'Plans']] as [NavApp, string, string][]).map(([id, ic, lb]) => (
          <button key={id} onClick={() => onPick(id)} className="w-full flex items-center gap-4 px-4 py-3.5 bg-[#111] border border-[#2a2a2a] rounded-2xl">
            <span className="text-2xl">{ic}</span><span className="text-white font-medium">{lb}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── AddrActionModal — tap adresse ────────────────────────────────────────────
function AddrActionModal({ title, address, onNavigate, onModify, onClose }: {
  title: string; address: string; onNavigate: () => void; onModify: () => void; onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={onClose}>
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <div><p className="text-zinc-500 text-xs">{title}</p><p className="text-white font-medium text-sm mt-0.5">{address}</p></div>
          <button onClick={onClose} className="text-zinc-500 text-2xl ml-4">×</button>
        </div>
        <button onClick={onNavigate} className="w-full py-3.5 bg-blue-600 text-white font-semibold rounded-2xl text-sm">🗺️ Naviguer</button>
        <button onClick={onModify} className="w-full py-3.5 bg-[#2a2a2a] text-zinc-300 font-medium rounded-2xl text-sm">✏️ Modifier l'adresse</button>
      </div>
    </div>
  )
}

// ─── Screen wrapper ───────────────────────────────────────────────────────────
function ScreenWrap({ title, sub, back, children }: { title: string; sub?: string; back: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-[#0F0F0F] z-40 flex flex-col">
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={back} className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white">←</button>
          <div className="flex-1 min-w-0"><p className="text-white font-semibold truncate">{title}</p>
            {sub && <p className="text-zinc-500 text-xs truncate">{sub}</p>}</div>
        </div>
      </div>
      {children}
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function DriverClient({ mission: init, isReadOnly = false, navApp: initNav }: Props) {
  const router = useRouter()

  const [M, setM]               = useState<Mission>(init)
  const [screen, setScreen]     = useState<Screen>('main')
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const [navApp, setNavApp]     = useState<NavApp>(initNav || 'gmaps')
  const [showNav, setShowNav]   = useState(false)
  const [showVeh, setShowVeh]   = useState(false)
  const [showGrid, setShowGrid] = useState(false)
  const [showPark, setShowPark] = useState(false)
  const [dischFrom, setDischFrom] = useState<Screen>('main')
  const [addrModal, setAddrModal] = useState<{ title: string; address: string; lat?: number; lng?: number; field: string } | null>(null)

  // Modify address
  const [modField, setModField] = useState(''); const [modVal, setModVal] = useState('')
  const [modLat, setModLat] = useState<number|null>(null); const [modLng, setModLng] = useState<number|null>(null)

  // Draft
  const DKEY = `vd4_${M.id}`
  const getDraft = () => { try { return JSON.parse(localStorage.getItem(DKEY) || '{}') } catch { return {} } }
  const saveDraft = (u: object) => { try { localStorage.setItem(DKEY, JSON.stringify({ ...getDraft(), ...u })) } catch {} }
  const clearDraft = () => { try { localStorage.removeItem(DKEY) } catch {} }

  // Collected data
  const [photos, setPhotos]       = useState<File[]>([])
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [previews, setPreviews]   = useState<string[]>([])
  const [sig, setSig]             = useState<string>('')
  const [disch, setDisch]         = useState<{motif:string;name:string;sig:string}[]>([])
  const [paid, setPaid]           = useState(false)
  const [closeType, setCloseType] = useState<'dsp'|'rem'|'dpr'>(() => isREM(init.mission_type || '') ? 'rem' : 'dsp')
  const [closeNote, setCloseNote] = useState('')
  const [mounted,   setMounted]   = useState(false)

  // Monter côté client seulement
  useEffect(() => { setMounted(true) }, [])

  // Charger le draft côté client — DB prioritaire sur localStorage
  useEffect(() => {
    // driver_photos vient de la DB (source of truth)
    const dbPhotos: string[] = Array.isArray((M as any).driver_photos) ? (M as any).driver_photos : []
    if (dbPhotos.length) {
      setPhotoUrls(dbPhotos); setPreviews(dbPhotos)
    } else {
      const d = getDraft()
      if (d.photoUrls?.length) { setPhotoUrls(d.photoUrls); setPreviews(d.photoUrls) }
    }
    const d = getDraft()
    if (d.sig)   setSig(d.sig)
    if (d.disch) setDisch(Array.isArray(d.disch) ? d.disch : d.disch ? [d.disch] : [])
  }, [])

  // Décharge
  const [dMotif, setDMotif] = useState(''); const [dName, setDName] = useState('')
  const [dSig, setDSig]     = useState(''); const [showDSig, setShowDSig] = useState(false)

  // Add stop
  const [newStopAddr, setNewStopAddr]   = useState('')
  const [newStopLat, setNewStopLat]     = useState<number|null>(null)
  const [newStopLng, setNewStopLng]     = useState<number|null>(null)
  const [newStopLabel, setNewStopLabel] = useState('')

  // VR locations
  const [vrLocs, setVrLocs] = useState<VrLoc[]>([])

  const photoRef = useRef<HTMLInputElement>(null)
  const totPh    = photos.length + photoUrls.length
  const mType    = M.mission_type || ''
  const rem      = isREM(mType)
  const onSite   = !!M.on_site_at
  const stops    = [...(M.extra_addresses || [])].sort((a, b) => a.sort_order - b.sort_order)
  const [tbl, tbg] = TYPE_BADGE[mType] || ['AUT', 'bg-zinc-600']
  const statusStr  = M.status === 'parked' ? 'En dépôt' : M.on_site_at ? 'Sur place'
    : M.on_way_at && M.status === 'in_progress' ? 'En route' : STATUS_BADGE[M.status]?.[0] || M.status
  const statusBg   = M.status === 'parked' ? 'bg-amber-600' : M.on_site_at ? 'bg-orange-500'
    : M.on_way_at && M.status === 'in_progress' ? 'bg-amber-500' : STATUS_BADGE[M.status]?.[1] || 'bg-zinc-600'

  // Google Maps
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; if (!key || document.getElementById('gm-v4')) return
    const s = document.createElement('script'); s.id = 'gm-v4'
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&language=fr`
    document.head.appendChild(s)
  }, [])

  // VR locations
  useEffect(() => {
    fetch('/api/vr-locations').then(r => r.json()).then(d => setVrLocs(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // Auto-accepter si assigned
  useEffect(() => {
    if (M.status === 'assigned' && !isReadOnly) {
      fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: M.id, action: 'accept' }),
      }).then(r => r.json()).then(j => { if (j.mission) setM(j.mission) }).catch(() => {})
    }
  }, [])

  // Realtime subscription
  useEffect(() => {
    const ch = sb.channel(`mission-v4-${M.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'incoming_missions', filter: `id=eq.${M.id}` },
        payload => { setM(prev => ({ ...prev, ...(payload.new as Partial<Mission>) })) })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [M.id])

  // ── API statuts simples ───────────────────────────────────────────────────
  const api = async (action: string, extra = {}) => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: M.id, action, ...extra }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setM(j.mission)
      window.location.href = window.location.pathname + '?t=' + Date.now()
    } catch (e: any) { setErr(e.message || 'Erreur') }
    finally { setLoading(false) }
  }

  // ── Changer type DSP↔REM ──────────────────────────────────────────────────
  const changeType = async (newType: 'DSP' | 'REM') => {
    setShowGrid(false); setLoading(true); setErr('')
    try {
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: M.id, action: 'change_type', new_type: newType }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setCloseType(newType === 'REM' ? 'rem' : 'dsp')
      window.location.href = window.location.pathname + '?t=' + Date.now()
    } catch (e: any) { setErr(e.message || 'Erreur') }
    finally { setLoading(false) }
  }

  // ── Upload photos ─────────────────────────────────────────────────────────
  const compressPhoto = (file: File): Promise<Blob> => new Promise(resolve => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX = 1200
      let { naturalWidth: w, naturalHeight: h } = img
      if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX } else { w = Math.round(w * MAX / h); h = MAX } }
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(b => resolve(b || file), 'image/jpeg', 0.82)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })

  const uploadPhotos = async (files: File[]) => {
    if (!files.length) return []
    const formData = new FormData()
    formData.append('mission_id', M.id)
    for (const f of files) {
      const compressed = await compressPhoto(f)
      formData.append('files', compressed, f.name.replace(/\.[^.]+$/, '.jpg'))
    }
    const r = await fetch('/api/missions/photos-upload', { method: 'POST', body: formData })
    if (!r.ok) {
      const text = await r.text()
      throw new Error(text.startsWith('{') ? JSON.parse(text).error : `Erreur ${r.status}`)
    }
    const j = await r.json()
    return j.urls as string[]
  }

  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    const newFiles = Array.from(files)
    // Ajouter aux previews locaux seulement — l'upload se fait via savePhotos
    setPhotos(p => [...p, ...newFiles])
    newFiles.forEach(f => { const r = new FileReader(); r.onload = e => setPreviews(p => [...p, e.target?.result as string]); r.readAsDataURL(f) })
  }

  // ── Modifier adresse ──────────────────────────────────────────────────────
  const saveAddr = async () => {
    if (!modField || !modVal) return
    setLoading(true)
    try {
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: M.id, action: 'update_address', field: modField, value: modVal, lat: modLat, lng: modLng }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setM(j.mission); setScreen('main')
    } catch (e: any) { setErr(e.message || 'Erreur') }
    finally { setLoading(false) }
  }

  // ── Ajouter stop ──────────────────────────────────────────────────────────
  const addStop = async () => {
    if (!newStopAddr) return
    const newStop: Stop = {
      id: crypto.randomUUID(), type: 'custom', label: newStopLabel || newStopAddr,
      address: newStopAddr, lat: newStopLat, lng: newStopLng, arrived_at: null, sort_order: stops.length,
    }
    setLoading(true)
    try {
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: M.id, action: 'update_stops', stops: [...stops, newStop] }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setM(j.mission); setScreen('main')
      setNewStopAddr(''); setNewStopLabel(''); setNewStopLat(null); setNewStopLng(null)
    } catch (e: any) { setErr(e.message || 'Erreur') }
    finally { setLoading(false) }
  }

  // ── Mise en parc ──────────────────────────────────────────────────────────
  const doPark = async (vr: VrLoc) => {
    setLoading(true); setErr('')
    try {
      const newUrls = await uploadPhotos(photos)
      const allUrls = [...photoUrls, ...newUrls]
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_id: M.id, action: 'park',
          closing_data: {
            final_mission_type: mType,
            photo_urls: allUrls.length ? allUrls : undefined,
            signature: sig || undefined,
            discharge_data: disch.length > 0 ? disch : undefined,
          },
          park_data: { stage_name: vr.name },
          park_address: vr.address, park_lat: vr.lat, park_lng: vr.lng,
          redelivery_address: M.destination_address || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      clearDraft(); window.location.href = window.location.pathname + '?t=' + Date.now()
    } catch (e: any) { setErr(e.message || 'Erreur') }
    finally { setLoading(false); setShowPark(false) }
  }

  // ── Clôture ───────────────────────────────────────────────────────────────
  const doClose = async () => {
    setLoading(true); setErr('')
    try {
      const newUrls = await uploadPhotos(photos)
      const allUrls = [...photoUrls, ...newUrls]
      if (closeType !== 'dpr' && allUrls.length < 1) { setErr('Ajoutez au moins une photo'); setLoading(false); return }
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_id: M.id, action: 'completed',
          closing_data: {
            final_mission_type: closeType.toUpperCase(),
            photo_urls: allUrls.length ? allUrls : undefined,
            closing_notes: closeNote || undefined,
            signature: sig || undefined,
            discharge_data: disch.length > 0 ? disch : undefined,
          },
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      clearDraft(); window.location.href = window.location.pathname + '?t=' + Date.now()
    } catch (e: any) { setErr(e.message || 'Erreur') }
    finally { setLoading(false) }
  }

  // Éviter l'hydratation mismatch (localStorage vs SSR)
  if (!mounted) return null

  // Clôture labels (doit être avant les early returns)
  const closeLabels: Record<string, [string, string]> = {
    dsp: ['bg-green-600', 'DSP Réussi'],
    rem: ['bg-blue-600',  'REM Confirmé'],
    dpr: ['bg-zinc-600',  'DPR — Déplacement pour rien'],
  }
  const [closeBg, closeLabel] = closeLabels[closeType] || ['bg-zinc-600', closeType.toUpperCase()]

  // ══════════════════════════════════════════════════════════════════════════
  // ÉCRANS FULLSCREEN
  // ══════════════════════════════════════════════════════════════════════════

  // ── savePhotos ───────────────────────────────────────────────────────────
  const savePhotos = async () => {
    setLoading(true); setErr('')
    try {
      let newUrls: string[] = []
      if (photos.length > 0) {
        newUrls = await uploadPhotos(photos)
        if (newUrls.length === 0) {
          setErr(`Upload échoué — ${photos.length} fichier(s) non envoyés. Vérifiez votre connexion.`)
          setLoading(false); return
        }
      }
      const allUrls = [...photoUrls, ...newUrls]
      if (allUrls.length === 0) { setErr('Aucune photo à sauvegarder'); setLoading(false); return }
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: M.id, action: 'save_photos', photo_urls: allUrls }),
      })
      const j = await r.json()
      if (!r.ok) { setErr(`Erreur API: ${j.error || r.status}`); setLoading(false); return }
      setPhotoUrls(allUrls); setPreviews(allUrls); setPhotos([])
      saveDraft({ photoUrls: allUrls })
      setLoading(false)
    } catch (e: any) { setErr(e.message || 'Erreur sauvegarde'); setLoading(false) }
  }

  // ── Photos ────────────────────────────────────────────────────────────────
  if (screen === 'photos') return (
      <ScreenWrap title="Photos" sub={`${totPh} photo${totPh !== 1 ? 's' : ''}`} back={() => setScreen('main')}>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {previews.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-4">
              {photoUrls.map((url, i) => (
                <div key={`u${i}`} className="relative aspect-square rounded-xl overflow-hidden">
                  <img src={url} className="w-full h-full object-cover" />
                  <div className="absolute bottom-0 left-0 right-0 bg-green-600/70 text-white text-xs text-center">✓ sauvegardé</div>
                  <button onClick={async () => {
                    const newUrls = photoUrls.filter((_, j) => j !== i)
                    setPhotoUrls(newUrls); setPreviews(p => p.filter((_, j) => j !== i))
                    saveDraft({ photoUrls: newUrls })
                    await fetch('/api/missions/driver-action', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ mission_id: M.id, action: 'save_photos', photo_urls: newUrls }),
                    }).catch(() => {})
                  }} className="absolute top-1 right-1 w-6 h-6 bg-black/70 rounded-full text-white text-xs flex items-center justify-center">✕</button>
                </div>
              ))}
              {previews.slice(photoUrls.length).map((src, i) => (
                <div key={`f${i}`} className="relative aspect-square rounded-xl overflow-hidden">
                  <img src={src} className="w-full h-full object-cover" />
                  <div className="absolute bottom-0 left-0 right-0 bg-amber-500/70 text-white text-xs text-center">non sauvegardé</div>
                  <button onClick={() => { setPhotos(p => p.filter((_, j) => j !== i)); setPreviews(p => p.filter((_, j) => j !== i + photoUrls.length)) }}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-white text-xs flex items-center justify-center">✕</button>
                </div>
              ))}
            </div>
          )}
          <input ref={photoRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => addPhotos(e.target.files)} />
          <button onClick={() => photoRef.current?.click()}
            className="w-full py-4 border-2 border-dashed border-[#2a2a2a] hover:border-[#CC0000] rounded-2xl text-zinc-400 text-sm">
            📷 Prendre des photos
          </button>
          {err && <p className="text-red-400 text-sm mt-3">⚠️ {err}</p>}
        </div>
        <div className="px-4 py-4 border-t border-[#2a2a2a] space-y-2">
          {photos.length > 0 && (
            <button onClick={savePhotos} disabled={loading}
              className="w-full py-3.5 bg-green-600 disabled:opacity-50 text-white font-bold rounded-2xl">
              {loading ? '⏳ Sauvegarde…' : `💾 Enregistrer ${totPh} photo${totPh > 1 ? 's' : ''}`}
            </button>
          )}
          {photos.length === 0 && (
            <button onClick={() => setScreen('main')} className="w-full py-3.5 bg-[#2a2a2a] text-zinc-400 font-semibold rounded-2xl">← Retour</button>
          )}
        </div>
      </ScreenWrap>
  )

  // ── Décharge ──────────────────────────────────────────────────────────────
  if (screen === 'decharge') return (
    <ScreenWrap title="Décharge client" back={() => setScreen(dischFrom)}>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Motif *</p>
          <textarea rows={3} value={dMotif} onChange={e => setDMotif(e.target.value)} placeholder="Client refuse le remorquage…"
            className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#CC0000] rounded-xl px-3 py-3 text-white text-sm outline-none resize-none" />
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Nom du signataire</p>
          <input value={dName} onChange={e => setDName(e.target.value)} placeholder="Prénom Nom"
            className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#CC0000] rounded-xl px-3 py-3 text-white text-sm outline-none" />
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Signature</p>
          {!dSig ? (showDSig
            ? <SigPad onSave={d => { setDSig(d); setShowDSig(false) }} />
            : <button onClick={() => setShowDSig(true)} className="w-full py-3 border border-dashed border-[#2a2a2a] rounded-xl text-zinc-400 text-sm">✍️ Faire signer</button>)
            : <div><div className="border border-green-500/30 rounded-xl overflow-hidden bg-[#111] mb-2"><img src={dSig} className="w-full max-h-20 object-contain" /></div>
                <button onClick={() => setDSig('')} className="text-zinc-500 text-xs">Refaire</button></div>}
        </div>
      </div>
      <div className="px-4 py-4 border-t border-[#2a2a2a] flex gap-3">
        <button onClick={() => setScreen('main')} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">Annuler</button>
        <button onClick={() => {
            if (!dMotif) return
            const d = { motif: dMotif, name: dName, sig: dSig }
            const updated = [...disch, d]; setDisch(updated); saveDraft({ disch: updated })
            setDMotif(''); setDName(''); setDSig('')
            setScreen(dischFrom)
          }}
          disabled={!dMotif} className="flex-1 py-3 bg-amber-600 disabled:opacity-40 text-white font-semibold rounded-2xl text-sm">Enregistrer</button>
      </div>
    </ScreenWrap>
  )

  // ── Signature ─────────────────────────────────────────────────────────────
  if (screen === 'sig') return (
    <ScreenWrap title="Signature client" back={() => setScreen('close')}>
      <div className="flex-1 px-4 py-4">
        {sig ? (
          <div>
            <div className="border border-green-500/30 rounded-xl overflow-hidden bg-[#111] mb-3"><img src={sig} className="w-full max-h-36 object-contain" /></div>
            <p className="text-green-400 text-sm text-center mb-4">✅ Signature enregistrée</p>
            <button onClick={() => setSig('')} className="w-full py-3 bg-[#2a2a2a] text-zinc-400 rounded-xl text-sm">Refaire</button>
          </div>
        ) : <SigPad onSave={d => { setSig(d); saveDraft({ sig: d }) }} />}
      </div>
      {sig && <div className="px-4 py-4 border-t border-[#2a2a2a]">
        <button onClick={() => setScreen('close')} className="w-full py-3.5 bg-[#CC0000] text-white font-semibold rounded-2xl">← Retour</button>
      </div>}
    </ScreenWrap>
  )

  // ── Encaissement ──────────────────────────────────────────────────────────
  if (screen === 'encaissement') return (
    <ScreenWrap title="Encaisser le paiement" back={() => setScreen('main')}>
      <div className="flex-1 px-4 py-4 space-y-4">
        <div className="bg-[#CC0000] rounded-2xl p-6 text-center">
          <p className="text-white/70 text-sm mb-1">Montant à encaisser</p>
          <p className="text-white text-4xl font-semibold">{(M.amount_to_collect || 0).toFixed(2)} €</p>
        </div>
        {paid
          ? <div className="bg-green-600/20 border border-green-500/30 rounded-2xl p-4 text-center"><p className="text-green-400 font-semibold">✅ Paiement encaissé</p></div>
          : <a href={`/encaissement?prefill_mission_id=${M.id}&prefill_plate=${plate(M.vehicle_plate || '')}&prefill_brand=${M.vehicle_brand || ''}&prefill_model=${M.vehicle_model || ''}&prefill_amount=${M.amount_to_collect || 0}&return_to=/mission/${M.id}`} onClick={() => setTimeout(() => setPaid(true), 3000)} className="w-full flex items-center justify-center py-4 bg-[#CC0000] text-white font-semibold rounded-2xl">💳 Ouvrir l'encaissement</a>}
      </div>
      <div className="px-4 py-4 border-t border-[#2a2a2a]">
        <button onClick={() => setScreen('main')} className="w-full py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">← Retour</button>
      </div>
    </ScreenWrap>
  )

  // ── Ajouter stop ──────────────────────────────────────────────────────────
  if (screen === 'add-stop') return (
    <ScreenWrap title="Ajouter un stop" back={() => setScreen('main')}>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Label <span className="text-zinc-700 normal-case">(optionnel)</span></p>
          <input value={newStopLabel} onChange={e => setNewStopLabel(e.target.value)} placeholder="Garage, domicile client…"
            className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#CC0000] rounded-xl px-3 py-3 text-white text-sm outline-none" />
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Adresse *</p>
          <AddrInput value={newStopAddr} onChange={setNewStopAddr} onPick={(a, lat, lng) => { setNewStopAddr(a); setNewStopLat(lat); setNewStopLng(lng) }} />
        </div>
        {err && <p className="text-red-400 text-sm">⚠️ {err}</p>}
      </div>
      <div className="px-4 py-4 border-t border-[#2a2a2a] flex gap-3">
        <button onClick={() => setScreen('main')} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">Annuler</button>
        <button onClick={addStop} disabled={!newStopAddr || loading} className="flex-1 py-3 bg-[#CC0000] disabled:opacity-40 text-white font-semibold rounded-2xl text-sm">
          {loading ? '⏳…' : '+ Ajouter'}
        </button>
      </div>
    </ScreenWrap>
  )

  // ── Modifier adresse ──────────────────────────────────────────────────────
  if (screen === 'modify-addr') return (
    <ScreenWrap title="Modifier l'adresse" back={() => setScreen('main')}>
      <div className="flex-1 px-4 py-4 space-y-4">
        <AddrInput value={modVal} onChange={setModVal} onPick={(a, lat, lng) => { setModVal(a); setModLat(lat); setModLng(lng) }} />
        {err && <p className="text-red-400 text-sm">⚠️ {err}</p>}
      </div>
      <div className="px-4 py-4 border-t border-[#2a2a2a] flex gap-3">
        <button onClick={() => setScreen('main')} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">Annuler</button>
        <button onClick={saveAddr} disabled={!modVal || loading} className="flex-1 py-3 bg-[#CC0000] disabled:opacity-40 text-white font-semibold rounded-2xl text-sm">
          {loading ? '⏳…' : 'Enregistrer'}
        </button>
      </div>
    </ScreenWrap>
  )

  // ── Clôture ───────────────────────────────────────────────────────────────
  if (screen === 'close') return (
      <ScreenWrap title="Clôturer la mission" sub={`${M.client_name || ''} · ${plate(M.vehicle_plate)}`} back={() => setScreen('main')}>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {/* Type de clôture — informatif, non modifiable ici */}
          <div className={`${closeBg} rounded-2xl px-4 py-3 flex items-center gap-3`}>
            <span className="text-white font-bold text-sm">{closeLabel}</span>
          </div>

          {/* Récap collecte */}
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl px-4 py-4 space-y-3">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium">Récapitulatif</p>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 text-sm">Photos</span>
              <span className={`text-sm font-medium ${totPh >= 3 ? 'text-green-400' : closeType === 'dpr' ? 'text-zinc-500' : 'text-red-400'}`}>
                {totPh} {totPh >= 3 ? '✓' : closeType === 'dpr' ? '(optionnel)' : '/ min. 3'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 text-sm">Signature client</span>
              <span className={`text-sm font-medium ${sig ? 'text-green-400' : 'text-zinc-500'}`}>{sig ? '✓ Signée' : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 text-sm">Décharge{disch.length > 1 ? 's' : ''}</span>
              <span className={`text-sm font-medium ${disch.length > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>{disch.length > 0 ? `✓ ${disch.length} enregistrée${disch.length > 1 ? 's' : ''}` : '—'}</span>
            </div>
            {paid && (
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 text-sm">Paiement</span>
                <span className="text-sm font-medium text-green-400">✓ Encaissé</span>
              </div>
            )}
          </div>

          {/* Décharge rapide "sans dégâts" */}
          <button onClick={() => {
              setDMotif("Je soussigné(e) reconnais que l'intervention du dépanneur s'est déroulée correctement et que ce dernier n'a causé aucun dégât supplémentaire à mon véhicule.")
              setDName(''); setDSig('')
              setDischFrom('close'); setScreen('decharge')
            }} className="w-full flex items-center gap-3 px-4 py-3.5 bg-[#1A1A1A] border border-dashed border-[#2a2a2a] hover:border-zinc-600 rounded-2xl text-left transition">
            <span className="text-xl">🛡️</span>
            <div className="flex-1">
              <p className="text-zinc-300 text-sm font-medium">+ Ajouter une décharge</p>
              <p className="text-zinc-600 text-xs">Sans dégâts ou motif personnalisé</p>
            </div>
          </button>
          {disch.map((d, i) => (
            <div key={i} className="flex items-center gap-3 bg-amber-600/10 border border-amber-600/30 rounded-2xl px-4 py-3">
              <span className="text-xl">🛡️</span>
              <div className="flex-1 min-w-0">
                <p className="text-amber-400 text-sm font-medium">✓ Décharge {i + 1}</p>
                <p className="text-zinc-500 text-xs truncate">{d.motif.slice(0, 60)}{d.motif.length > 60 ? '…' : ''}</p>
              </div>
              <button onClick={() => { const u = disch.filter((_, j) => j !== i); setDisch(u); saveDraft({ disch: u }) }} className="text-zinc-600 text-xs flex-shrink-0">✕</button>
            </div>
          ))}

          {/* Remarques */}
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Remarques <span className="text-zinc-700 normal-case tracking-normal">(optionnel)</span></p>
            <textarea rows={3} value={closeNote} onChange={e => setCloseNote(e.target.value)}
              placeholder="Observations, état du véhicule…"
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#CC0000] rounded-xl px-3 py-3 text-white text-sm outline-none resize-none" />
          </div>

          {closeType !== 'dpr' && totPh < 3 && (
            <p className="text-amber-400 text-sm bg-amber-500/10 rounded-xl px-3 py-2">⚠️ {3 - totPh} photo(s) manquante(s) — retournez en arrière pour en ajouter</p>
          )}
          {err && <p className="text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2">⚠️ {err}</p>}
        </div>

        <div className="px-4 py-4 border-t border-[#2a2a2a]">
          <button onClick={doClose} disabled={loading || (closeType !== 'dpr' && totPh < 3)}
            className="w-full py-4 bg-green-600 disabled:opacity-40 text-white font-semibold rounded-2xl">
            {loading ? '⏳ Envoi…' : '✅ Confirmer la clôture'}
          </button>
        </div>
      </ScreenWrap>
  )

  // ── Mission terminée ──────────────────────────────────────────────────────
  if (M.status === 'completed') return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center gap-4 px-4">
      <div className="w-16 h-16 bg-green-600/20 border border-green-500/30 rounded-full flex items-center justify-center text-3xl">✅</div>
      <h1 className="text-white font-semibold text-xl">Mission terminée</h1>
      <p className="text-zinc-500 text-sm">{M.client_name} · {plate(M.vehicle_plate)}</p>
      <button onClick={() => router.push('/mission')} className="w-full max-w-xs py-3 bg-[#1A1A1A] border border-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">← Mes missions</button>
    </div>
  )

  // ══════════════════════════════════════════════════════════════════════════
  // VUE PRINCIPALE
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#0F0F0F] pb-28">

      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 sticky top-0 z-20">
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => router.push('/mission')} className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white">←</button>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-md text-xs font-bold text-white ${tbg}`}>{tbl}</span>
            <span className={`px-2.5 py-1 rounded-md text-xs font-medium text-white ${statusBg}`}>{statusStr}</span>
          </div>
        </div>
        <h1 className="text-white font-semibold text-lg truncate mt-1">{M.client_name || 'Client inconnu'}</h1>
        {M.client_phone && (
          <a href={`tel:${M.client_phone}`} className="inline-flex items-center gap-1.5 mt-1 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1 text-red-400 text-sm font-medium">
            📞 {M.client_phone}
          </a>
        )}
      </div>

      <div className="px-4 py-4 space-y-3">

        {/* Facturé à + Dossier */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-3">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-1">Facturé à</p>
            <p className="text-white text-sm font-medium truncate">{M.billed_to_name || M.source || '—'}</p>
          </div>
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-3">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-1">Dossier</p>
            <p className="text-white text-xs font-mono truncate">{M.dossier_number || M.external_id || '—'}</p>
          </div>
        </div>

        {/* Description */}
        {M.incident_description && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Description</p>
            <p className="text-white text-sm">{M.incident_description}</p>
          </div>
        )}

        {/* Véhicule */}
        <button onClick={() => setShowVeh(true)} className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 text-left hover:border-zinc-600 transition">
          <div className="flex justify-between mb-1">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium">Véhicule</p>
            <span className="text-red-400 text-xs">✏️ Modifier</span>
          </div>
          <p className="text-white font-semibold">{[M.vehicle_brand, M.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
          {M.vehicle_plate && <p className="text-zinc-400 text-xs font-mono uppercase tracking-widest mt-1">{plate(M.vehicle_plate)}</p>}
        </button>

        {/* DSP : adresse unique */}
        {!rem && (
          <button onClick={() => setAddrModal({ title: "Lieu d'intervention", address: `${M.incident_address || '—'}${M.incident_city ? `, ${M.incident_city}` : ''}`, lat: M.incident_lat, lng: M.incident_lng, field: 'incident' })}
            className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 text-left hover:border-zinc-600 transition">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-1">Lieu d'intervention</p>
            <p className="text-white text-sm">{M.incident_address || '—'}{M.incident_city ? `, ${M.incident_city}` : ''}</p>
            <p className="text-blue-400 text-xs mt-1">🗺️ Tap → Naviguer ou Modifier</p>
          </button>
        )}

        {/* REM : itinéraire complet */}
        {rem && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
              <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium">Itinéraire</p>
              {!isReadOnly && (M.status === 'in_progress' || M.status === 'delivering') && (
                <button onClick={() => setScreen('add-stop')} className="text-xs px-3 py-1.5 bg-[#CC0000] text-white rounded-lg font-medium">+ Stop</button>
              )}
            </div>

            {/* Prise en charge */}
            <button onClick={() => setAddrModal({ title: 'Prise en charge', address: `${M.incident_address || '—'}${M.incident_city ? `, ${M.incident_city}` : ''}`, lat: M.incident_lat, lng: M.incident_lng, field: 'incident' })}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-[#1f1f1f] hover:bg-[#222] text-left">
              <div className="w-3 h-3 rounded-full bg-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-zinc-500 text-xs">Prise en charge</p>
                <p className="text-white text-sm truncate">{M.incident_address || '—'}{M.incident_city ? `, ${M.incident_city}` : ''}</p>
              </div>
              <span className="text-blue-400 text-xs flex-shrink-0">→</span>
            </button>

            {/* Tous les stops + destination — réordonnables ensemble */}
            {(() => {
              // Construire la liste complète : stops existants + destination virtuelle
              const allPoints = [
                ...stops,
                ...(M.destination_address ? [{
                  id: '__dest__',
                  type: 'dest',
                  label: `Destination${M.destination_name ? ` · ${M.destination_name}` : ''}`,
                  address: M.destination_address,
                  lat: null, lng: null, arrived_at: null,
                  sort_order: stops.length,
                }] : []),
              ]
              const canReorder = !isReadOnly && (M.status === 'in_progress' || M.status === 'delivering')
              return allPoints.map((point, idx) => (
                <div key={point.id} className="flex items-center gap-2 px-3 py-3 border-b border-[#1f1f1f] last:border-none">
                  {/* Flèches réordonnement */}
                  {canReorder && !point.arrived_at && (
                    <div className="flex flex-col gap-0.5 flex-shrink-0">
                      <button disabled={idx === 0} onClick={() => {
                        const pts = [...allPoints]
                        ;[pts[idx-1], pts[idx]] = [pts[idx], pts[idx-1]]
                        // Séparer stops et destination
                        const newStops = pts.filter(p => p.id !== '__dest__').map((s, i) => ({ ...s, sort_order: i }))
                        const destPt = pts.find(p => p.id === '__dest__')
                        if (destPt) {
                          // La destination est maintenant avant ce stop — mettre à jour destination_address via update_address n'est pas nécessaire, on la gère via stops
                        }
                        api('update_stops', { stops: newStops })
                      }} className="w-5 h-5 flex items-center justify-center text-zinc-600 disabled:opacity-20 hover:text-zinc-300 text-xs">▲</button>
                      <button disabled={idx === allPoints.length - 1} onClick={() => {
                        const pts = [...allPoints]
                        ;[pts[idx], pts[idx+1]] = [pts[idx+1], pts[idx]]
                        const newStops = pts.filter(p => p.id !== '__dest__').map((s, i) => ({ ...s, sort_order: i }))
                        api('update_stops', { stops: newStops })
                      }} className="w-5 h-5 flex items-center justify-center text-zinc-600 disabled:opacity-20 hover:text-zinc-300 text-xs">▼</button>
                    </div>
                  )}
                  <div className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: point.id === '__dest__' ? '#2563eb' : (STOP_COLORS[point.type] || STOP_COLORS.custom) }} />
                  <button className="flex-1 min-w-0 text-left" onClick={() => {
                    if (point.id === '__dest__') {
                      setAddrModal({ title: point.label, address: point.address, field: 'destination' })
                    }
                  }}>
                    <p className="text-zinc-500 text-xs">{point.label}</p>
                    <p className="text-white text-sm truncate">{point.address}</p>
                    {point.id === '__dest__' && <p className="text-blue-400 text-xs mt-0.5">Tap → Naviguer ou Modifier</p>}
                  </button>
                  {canReorder && !point.arrived_at && point.id !== '__dest__' && (
                    <button onClick={() => api('arrive_stop', { stop_id: point.id })} disabled={loading}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg flex-shrink-0 disabled:opacity-50">
                      → {idx + 1}
                    </button>
                  )}
                  {point.arrived_at && (
                    <span className="text-xs px-2 py-1 bg-green-600/20 text-green-400 rounded-lg flex-shrink-0">✓</span>
                  )}
                </div>
              ))
            })()}
          </div>
        )}

        {/* Remarques */}
        {M.remarks_general && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-1">Remarques</p>
            <p className="text-white text-sm">{M.remarks_general}</p>
          </div>
        )}



        {err && <p className="text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2">⚠️ {err}</p>}
      </div>

      {/* Boutons de pointage */}
      {!isReadOnly && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4 space-y-2">

          {M.status === 'accepted' && (
            <button onClick={() => initNav ? api('on_way') : setShowNav(true)} disabled={loading}
              className="w-full py-4 bg-amber-500 disabled:opacity-50 text-white font-bold rounded-2xl text-base">
              {loading ? '⏳…' : '🚗 En route'}
            </button>
          )}
          {M.status === 'in_progress' && !onSite && (
            <button onClick={() => api('on_site')} disabled={loading}
              className="w-full py-4 bg-orange-500 disabled:opacity-50 text-white font-bold rounded-2xl text-base">
              {loading ? '⏳…' : '📍 Sur place'}
            </button>
          )}
          {(onSite || M.status === 'parked' || M.status === 'delivering') && (
            <>
              {onSite && totPh < 3 && (
                <button onClick={() => setScreen('photos')}
                  className="w-full py-4 bg-orange-500 disabled:opacity-50 text-white font-bold rounded-2xl text-base flex items-center justify-center gap-2">
                  📷 Photos <span className="text-sm font-normal opacity-75">({totPh}/3)</span>
                </button>
              )}
              {onSite && totPh >= 3 && (
                <button onClick={() => { setCloseType(rem ? 'rem' : 'dsp'); setScreen('close') }}
                  className="w-full py-4 bg-green-600 text-white font-bold rounded-2xl text-base flex items-center justify-center gap-2">
                  🏁 Terminer
                </button>
              )}
              <button onClick={() => setShowGrid(true)}
                className="w-full py-4 bg-[#1A1A1A] border border-[#2a2a2a] hover:border-zinc-600 text-white font-bold rounded-2xl text-base flex items-center justify-center gap-2">
                ☰ Actions
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Modal Actions ☰ ─────────────────────────────────────────────── */}
      {showGrid && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => setShowGrid(false)}>
          <div className="bg-[#1A1A1A] w-full rounded-t-3xl pb-8" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 bg-zinc-700 rounded-full" /></div>
            <div className="px-5 pb-3 border-b border-[#2a2a2a] flex items-center justify-between">
              <div>
                <p className="text-white font-semibold">{M.client_name}</p>
                <p className="text-zinc-500 text-xs">{[M.vehicle_brand, M.vehicle_model].filter(Boolean).join(' ')} · {plate(M.vehicle_plate)}</p>
              </div>
              <button onClick={() => setShowGrid(false)} className="text-zinc-500 text-2xl">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4">
              {/* Photos */}
              <button onClick={() => { setShowGrid(false); setScreen('photos') }}
                className={`relative rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border transition active:scale-95 ${totPh > 0 ? 'bg-green-600/20 border-green-600/40' : 'bg-[#111] border-[#2a2a2a]'}`}>
                <span className="text-2xl">📷</span>
                <span className={`text-sm font-medium ${totPh > 0 ? 'text-green-400' : 'text-zinc-300'}`}>Photos</span>
                {totPh > 0 && <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-xs font-bold bg-green-500 text-white">{totPh}</span>}
              </button>
              {/* Décharge */}
              <button onClick={() => { setShowGrid(false); setDischFrom('main'); setDMotif(''); setDName(''); setDSig(''); setScreen('decharge') }}
                className={`relative rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border transition active:scale-95 ${disch.length > 0 ? 'bg-amber-600/20 border-amber-600/40' : 'bg-[#111] border-[#2a2a2a]'}`}>
                <span className="text-2xl">📋</span>
                <span className={`text-sm font-medium ${disch.length > 0 ? 'text-amber-400' : 'text-zinc-300'}`}>Décharge</span>
                {disch.length > 0 && <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-white">{disch.length}</span>}
              </button>
              {/* Encaisser */}
              {M.amount_to_collect != null && M.amount_to_collect > 0 && (
                <button onClick={() => { setShowGrid(false); setScreen('encaissement') }}
                  className={`relative rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border transition active:scale-95 ${paid ? 'bg-green-600/20 border-green-600/40' : 'bg-[#111] border-[#2a2a2a]'}`}>
                  <span className="text-2xl">💳</span>
                  <span className={`text-sm font-medium ${paid ? 'text-green-400' : 'text-zinc-300'}`}>Encaisser</span>
                  {paid && <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-xs font-bold bg-green-500 text-white">✓</span>}
                </button>
              )}
              {/* DSP↔REM */}
              <button onClick={() => changeType(rem ? 'DSP' : 'REM')} disabled={loading}
                className="rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-blue-600/10 border-blue-600/30 transition active:scale-95 disabled:opacity-50">
                <span className="text-2xl">🔄</span>
                <span className="text-sm font-medium text-blue-400">{rem ? 'REM → DSP' : 'DSP → REM'}</span>
              </button>
              {/* Mise en parc (REM uniquement) */}
              {rem && (
                <button onClick={() => { setShowGrid(false); setShowPark(true) }}
                  className="rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-amber-600/10 border-amber-600/30 transition active:scale-95">
                  <span className="text-2xl">🅿️</span>
                  <span className="text-sm font-medium text-amber-400">Mise en parc</span>
                </button>
              )}
              {/* DPR */}
              <button onClick={() => { setShowGrid(false); setCloseType('dpr'); setScreen('close') }}
                className="rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-[#111] border-[#2a2a2a] transition active:scale-95">
                <span className="text-2xl">❌</span>
                <span className="text-sm font-medium text-zinc-300">DPR</span>
              </button>
              {/* Terminer */}
              <button onClick={() => { setShowGrid(false); setCloseType(rem ? 'rem' : 'dsp'); setScreen('close') }}
                className={`${rem ? '' : 'col-span-2'} rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-[#CC0000] border-[#CC0000] transition active:scale-95`}>
                <span className="text-2xl">🏁</span>
                <span className="text-sm font-bold text-white">Terminer</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Mise en parc ───────────────────────────────────────────── */}
      {showPark && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => setShowPark(false)}>
          <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h2 className="text-white font-semibold text-lg">Choisir le parc</h2>
              <button onClick={() => setShowPark(false)} className="text-zinc-500 text-2xl">×</button>
            </div>
            {M.destination_address && (
              <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl px-3 py-2.5">
                <p className="text-blue-300 text-xs font-medium">Adresse de relivraison</p>
                <p className="text-white text-sm">{M.destination_address}</p>
              </div>
            )}
            {vrLocs.length === 0
              ? <p className="text-zinc-600 text-sm text-center py-4">Aucun parc enregistré</p>
              : vrLocs.map(vr => (
                <button key={vr.id} onClick={() => doPark(vr)} disabled={loading}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-[#111] border border-[#2a2a2a] rounded-2xl text-left hover:border-zinc-600 transition disabled:opacity-50 active:scale-95">
                  <span className="text-xl">🅿️</span>
                  <div><p className="text-white font-medium text-sm">{vr.name}</p><p className="text-zinc-500 text-xs">{vr.address}</p></div>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* ── Modal adresse (naviguer / modifier) ─────────────────────────── */}
      {addrModal && (
        <AddrActionModal
          title={addrModal.title} address={addrModal.address}
          onNavigate={() => { const u = gUrl(navApp, addrModal.lat, addrModal.lng, addrModal.address); if (u) window.open(u, '_blank'); setAddrModal(null) }}
          onModify={() => { setModField(addrModal.field); setModVal(addrModal.address); setModLat(addrModal.lat ?? null); setModLng(addrModal.lng ?? null); setAddrModal(null); setScreen('modify-addr') }}
          onClose={() => setAddrModal(null)}
        />
      )}

      {/* Nav app modal */}
      {showNav && <NavModal onPick={async app => {
        setNavApp(app); setShowNav(false)
        await fetch('/api/users/nav-preference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nav_app: app }) })
        const u = gUrl(app, M.incident_lat, M.incident_lng, M.incident_address)
        if (u) window.open(u, '_blank')
        api('on_way')
      }} />}

      {/* Vehicle sheet */}
      {showVeh && <VehSheet m={M} onClose={() => setShowVeh(false)} onSave={async (p, b, mo, v) => {
        setM(m => ({ ...m, vehicle_plate: p, vehicle_brand: b, vehicle_model: mo, vehicle_vin: v }))
        setShowVeh(false)
        await fetch('/api/missions/update-vehicle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_id: M.id, vehicle_plate: p, vehicle_brand: b, vehicle_model: mo, vehicle_vin: v }) }).catch(() => {})
      }} />}
    </div>
  )
}
