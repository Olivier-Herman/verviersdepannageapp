'use client'
// DriverClient v3 — spec figée — zéro popup, grille TowSoft, 1 tap = 1 action

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

// ─── Types ────────────────────────────────────────────────────────────────────
type NavApp = 'gmaps' | 'waze' | 'apple'
type Tab    = 0 | 1 | 2 | 3

interface Stop {
  id: string; type: string; label: string; address: string
  lat: number | null; lng: number | null; arrived_at: string | null; sort_order: number
}
interface Mission {
  id: string; status: string; mission_type?: string
  client_name?: string; client_phone?: string
  vehicle_brand?: string; vehicle_model?: string; vehicle_plate?: string; vehicle_vin?: string
  incident_address?: string; incident_city?: string; incident_lat?: number; incident_lng?: number
  destination_address?: string; destination_name?: string; destination_lat?: number; destination_lng?: number
  incident_description?: string; remarks_general?: string; source?: string; dossier_number?: string
  accepted_at?: string; on_way_at?: string; on_site_at?: string; completed_at?: string; parked_at?: string
  amount_guaranteed?: number; amount_currency?: string; amount_to_collect?: number
  park_stage_name?: string; extra_addresses?: Stop[]
}
interface VrLoc { id: string; name: string; address: string; lat: number | null; lng: number | null }
interface Props { mission: Mission; currentUserId: string; isReadOnly?: boolean; navApp?: NavApp }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const plate  = (v = '') => v.replace(/[-.\s]/g, '').toUpperCase()
const fmt    = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '—'
const isREM  = (t = '') => ['REM', 'remorquage', 'transport'].includes(t)
const isDSP  = (t = '') => ['DSP', 'depannage', 'reparation_place'].includes(t)
const gUrl   = (app: NavApp, lat?: number, lng?: number, addr?: string) => {
  const q = lat && lng ? `${lat},${lng}` : encodeURIComponent(addr || ''); if (!q) return null
  if (app === 'waze')  return `https://waze.com/ul?ll=${q}&navigate=yes`
  if (app === 'apple') return `https://maps.apple.com/?daddr=${q}&dirflg=d`
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`
}
const TYPE_BADGE: Record<string, [string, string]> = {
  DSP: ['DSP', 'bg-orange-500'], REM: ['REM', 'bg-blue-600'], DPR: ['DPR', 'bg-zinc-600'],
  depannage: ['DSP', 'bg-orange-500'], remorquage: ['REM', 'bg-blue-600'],
  trajet_vide: ['DPR', 'bg-zinc-600'], reparation_place: ['DSP', 'bg-orange-500'],
  transport: ['REM', 'bg-blue-600'],
}
const STATUS_BADGE: Record<string, [string, string]> = {
  assigned:    ['À accepter', 'bg-blue-600'],
  accepted:    ['Acceptée',   'bg-indigo-600'],
  in_progress: ['En cours',   'bg-orange-500'],
  parked:      ['En dépôt',   'bg-amber-600'],
  delivering:  ['En livraison','bg-teal-600'],
  completed:   ['Terminée',   'bg-green-600'],
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

// Signature
function SigPad({ onSave }: { onSave: (d: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const pen  = useRef(false)
  const [drawn, setDrawn] = useState(false)
  const xy = (e: React.TouchEvent | React.MouseEvent, c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect()
    const s = 'touches' in e ? e.touches[0] : e
    return { x: s.clientX - r.left, y: s.clientY - r.top }
  }
  const down = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault(); const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!; const p = xy(e, c)
    ctx.beginPath(); ctx.moveTo(p.x, p.y); pen.current = true
  }
  const move = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault(); if (!pen.current) return
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!; const p = xy(e, c)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#fff'
    ctx.lineTo(p.x, p.y); ctx.stroke(); setDrawn(true)
  }
  const up = () => { pen.current = false }
  const clear = () => { ref.current?.getContext('2d')!.clearRect(0, 0, 340, 130); setDrawn(false) }
  return (
    <div>
      <div className="border border-[#2a2a2a] rounded-xl overflow-hidden bg-[#111] mb-3">
        <canvas ref={ref} width={340} height={130} className="w-full touch-none"
          onMouseDown={down} onMouseMove={move} onMouseUp={up}
          onTouchStart={down} onTouchMove={move} onTouchEnd={up} />
      </div>
      <div className="flex gap-2">
        <button onClick={clear} className="flex-1 py-2.5 bg-[#2a2a2a] text-zinc-400 rounded-xl text-sm">Effacer</button>
        <button onClick={() => ref.current && onSave(ref.current.toDataURL())} disabled={!drawn}
          className="flex-1 py-2.5 bg-green-600 disabled:opacity-40 text-white rounded-xl text-sm font-medium">✅ Valider</button>
      </div>
    </div>
  )
}

// Google Places input
function AddrInput({ value, onChange, onPick, placeholder }: {
  value: string; onChange: (v: string) => void
  onPick: (addr: string, lat: number, lng: number) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const ac  = useRef<any>(null)
  const [gps, setGps] = useState(false)
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
  const doGps = () => {
    if (!navigator.geolocation) return; setGps(true)
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords
      const g = (window as any).google
      if (g?.maps) new g.maps.Geocoder().geocode({ location: { lat, lng } }, (r: any[], s: string) => {
        setGps(false); if (s === 'OK' && r[0]) { onChange(r[0].formatted_address); onPick(r[0].formatted_address, lat, lng) }
      }); else setGps(false)
    }, () => setGps(false), { enableHighAccuracy: true, timeout: 10000 })
  }
  return (
    <div className="space-y-2">
      <button onClick={doGps} disabled={gps} type="button"
        className="w-full py-2.5 bg-blue-600/15 border border-blue-500/30 text-blue-300 rounded-xl text-sm disabled:opacity-50">
        {gps ? '⏳ Localisation…' : '📍 Ma position'}
      </button>
      <input ref={ref} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder || 'Adresse ou établissement…'}
        className="w-full bg-[#111] border border-[#2a2a2a] focus:border-brand rounded-xl px-3 py-3 text-white text-sm outline-none placeholder:text-zinc-600" />
      {value && <p className="text-green-400 text-xs truncate">✓ {value}</p>}
    </div>
  )
}

// VehicleEdit sheet
function VehSheet({ m, onSave, onClose }: { m: Mission; onSave: (p: string, b: string, mo: string, v: string) => void; onClose: () => void }) {
  const [p, setP] = useState(plate(m.vehicle_plate)); const [b, setB] = useState(m.vehicle_brand || '')
  const [mo, setMo] = useState(m.vehicle_model || '');  const [v, setV] = useState(m.vehicle_vin || '')
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={onClose}>
      <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between"><h2 className="text-white font-semibold text-lg">Modifier le véhicule</h2><button onClick={onClose} className="text-zinc-500 text-2xl">×</button></div>
        {([['Plaque', p, setP], ['Marque', b, setB], ['Modèle', mo, setMo], ['VIN (optionnel)', v, setV]] as [string, string, (v: string) => void][]).map(([l, val, set]) => (
          <div key={l}>
            <p className="text-zinc-500 text-xs mb-1.5">{l}</p>
            <input value={val} onChange={e => set(e.target.value)}
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-brand rounded-xl px-3 py-3 text-white text-sm outline-none" />
          </div>
        ))}
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">Annuler</button>
          <button onClick={() => onSave(plate(p), b, mo, v)} className="flex-1 py-3 bg-brand text-white font-semibold rounded-2xl text-sm">Enregistrer</button>
        </div>
      </div>
    </div>
  )
}

// Nav app modal
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

// ─── Écrans fullscreen (hors fiche) ──────────────────────────────────────────

// Wrapper écran
function Screen({ title, sub, back, children }: { title: string; sub?: string; back: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-[#0F0F0F] z-40 flex flex-col">
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={back} className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white">←</button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold truncate">{title}</p>
            {sub && <p className="text-zinc-500 text-xs truncate">{sub}</p>}
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function DriverClient({ mission: init, isReadOnly = false, navApp: initNav }: Props) {
  const router = useRouter()

  // ── State ────────────────────────────────────────────────────────────────
  const [M,           setM]           = useState<Mission>(init)
  const [tab,         setTab]         = useState<Tab>(0)
  const [screen,      setScreen]      = useState<'main'|'photos'|'km'|'sig'|'decharge'|'encaissement'|'close'|'stops'>('main')
  const [loading,     setLoading]     = useState(false)
  const [err,         setErr]         = useState('')
  const [navApp,      setNavApp]      = useState<NavApp>(initNav || 'gmaps')
  const [showNav,     setShowNav]     = useState(false)
  const [showVeh,     setShowVeh]     = useState(false)
  const [showGrid,    setShowGrid]    = useState(false)

  // Draft
  const DKEY = `vd3_${M.id}`
  const draft = (() => { try { return JSON.parse(localStorage.getItem(DKEY) || '{}') } catch { return {} } })()
  const save  = (u: object) => { try { localStorage.setItem(DKEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(DKEY) || '{}'), ...u })) } catch {} }
  const clear = () => { try { localStorage.removeItem(DKEY) } catch {} }

  // Données collectées
  const [photos,    setPhotos]    = useState<File[]>([])
  const [photoUrls, setPhotoUrls] = useState<string[]>(draft.photoUrls || [])
  const [previews,  setPreviews]  = useState<string[]>(draft.photoUrls || [])
  const [km,        setKm]        = useState(draft.km || '')
  const [note,      setNote]      = useState(draft.note || '')
  const [sig,       setSig]       = useState(draft.sig || '')
  const [disch,     setDisch]     = useState<{motif:string;name:string;sig:string}|null>(draft.disch || null)
  const [paid,      setPaid]      = useState(false)

  // Clôture REM
  const [destAddr,   setDestAddr]   = useState(M.destination_address || '')
  const [destLat,    setDestLat]    = useState<number|null>(M.destination_lat ?? null)
  const [destLng,    setDestLng]    = useState<number|null>(M.destination_lng ?? null)
  const [vrAddr,     setVrAddr]     = useState('')
  const [vrLat,      setVrLat]      = useState<number|null>(null)
  const [vrLng,      setVrLng]      = useState<number|null>(null)
  const [clientAddr, setClientAddr] = useState('')
  const [clientLat,  setClientLat]  = useState<number|null>(null)
  const [clientLng,  setClientLng]  = useState<number|null>(null)
  const [closeType,  setCloseType]  = useState<'dsp'|'rem'|'dpr'>(() => isREM(init.mission_type || '') ? 'rem' : 'dsp')
  const [vrLocs,     setVrLocs]     = useState<VrLoc[]>([])

  // Décharge locale
  const [dMotif, setDMotif] = useState(''); const [dName, setDName] = useState(''); const [dSig, setDSig] = useState(''); const [showDSig, setShowDSig] = useState(false)

  const photoRef = useRef<HTMLInputElement>(null)
  const totPh    = photos.length + photoUrls.length
  const mType    = M.mission_type || ''
  const rem      = isREM(mType); const dsp = isDSP(mType)
  const onSite   = !!M.on_site_at
  const [tbl, tbg]  = TYPE_BADGE[mType] || ['AUT', 'bg-zinc-600']
  const statusStr = M.on_site_at ? 'Sur place' : M.on_way_at && M.status === 'in_progress' ? 'En route' : (STATUS_BADGE[M.status]?.[0] || M.status)
  const statusBg  = M.on_site_at ? 'bg-orange-500' : M.on_way_at && M.status === 'in_progress' ? 'bg-amber-500' : (STATUS_BADGE[M.status]?.[1] || 'bg-zinc-600')

  // Google Maps
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; if (!key || document.getElementById('gm-v3')) return
    const s = document.createElement('script'); s.id = 'gm-v3'
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&language=fr`
    document.head.appendChild(s)
  }, [])

  // VR locations
  useEffect(() => { if (rem) fetch('/api/vr-locations').then(r => r.json()).then(d => setVrLocs(Array.isArray(d) ? d : [])).catch(() => {}) }, [rem])

  // ── API ───────────────────────────────────────────────────────────────────
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

  const uploadPhotos = async (files: File[]) => {
    const urls: string[] = []
    for (const f of files) {
      const ext = f.name.split('.').pop() || 'jpg'
      const path = `${M.id}/draft-${Date.now()}.${ext}`
      const { error } = await sb.storage.from('mission-photos').upload(path, f)
      if (!error) { const { data } = sb.storage.from('mission-photos').getPublicUrl(path); urls.push(data.publicUrl) }
    }
    return urls
  }

  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    const newFiles = Array.from(files)
    setPhotos(p => [...p, ...newFiles])
    newFiles.forEach(f => { const r = new FileReader(); r.onload = e => setPreviews(p => [...p, e.target?.result as string]); r.readAsDataURL(f) })
    const urls = await uploadPhotos(newFiles)
    setPhotoUrls(prev => { const u = [...prev, ...urls]; save({ photoUrls: u }); return u })
  }

  const doClose = async (type: 'dsp' | 'rem' | 'dpr', park = false) => {
    setLoading(true); setErr('')
    try {
      const newUrls = await uploadPhotos(photos)
      const allUrls = [...photoUrls, ...newUrls]
      const stops: Stop[] = []
      if (clientAddr) stops.push({ id: crypto.randomUUID(), type: 'client', label: 'Reconduire le client', address: clientAddr, lat: clientLat, lng: clientLng, arrived_at: null, sort_order: 0 })
      if (vrAddr)     stops.push({ id: crypto.randomUUID(), type: 'vr',     label: 'Livraison VR',         address: vrAddr,     lat: vrLat,     lng: vrLng,     arrived_at: null, sort_order: stops.length })
      const da = destAddr || M.destination_address || ''
      if (da)         stops.push({ id: crypto.randomUUID(), type: 'dest',   label: 'Destination',          address: da,         lat: destLat,   lng: destLng,   arrived_at: null, sort_order: stops.length })
      const action = type === 'rem' && stops.length > 0 ? 'start_delivery' : park ? 'park' : 'completed'
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_id: M.id, action,
          closing_data: { final_mission_type: type.toUpperCase(), mileage: km ? parseInt(km) : undefined, photo_urls: allUrls, closing_notes: note || undefined, closing_mode: park ? 'parked' : type, destination_address: da || undefined, stops: stops.length ? stops : undefined, discharge_motif: disch?.motif, discharge_name: disch?.name, discharge_sig: disch?.sig, signature: sig || undefined },
          park_data: park ? { stage_name: 'En parc' } : undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      clear(); setM(j.mission)
      window.location.href = window.location.pathname + '?t=' + Date.now()
    } catch (e: any) { setErr(e.message || 'Erreur') }
    finally { setLoading(false) }
  }

  // ── Écran PHOTOS ──────────────────────────────────────────────────────────
  if (screen === 'photos') return (
    <Screen title="Photos" sub={`${totPh} photo${totPh !== 1 ? 's' : ''} — min. 3`} back={() => setScreen('main')}>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium">Photos</p>
          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${totPh >= 3 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/10 text-red-400'}`}>{totPh >= 3 ? `${totPh} ✓` : `${totPh}/3`}</span>
        </div>
        {previews.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {photoUrls.map((url, i) => (
              <div key={`u${i}`} className="relative aspect-square rounded-xl overflow-hidden">
                <img src={url} className="w-full h-full object-cover" />
                <div className="absolute bottom-0 left-0 right-0 bg-green-600/70 text-white text-xs text-center">✓</div>
              </div>
            ))}
            {previews.slice(photoUrls.length).map((src, i) => (
              <div key={`f${i}`} className="relative aspect-square rounded-xl overflow-hidden">
                <img src={src} className="w-full h-full object-cover" />
                <button onClick={() => { setPhotos(p => p.filter((_, j) => j !== i)); setPreviews(p => p.filter((_, j) => j !== i + photoUrls.length)) }}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-white text-xs flex items-center justify-center">✕</button>
              </div>
            ))}
          </div>
        )}
        <input ref={photoRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => addPhotos(e.target.files)} />
        <button onClick={() => photoRef.current?.click()} className="w-full py-4 border-2 border-dashed border-[#2a2a2a] hover:border-brand rounded-2xl text-zinc-400 text-sm">📷 Prendre des photos</button>
      </div>
      <div className="px-4 py-4 border-t border-[#2a2a2a]">
        <button onClick={() => setScreen('main')} className="w-full py-3.5 bg-brand text-white font-semibold rounded-2xl">← Retour aux actions</button>
      </div>
    </Screen>
  )

  // ── Écran KM ──────────────────────────────────────────────────────────────
  if (screen === 'km') return (
    <Screen title="Km & Remarques" back={() => setScreen('main')}>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Kilométrage</p>
          <div className="bg-[#111] border-2 border-[#2a2a2a] focus-within:border-brand rounded-2xl p-4 text-center">
            <input type="number" inputMode="numeric"
              defaultValue={km} onBlur={e => { setKm(e.target.value); save({ km: e.target.value }) }}
              placeholder="— — — — —"
              className="bg-transparent border-none text-white text-4xl font-mono text-center w-full outline-none placeholder:text-zinc-700" />
            <p className="text-zinc-600 text-xs mt-1">km</p>
          </div>
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Remarques <span className="text-zinc-700 normal-case tracking-normal">(optionnel)</span></p>
          <textarea rows={3} defaultValue={note} onBlur={e => { setNote(e.target.value); save({ note: e.target.value }) }}
            placeholder="Observations, état du véhicule…"
            className="w-full bg-[#111] border border-[#2a2a2a] focus:border-brand rounded-xl px-3 py-3 text-white text-sm outline-none resize-none" />
        </div>
      </div>
      <div className="px-4 py-4 border-t border-[#2a2a2a]">
        <button onClick={() => setScreen('main')} className="w-full py-3.5 bg-brand text-white font-semibold rounded-2xl">← Retour aux actions</button>
      </div>
    </Screen>
  )

  // ── Écran SIGNATURE ───────────────────────────────────────────────────────
  if (screen === 'sig') return (
    <Screen title="Signature client" back={() => setScreen('main')}>
      <div className="flex-1 px-4 py-4">
        {sig ? (
          <div>
            <div className="border border-green-500/30 rounded-xl overflow-hidden bg-[#111] mb-3"><img src={sig} className="w-full max-h-36 object-contain" /></div>
            <p className="text-green-400 text-sm text-center mb-4">✅ Signature enregistrée</p>
            <button onClick={() => setSig('')} className="w-full py-3 bg-[#2a2a2a] text-zinc-400 rounded-xl text-sm">Refaire</button>
          </div>
        ) : (
          <SigPad onSave={d => { setSig(d); save({ sig: d }) }} />
        )}
      </div>
      {sig && <div className="px-4 py-4 border-t border-[#2a2a2a]"><button onClick={() => setScreen('main')} className="w-full py-3.5 bg-brand text-white font-semibold rounded-2xl">← Retour aux actions</button></div>}
    </Screen>
  )

  // ── Écran DÉCHARGE ────────────────────────────────────────────────────────
  if (screen === 'decharge') return (
    <Screen title="Décharge client" back={() => setScreen('main')}>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Motif *</p>
          <textarea rows={3} value={dMotif} onChange={e => setDMotif(e.target.value)} placeholder="Client refuse le remorquage…"
            className="w-full bg-[#111] border border-[#2a2a2a] focus:border-brand rounded-xl px-3 py-3 text-white text-sm outline-none resize-none" />
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Nom du signataire</p>
          <input value={dName} onChange={e => setDName(e.target.value)} placeholder="Prénom Nom"
            className="w-full bg-[#111] border border-[#2a2a2a] focus:border-brand rounded-xl px-3 py-3 text-white text-sm outline-none" />
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Signature</p>
          {!dSig
            ? showDSig ? <SigPad onSave={d => { setDSig(d); setShowDSig(false) }} />
              : <button onClick={() => setShowDSig(true)} className="w-full py-3 border border-dashed border-[#2a2a2a] rounded-xl text-zinc-400 text-sm">✍️ Faire signer</button>
            : <div><div className="border border-green-500/30 rounded-xl overflow-hidden bg-[#111] mb-2"><img src={dSig} className="w-full max-h-20 object-contain" /></div>
                <button onClick={() => setDSig('')} className="text-zinc-500 text-xs">Refaire</button></div>}
        </div>
        {err && <p className="text-red-400 text-sm">⚠️ {err}</p>}
      </div>
      <div className="px-4 py-4 border-t border-[#2a2a2a] flex gap-3">
        <button onClick={() => setScreen('main')} className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">Annuler</button>
        <button onClick={() => { if (!dMotif) return; const d = { motif: dMotif, name: dName, sig: dSig }; setDisch(d); save({ disch: d }); setScreen('main') }}
          disabled={!dMotif} className="flex-1 py-3 bg-amber-600 disabled:opacity-40 text-white font-semibold rounded-2xl text-sm">Enregistrer</button>
      </div>
    </Screen>
  )

  // ── Écran CLÔTURER ────────────────────────────────────────────────────────
  if (screen === 'close') return (
    <Screen title="Clôturer la mission" sub={`${M.client_name || ''} · ${plate(M.vehicle_plate)}`} back={() => setScreen('main')}>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Choix du type */}
        <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium">Type de clôture</p>
        {rem && closeType !== 'rem' && closeType !== 'dpr' && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-3 py-2 text-orange-300 text-xs">⚠️ Mission REM → clôturée comme DSP</div>
        )}
        {!rem && dsp && closeType !== 'dsp' && closeType !== 'dpr' && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-3 py-2 text-blue-300 text-xs">⚠️ Mission DSP → clôturée comme REM</div>
        )}
        <div className="space-y-2">
          {(rem
            ? [['rem', 'bg-blue-600', 'REM', 'REM Confirmé', 'Remorquage'],
               ['dsp', 'bg-orange-500', '→', 'REM → DSP', 'Finalement réparé sur place'],
               ['dpr', 'bg-zinc-600', 'DPR', 'DPR', 'Déplacement pour rien']]
            : [['dsp', 'bg-orange-500', 'DSP', 'DSP Réussi', 'Dépannage sur place'],
               ['rem', 'bg-blue-600', '→', 'DSP → REM', 'Remorquage nécessaire'],
               ['dpr', 'bg-zinc-600', 'DPR', 'DPR', 'Déplacement pour rien']]
          ).map(([t, bg, ic, lb, sub]) => (
            <button key={t} onClick={() => setCloseType(t as any)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition ${closeType === t ? `border-transparent ring-2 ring-white/20 ${bg}` : 'bg-[#1A1A1A] border-[#2a2a2a]'}`}>
              <div className={`${bg} rounded-lg w-9 h-9 flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>{ic}</div>
              <div className="text-left flex-1">
                <p className="text-white font-medium text-sm">{lb}</p>
                <p className="text-zinc-500 text-xs">{sub}</p>
              </div>
              {closeType === t && <span className="text-white text-lg">✓</span>}
            </button>
          ))}
        </div>

        {/* DPR : juste remarque */}
        {closeType === 'dpr' && (
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Remarques <span className="text-zinc-700 normal-case tracking-normal">(optionnel)</span></p>
            <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Véhicule introuvable, accès impossible…"
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-brand rounded-xl px-3 py-3 text-white text-sm outline-none resize-none" />
          </div>
        )}

        {/* REM : destination + VR + reconduire */}
        {(closeType === 'rem') && (
          <>
            <div>
              <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Destination *</p>
              {vrLocs.length > 0 && (
                <div className="space-y-1 mb-2">
                  {vrLocs.map(vr => (
                    <button key={vr.id} onClick={() => { setVrAddr(`${vr.name}, ${vr.address}`); if (vr.lat) setVrLat(vr.lat); if (vr.lng) setVrLng(vr.lng) }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 bg-teal-900/30 border border-teal-700/40 rounded-xl text-left">
                      <span className="text-teal-400">🚗</span>
                      <div><p className="text-white text-xs font-medium">{vr.name}</p><p className="text-zinc-500 text-xs">{vr.address}</p></div>
                    </button>
                  ))}
                </div>
              )}
              <AddrInput value={destAddr} onChange={setDestAddr} onPick={(a, lat, lng) => { setDestAddr(a); setDestLat(lat); setDestLng(lng) }} placeholder="Garage, domicile, fourrière…" />
              <button onClick={() => setDestAddr('')} className="w-full mt-2 py-2.5 bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-xl text-sm">🅿️ Client ne sait pas encore</button>
            </div>
            <div>
              <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">VR <span className="text-zinc-700 normal-case tracking-normal">(optionnel)</span></p>
              {vrAddr
                ? <div className="flex items-center gap-2 bg-teal-900/20 border border-teal-700/30 rounded-xl px-3 py-2.5">
                    <span className="text-teal-400">🚗</span><p className="text-white text-sm flex-1 truncate">{vrAddr}</p>
                    <button onClick={() => setVrAddr('')} className="text-zinc-600 text-xs">✕</button>
                  </div>
                : <AddrInput value={vrAddr} onChange={setVrAddr} onPick={(a, lat, lng) => { setVrAddr(a); setVrLat(lat); setVrLng(lng) }} placeholder="Rent A Car, garage… (optionnel)" />}
            </div>
            <div>
              <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Reconduire client <span className="text-zinc-700 normal-case tracking-normal">(optionnel)</span></p>
              {clientAddr
                ? <div className="flex items-center gap-2 bg-purple-900/20 border border-purple-700/30 rounded-xl px-3 py-2.5">
                    <span className="text-purple-400">👤</span><p className="text-white text-sm flex-1 truncate">{clientAddr}</p>
                    <button onClick={() => setClientAddr('')} className="text-zinc-600 text-xs">✕</button>
                  </div>
                : <AddrInput value={clientAddr} onChange={setClientAddr} onPick={(a, lat, lng) => { setClientAddr(a); setClientLat(lat); setClientLng(lng) }} placeholder="Domicile, gare, hôtel… (optionnel)" />}
            </div>
          </>
        )}

        {/* Récap */}
        {closeType !== 'dpr' && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3 space-y-1">
            <p className="text-zinc-600 text-xs mb-2">Récap</p>
            <div className="flex gap-4 flex-wrap">
              <span className={`text-sm ${totPh >= 3 ? 'text-green-400' : 'text-zinc-600'}`}>📷 {totPh} {totPh >= 3 ? '✓' : '/ min. 3'}</span>
              <span className={`text-sm ${km ? 'text-green-400' : 'text-zinc-600'}`}>⚙️ {km ? `${parseInt(km).toLocaleString('fr-BE')} km ✓` : 'Km —'}</span>
              <span className={`text-sm ${sig ? 'text-green-400' : 'text-zinc-600'}`}>✍️ {sig ? 'Signé ✓' : '—'}</span>
              <span className={`text-sm ${disch ? 'text-amber-400' : 'text-zinc-600'}`}>📋 {disch ? 'Décharge ✓' : '—'}</span>
            </div>
            {totPh < 3 && <p className="text-amber-400 text-xs">⚠️ {3 - totPh} photo(s) manquante(s)</p>}
          </div>
        )}

        {err && <p className="text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2">⚠️ {err}</p>}
      </div>

      <div className="px-4 py-4 border-t border-[#2a2a2a] space-y-2">
        {rem && closeType === 'rem' && (
          <button onClick={() => doClose('rem', true)} disabled={loading}
            className="w-full py-3 bg-amber-600/20 border border-amber-600/40 text-amber-300 font-medium rounded-2xl text-sm disabled:opacity-40">
            {loading ? '⏳…' : '🅿️ Mettre en parc'}
          </button>
        )}
        <button onClick={() => doClose(closeType)} disabled={loading}
          className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-semibold rounded-2xl disabled:cursor-not-allowed">
          {loading ? '⏳ Envoi…' : '✅ Confirmer'}
        </button>
      </div>
    </Screen>
  )

  // ── Écran STOPS ───────────────────────────────────────────────────────────
  if (screen === 'stops' || M.status === 'delivering') {
    const stops = [...(M.extra_addresses || [])].sort((a, b) => a.sort_order - b.sort_order)
    const allDone = stops.length > 0 && stops.every(s => s.arrived_at)
    const COL: Record<string, string> = { client: '#7c3aed', vr: '#0f766e', dest: '#2563eb', depot: '#d97706' }
    const ICO: Record<string, string> = { client: '👤', vr: '🚗', dest: '🏁', depot: '🅿️' }
    return (
      <div className="min-h-screen bg-[#0F0F0F] pb-24">
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 sticky top-0 z-10">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-1 bg-teal-600 rounded-lg text-xs font-bold text-white">EN LIVRAISON</span>
            <span className="text-white font-semibold truncate">{M.client_name}</span>
          </div>
          <p className="text-zinc-500 text-xs">{stops.filter(s => s.arrived_at).length}/{stops.length} stops</p>
          <div className="h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden mt-2">
            <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${stops.length ? stops.filter(s => s.arrived_at).length / stops.length * 100 : 0}%` }} />
          </div>
        </div>
        <div className="px-4 mt-4 space-y-3">
          {stops.map((stop, i) => {
            const done = !!stop.arrived_at
            const next = !done && stops.slice(0, i).every(s => s.arrived_at)
            const url  = gUrl(navApp, stop.lat ?? undefined, stop.lng ?? undefined, stop.address)
            return (
              <div key={stop.id} className={`bg-[#1A1A1A] border-2 rounded-2xl p-4 ${done ? 'border-green-500/30 opacity-60' : next ? 'border-teal-500' : 'border-[#2a2a2a]'}`}>
                <div className="flex items-start gap-3">
                  {done && <span className="text-green-400 text-xl">✓</span>}
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: COL[stop.type] || '#2563eb' }}>{ICO[stop.type] || '📍'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white font-semibold text-sm">{stop.label}</p>
                      {next && <span className="px-1.5 py-0.5 bg-teal-500/20 border border-teal-500/40 text-teal-300 text-xs rounded">Prochain</span>}
                    </div>
                    <p className="text-zinc-500 text-xs truncate">{stop.address}</p>
                    {done && stop.arrived_at && <p className="text-green-400 text-xs mt-1">Arrivé à {fmt(stop.arrived_at)}</p>}
                    {next && url && <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-blue-600/15 border border-blue-500/30 rounded-lg text-blue-300 text-xs font-medium">🗺️ Naviguer</a>}
                  </div>
                </div>
                {next && (
                  <button onClick={() => api('arrive_stop', { stop_id: stop.id })} disabled={loading}
                    className="w-full mt-3 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-semibold rounded-xl text-sm">
                    {loading ? '⏳' : '✅ Arrivé'}
                  </button>
                )}
              </div>
            )
          })}
          {allDone && (
            <div className="space-y-3 mt-2">
              <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 text-center">
                <p className="text-green-400 font-semibold">Tous les stops effectués !</p>
              </div>
              <button onClick={() => api('complete_delivery')} disabled={loading}
                className="w-full py-4 bg-green-600 disabled:opacity-40 text-white font-semibold rounded-2xl">
                {loading ? '⏳…' : '🏁 Terminer la mission'}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── FICHE PRINCIPALE + GRILLE ─────────────────────────────────────────────
  if (M.status === 'completed') return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6 text-center gap-4">
      <div className="text-6xl">🏁</div>
      <h1 className="text-white font-semibold text-xl">Mission terminée</h1>
      <p className="text-zinc-500 text-sm">{M.client_name} · {plate(M.vehicle_plate)}</p>
      <button onClick={() => router.push('/mission')} className="w-full py-3 bg-[#1A1A1A] border border-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">← Mes missions</button>
    </div>
  )

  // Grille tiles
  const tiles = onSite || M.status === 'parked' ? [
    { icon: '📷', label: 'Photos', badge: totPh >= 3 ? '✓' : `${totPh}`, ok: totPh >= 3, action: () => { setShowGrid(false); setScreen('photos') } },
    { icon: '⚙️', label: 'Km / Note', badge: km ? '✓' : '', ok: !!km, action: () => { setShowGrid(false); setScreen('km') } },
    { icon: '✍️', label: 'Signature', badge: sig ? '✓' : '', ok: !!sig, action: () => { setShowGrid(false); setScreen('sig') } },
    { icon: '📋', label: 'Décharge', badge: disch ? '✓' : '', ok: !!disch, action: () => { setShowGrid(false); setScreen('decharge') } },
    ...(M.amount_to_collect && M.amount_to_collect > 0 ? [{ icon: '💳', label: 'Encaisser', badge: paid ? '✓' : `${M.amount_to_collect}€`, ok: paid, action: () => { setShowGrid(false); setScreen('encaissement') } }] : []),
    { icon: '🏁', label: 'Terminer', badge: '', ok: false, primary: true, action: () => { setShowGrid(false); setScreen('close') } },
    ...(rem ? [{ icon: '🅿️', label: 'Mettre en parc', badge: '', ok: false, amber: true, action: () => { setShowGrid(false); doClose(closeType, true) } }] : []),
  ] : []

  return (
    <div className="min-h-screen bg-[#0F0F0F] pb-32">

      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-4 sticky top-0 z-20">
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => router.push('/mission')} className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white">←</button>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-md text-xs font-medium text-white ${tbg}`}>{tbl}</span>
            <span className={`px-2.5 py-1 rounded-md text-xs font-medium text-white ${statusBg}`}>{statusStr}</span>
          </div>
        </div>
        <h1 className="text-white font-semibold text-lg truncate">{M.client_name || 'Client inconnu'}</h1>
        {M.client_phone && (
          <a href={`tel:${M.client_phone}`} className="inline-flex items-center gap-1.5 mt-1 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1 text-red-400 text-sm font-medium">
            📞 {M.client_phone}
          </a>
        )}
      </div>

      {/* Onglets */}
      <div className="flex bg-[#111] border-b border-[#2a2a2a] sticky top-[88px] z-10">
        {['Info', 'Client', 'Véhicule', 'Facture'].map((t, i) => (
          <button key={t} onClick={() => setTab(i as Tab)}
            className={`flex-1 py-2.5 text-xs font-medium border-b-2 transition ${tab === i ? 'text-[#CC0000] border-[#CC0000]' : 'text-zinc-500 border-transparent'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Contenu onglets */}
      <div className="px-4 py-4 space-y-3">

        {/* ── Info ── */}
        {tab === 0 && <>
          {M.incident_description && (
            <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
              <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Description</p>
              <p className="text-white text-sm">{M.incident_description}</p>
            </div>
          )}
          <button onClick={() => { const u = gUrl(navApp, M.incident_lat, M.incident_lng, M.incident_address); if (u) window.open(u, '_blank') }}
            className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 text-left hover:border-zinc-600 transition">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-1">Lieu d'intervention</p>
            <p className="text-white text-sm">{M.incident_address || '—'}{M.incident_city ? `, ${M.incident_city}` : ''}</p>
            {M.incident_address && <p className="text-blue-400 text-xs mt-1">🗺️ Tap pour naviguer</p>}
          </button>
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-1">Destination</p>
            <p className="text-white text-sm">{destAddr || M.destination_address || '—'}</p>
          </div>
          {M.dossier_number && (
            <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
              <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-1">Dossier</p>
              <p className="text-white text-sm font-mono">{M.dossier_number}</p>
              {M.source && <p className="text-zinc-500 text-xs mt-0.5">{M.source}</p>}
            </div>
          )}
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Pointages</p>
            {[['Commande', M.accepted_at], ['En route', M.on_way_at], ['Sur place', M.on_site_at], ['Terminé', M.completed_at]].map(([l, v]) => (
              <div key={l as string} className="flex justify-between py-1.5 border-b border-[#1f1f1f] last:border-none">
                <span className="text-zinc-500 text-xs">{l as string}</span>
                <span className="text-white text-xs font-mono">{v ? fmt(v as string) : '—'}</span>
              </div>
            ))}
          </div>
          {M.remarks_general && (
            <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
              <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-1">Remarques</p>
              <p className="text-white text-sm">{M.remarks_general}</p>
            </div>
          )}
        </>}

        {/* ── Client ── */}
        {tab === 1 && <>
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Client assisté</p>
            <p className="text-white font-semibold text-base mb-3">{M.client_name || '—'}</p>
            {M.client_phone && (
              <a href={`tel:${M.client_phone}`} className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 text-red-400 font-medium text-sm">
                📞 {M.client_phone}
              </a>
            )}
          </div>
          {M.source && (
            <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
              <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-1">Compagnie</p>
              <p className="text-white font-semibold">{M.source}</p>
              {M.dossier_number && <p className="text-zinc-500 text-xs font-mono mt-1">{M.dossier_number}</p>}
            </div>
          )}
        </>}

        {/* ── Véhicule ── */}
        {tab === 2 && <>
          <button onClick={() => setShowVeh(true)} className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 text-left hover:border-zinc-600 transition">
            <div className="flex justify-between mb-1">
              <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium">Véhicule</p>
              <span className="text-red-400 text-xs">✏️ Modifier</span>
            </div>
            <p className="text-white font-semibold text-base">{[M.vehicle_brand, M.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
            {M.vehicle_plate && <p className="text-zinc-400 text-xs font-mono uppercase tracking-widest mt-1">{plate(M.vehicle_plate)}</p>}
            {M.vehicle_vin && <p className="text-zinc-500 text-xs mt-1">VIN : {M.vehicle_vin}</p>}
          </button>
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-2">Données encodées</p>
            <div className="flex justify-between py-1.5 border-b border-[#1f1f1f]">
              <span className="text-zinc-500 text-sm">Kilométrage</span>
              <span className={`text-sm font-mono ${km ? 'text-white' : 'text-zinc-600'}`}>{km ? `${parseInt(km).toLocaleString('fr-BE')} km` : '—'}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-zinc-500 text-sm">Photos</span>
              <span className={`text-sm ${totPh >= 3 ? 'text-green-400' : 'text-zinc-600'}`}>{totPh} {totPh >= 3 ? '✓' : '/ min. 3'}</span>
            </div>
          </div>
        </>}

        {/* ── Facture ── */}
        {tab === 3 && <>
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-1">Montant garanti</p>
            <p className="text-white text-2xl font-semibold">{M.amount_guaranteed != null ? `${M.amount_guaranteed.toFixed(2)} ${M.amount_currency || '€'} TTC` : '—'}</p>
            {M.source && <p className="text-zinc-500 text-xs mt-1">Garanti par {M.source}</p>}
          </div>
          {M.amount_to_collect != null && M.amount_to_collect > 0 && (
            <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
              <p className="text-zinc-500 text-xs uppercase tracking-widest font-medium mb-1">À encaisser client</p>
              <p className={`text-xl font-semibold ${paid ? 'text-green-400' : 'text-white'}`}>{M.amount_to_collect.toFixed(2)} € {paid ? '✓ Payé' : ''}</p>
            </div>
          )}
        </>}

        {err && <p className="text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2">⚠️ {err}</p>}
      </div>

      {/* ── Bouton principal (statuts simples) ──────────────────────────────── */}
      {!isReadOnly && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#0F0F0F]/95 border-t border-[#2a2a2a] px-4 py-4 space-y-2">
          {M.status === 'assigned' && (
            <button onClick={() => api('accept')} disabled={loading}
              className="w-full py-4 bg-blue-600 disabled:opacity-50 text-white font-bold rounded-2xl text-base">
              {loading ? '⏳…' : '✅ Accepter la mission'}
            </button>
          )}
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
          {(onSite || M.status === 'parked') && (
            <button onClick={() => setShowGrid(true)}
              className="w-full py-4 bg-[#1A1A1A] border border-[#2a2a2a] hover:border-zinc-600 text-white font-bold rounded-2xl text-base flex items-center justify-center gap-2">
              <span>☰</span> Actions
            </button>
          )}
        </div>
      )}

      {/* ── Grille d'actions (sheet du bas) ─────────────────────────────────── */}
      {showGrid && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => setShowGrid(false)}>
          <div className="bg-[#1A1A1A] w-full rounded-t-3xl pb-8" onClick={e => e.stopPropagation()}>
            {/* Tirette */}
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 bg-zinc-700 rounded-full" /></div>
            {/* Infos mission */}
            <div className="px-5 pb-3 border-b border-[#2a2a2a]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-semibold">{M.client_name}</p>
                  <p className="text-zinc-500 text-xs">{[M.vehicle_brand, M.vehicle_model].filter(Boolean).join(' ')} · {plate(M.vehicle_plate)}</p>
                </div>
                <button onClick={() => setShowGrid(false)} className="text-zinc-500 text-2xl">×</button>
              </div>
            </div>
            {/* Grille */}
            <div className="grid grid-cols-2 gap-3 p-4">
              {tiles.map((tile, i) => (
                <button key={i} onClick={tile.action}
                  className={`relative rounded-2xl py-5 flex flex-col items-center justify-center gap-2 transition active:scale-95 border
                    ${(tile as any).primary ? 'bg-[#CC0000] border-[#CC0000]'
                    : (tile as any).amber   ? 'bg-amber-600 border-amber-600'
                    : tile.ok               ? 'bg-green-600/20 border-green-600/40'
                    :                         'bg-[#111] border-[#2a2a2a]'}`}>
                  <span className="text-2xl">{tile.icon}</span>
                  <span className={`text-sm font-medium ${(tile as any).primary || (tile as any).amber ? 'text-white' : tile.ok ? 'text-green-400' : 'text-zinc-300'}`}>{tile.label}</span>
                  {tile.badge && (
                    <span className={`absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-xs font-bold ${tile.badge === '✓' ? 'bg-green-500 text-white' : 'bg-white/20 text-white'}`}>
                      {tile.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showNav && <NavModal onPick={async app => {
        setNavApp(app); setShowNav(false)
        await fetch('/api/users/nav-preference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nav_app: app }) })
        const u = gUrl(app, M.incident_lat, M.incident_lng, M.incident_address)
        if (u) window.open(u, '_blank')
        api('on_way')
      }} />}
      {showVeh && <VehSheet m={M} onClose={() => setShowVeh(false)} onSave={async (p, b, mo, v) => {
        setM(m => ({ ...m, vehicle_plate: p, vehicle_brand: b, vehicle_model: mo, vehicle_vin: v }))
        setShowVeh(false)
        await fetch('/api/missions/update-vehicle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_id: M.id, vehicle_plate: p, vehicle_brand: b, vehicle_model: mo, vehicle_vin: v }) }).catch(() => {})
      }} />}

      {/* Encaissement (dans grille) */}
      {screen === 'encaissement' && (() => {
        const amount = M.amount_to_collect || 0
        const encUrl = `/encaissement?prefill_mission_id=${M.id}&prefill_plate=${plate(M.vehicle_plate || '')}&prefill_brand=${M.vehicle_brand || ''}&prefill_model=${M.vehicle_model || ''}&prefill_amount=${amount}&return_to=/mission/${M.id}`
        return (
          <Screen title="Encaisser le paiement" back={() => setScreen('main')}>
            <div className="flex-1 px-4 py-4 space-y-4">
              <div className="bg-brand rounded-2xl p-6 text-center">
                <p className="text-white/70 text-sm mb-1">Montant à encaisser</p>
                <p className="text-white text-4xl font-semibold">{amount.toFixed(2)} €</p>
              </div>
              {paid
                ? <div className="bg-green-600/20 border border-green-500/30 rounded-2xl p-4 text-center"><p className="text-green-400 font-semibold text-base">✅ Paiement encaissé</p></div>
                : <a href={encUrl} onClick={() => setTimeout(() => setPaid(true), 3000)} className="w-full flex items-center justify-center py-4 bg-brand text-white font-semibold rounded-2xl text-base">💳 Ouvrir l'encaissement</a>}
            </div>
            <div className="px-4 py-4 border-t border-[#2a2a2a]">
              <button onClick={() => setScreen('main')} className="w-full py-3 bg-[#2a2a2a] text-zinc-400 rounded-2xl text-sm">← Retour</button>
            </div>
          </Screen>
        )
      })()}
    </div>
  )
}
