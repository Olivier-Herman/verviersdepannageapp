'use client'
// DriverClient v4 — spec figée — DSP/REM, stops, mise en parc, realtime

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { formatEur } from '@/lib/format'
import AmbientBackground from '@/components/AmbientBackground'
import { DISCHARGE_TYPES, getDischarge as getDischargeFallback, type DischargeEntry, type DischargeType } from '@/lib/decharges'
import DamageSchemaPad, { type DamageSchemaUrls } from '@/components/decharges/DamageSchemaPad'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

// ─── Types ────────────────────────────────────────────────────────────────────
type NavApp = 'gmaps' | 'waze' | 'apple'
type Screen = 'main' | 'photos' | 'decharge' | 'sig' | 'encaissement' | 'close' | 'add-stop' | 'modify-addr'

interface Stop {
  id: string; type: string; label: string; address: string
  lat: number | null; lng: number | null; arrived_at: string | null; on_way_at?: string | null; sort_order: number
}
interface Mission {
  id: string; status: string; mission_type?: string
  incident_type?: string                                       // 'relivraison' = REL
  parent_mission_id?: string | null                            // si REL, lien vers la mission parente parc
  client_name?: string; client_phone?: string
  billed_to_name?: string; source?: string; dossier_number?: string; external_id?: string
  vehicle_brand?: string; vehicle_model?: string; vehicle_plate?: string; vehicle_vin?: string
  incident_address?: string; incident_city?: string; incident_lat?: number; incident_lng?: number
  incident_description?: string; remarks_general?: string
  destination_address?: string; destination_name?: string; redelivery_address?: string
  accepted_at?: string; on_way_at?: string; on_site_at?: string
  loaded_at?: string
  completed_at?: string; parked_at?: string; delivering_at?: string
  amount_guaranteed?: number; amount_currency?: string; amount_to_collect?: number
  payment_collected_at?: string | null; payment_mode?: string | null; payment_amount?: number | null
  park_stage_name?: string; extra_addresses?: Stop[]; driver_photos?: string[]
  photo_categories_covered?: string[]  // categories du wizard photos couvertes (persiste en BDD, multi-device)
}
interface VrLoc { id: string; name: string; address: string; lat: number | null; lng: number | null; is_default?: boolean }
interface Props { mission: Mission; currentUserId?: string; isReadOnly?: boolean; navApp?: NavApp }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const plate = (v = '') => v.replace(/[-.\s]/g, '').toUpperCase()
const isREM = (t = '') => ['REM', 'remorquage', 'transport'].includes(t)
// REL = mission de relivraison (vehicule en parc -> client). Detect via incident_type ou
// parent_mission_id (auto-cree par createRelivraisonMission). C est techniquement une REM
// mais avec un workflow legerement adapte (skip "Sur place", on demarre du parc charge).
const isRELMission = (m: Mission) =>
  m.incident_type === 'relivraison' || !!m.parent_mission_id
const gUrl  = (app: NavApp, lat?: number, lng?: number, addr?: string) => {
  const q = lat && lng ? `${lat},${lng}` : encodeURIComponent(addr || ''); if (!q) return null
  if (app === 'waze')  return `https://waze.com/ul?ll=${q}&navigate=yes`
  if (app === 'apple') return `https://maps.apple.com/?daddr=${q}&dirflg=d`
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`
}
const TYPE_BADGE: Record<string, [string, string]> = {
  DSP: ['DSP', 'bg-brand'], REM: ['REM', 'bg-blue-600'], DPR: ['DPR', 'bg-ink-faint'],
  REL: ['REL', 'bg-purple-600'],
  depannage: ['DSP', 'bg-brand'], remorquage: ['REM', 'bg-blue-600'],
  reparation_place: ['DSP', 'bg-brand'], transport: ['REM', 'bg-blue-600'],
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

// Motifs de DPR (Déplacement Pour Rien) typés.
// "Autre" requiert un texte libre. Stocké dans closing_data.dpr_motif côté API.
const DPR_MOTIFS = [
  { id: 'vehicule_absent',   icon: '🚫', label: 'Véhicule absent / introuvable' },
  { id: 'refus_proprio',     icon: '🙅', label: 'Propriétaire refuse l\'intervention' },
  { id: 'acces_impossible',  icon: '🚧', label: 'Accès impossible (terrain privé, fourrière)' },
  { id: 'deja_deplace',      icon: '🚗', label: 'Véhicule déjà dépanné / déplacé' },
  { id: 'pas_de_panne',      icon: '✅', label: 'Pas de panne constatée' },
  { id: 'annulation_client', icon: '📞', label: 'Demande d\'annulation client' },
  { id: 'autre',             icon: '✍️', label: 'Autre' },
] as const
type DprMotifId = typeof DPR_MOTIFS[number]['id']

// ─── Stepper visuel : étapes du workflow chauffeur ────────────────────────────
// 3 variantes :
//   DSP : Accepter → En route → Sur place → Clôture (4)
//   REM : Accepter → En route → Sur place → Chargé → Destination → Clôture (6)
//   REL : Accepter → En route → Chargé → Destination → Clôture (5)
//         (skip Sur place, on demarre du parc directement charge)
function Stepper({ status, onSite, loaded, isRem, isRel }: {
  status: string; onSite: boolean; loaded: boolean; isRem: boolean; isRel?: boolean
}) {
  const labels = isRel
    ? ['Accepter', 'En route', 'Chargé', 'Destination', 'Clôture']
    : isRem
      ? ['Accepter', 'En route', 'Sur place', 'Chargé', 'Destination', 'Clôture']
      : ['Accepter', 'En route', 'Sur place', 'Clôture']

  // 'to_invoice' = mission terminee cote chauffeur (en attente facturation).
  // Pour les checks d'UI chauffeur, on le traite comme 'completed'.
  const done = status === 'completed' || status === 'to_invoice'

  const step = isRel
    ? (
        status === 'assigned'                                    ? 0 :
        status === 'accepted'                                    ? 1 :
        (status === 'in_progress' && !loaded)                    ? 2 :  // En route / chargement au parc
        (loaded && !done && status !== 'parked')                  ? 3 : // En cours de livraison
        done || status === 'parked'                               ? 4 : 0
      )
    : isRem
      ? (
          status === 'assigned'                                    ? 0 :
          status === 'accepted'                                    ? 1 :
          (status === 'in_progress' && !onSite)                    ? 2 :
          (onSite && !loaded && status !== 'delivering')           ? 3 :
          (status === 'delivering' || (loaded && !done && status !== 'parked')) ? 4 :
          (done || status === 'parked')                            ? 5 : 0
        )
      : (
          status === 'assigned'                                    ? 0 :
          status === 'accepted'                                    ? 1 :
          (status === 'in_progress' && !onSite)                    ? 2 :
          onSite                                                   ? 3 :
          done                                                     ? 4 : 0
        )

  return (
    <div className="flex items-center gap-1 mt-3">
      {labels.map((label, i) => {
        const done    = i < step
        const current = i === step
        return (
          <div key={i} className="flex-1 flex items-center gap-1">
            <div className={`flex-1 flex flex-col items-center gap-1 ${current ? 'opacity-100' : done ? 'opacity-90' : 'opacity-40'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                done    ? 'bg-green-600 text-ink' :
                current ? 'bg-brand text-white ring-2 ring-brand/40' :
                          'bg-surface-hover text-ink-muted'
              }`}>
                {done ? '✓' : i + 1}
              </div>
              <p className={`text-[9px] font-medium leading-tight text-center ${
                current ? 'text-ink' : done ? 'text-green-400' : 'text-ink-muted'
              }`}>{label}</p>
            </div>
            {i < labels.length - 1 && (
              <div className={`h-0.5 flex-shrink-0 w-2 -mt-3 ${done ? 'bg-green-600' : 'bg-surface-hover'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
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
      <div className="border border rounded-xl overflow-hidden bg-surface mb-3">
        <canvas ref={ref} width={340} height={130} className="w-full touch-none"
          onMouseDown={down} onMouseMove={move} onMouseUp={() => { pen.current = false }}
          onTouchStart={down} onTouchMove={move} onTouchEnd={() => { pen.current = false }} />
      </div>
      <div className="flex gap-2">
        <button onClick={clear} className="flex-1 py-2.5 bg-surface-hover text-ink-secondary rounded-xl text-sm">Effacer</button>
        <button onClick={() => ref.current && onSave(ref.current.toDataURL())} disabled={!drawn}
          className="flex-1 py-2.5 bg-green-600 disabled:opacity-40 text-ink rounded-xl text-sm font-medium">✅ Valider</button>
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
      className="w-full bg-surface border border focus:border-brand rounded-xl px-3 py-3 text-ink text-sm outline-none placeholder:text-ink-faint" />
  )
}

// ─── VehSheet ─────────────────────────────────────────────────────────────────
function VehSheet({ m, onSave, onClose }: { m: Mission; onSave: (p: string, b: string, mo: string, v: string) => void; onClose: () => void }) {
  const [p, setP] = useState(plate(m.vehicle_plate)); const [b, setB] = useState(m.vehicle_brand || '')
  const [mo, setMo] = useState(m.vehicle_model || ''); const [v, setV] = useState(m.vehicle_vin || '')
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={onClose}>
      <div className="bg-surface w-full rounded-t-3xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between"><h2 className="text-ink font-semibold text-lg">Modifier le véhicule</h2><button onClick={onClose} className="text-ink-muted text-2xl">×</button></div>
        {([['Plaque', p, setP], ['Marque', b, setB], ['Modèle', mo, setMo], ['VIN (optionnel)', v, setV]] as [string, string, (v: string) => void][]).map(([l, val, set]) => (
          <div key={l}><p className="text-ink-muted text-xs mb-1.5">{l}</p>
            <input value={val} onChange={e => set(e.target.value)}
              className="w-full bg-surface border border focus:border-brand rounded-xl px-3 py-3 text-ink text-sm outline-none" /></div>
        ))}
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-3 bg-surface-hover text-ink-secondary rounded-2xl text-sm">Annuler</button>
          <button onClick={() => onSave(plate(p), b, mo, v)} className="flex-1 py-3 bg-brand text-white font-semibold rounded-2xl text-sm">Enregistrer</button>
        </div>
      </div>
    </div>
  )
}

// ─── NavModal ─────────────────────────────────────────────────────────────────
function NavModal({ onPick }: { onPick: (a: NavApp) => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end">
      <div className="bg-surface w-full rounded-t-3xl p-6 space-y-2">
        <p className="text-ink font-semibold text-base mb-4">App de navigation</p>
        {([['gmaps', '🗺️', 'Google Maps'], ['waze', '🧭', 'Waze'], ['apple', '📍', 'Plans']] as [NavApp, string, string][]).map(([id, ic, lb]) => (
          <button key={id} onClick={() => onPick(id)} className="w-full flex items-center gap-4 px-4 py-3.5 bg-surface border border rounded-2xl">
            <span className="text-2xl">{ic}</span><span className="text-ink font-medium">{lb}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── AddrActionModal — tap adresse ────────────────────────────────────────────
function AddrActionModal({ title, address, onNavigate, onModify, onClose }: {
  title: string; address: string; onNavigate: () => void; onModify?: () => void; onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={onClose}>
      <div className="bg-surface w-full rounded-t-3xl p-6 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <div><p className="text-ink-muted text-xs">{title}</p><p className="text-ink font-medium text-sm mt-0.5">{address}</p></div>
          <button onClick={onClose} className="text-ink-muted text-2xl ml-4">×</button>
        </div>
        <button onClick={onNavigate} className="w-full py-3.5 bg-blue-600 text-ink font-semibold rounded-2xl text-sm">🗺️ Naviguer</button>
        {onModify && (
          <button onClick={onModify} className="w-full py-3.5 bg-surface-hover text-ink-secondary font-medium rounded-2xl text-sm">✏️ Modifier l'adresse</button>
        )}
      </div>
    </div>
  )
}

// ─── Screen wrapper ───────────────────────────────────────────────────────────
function ScreenWrap({ title, sub, back, children }: { title: string; sub?: string; back: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-surface z-40 flex flex-col">
      <div className="bg-surface border-b border px-4 pt-12 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={back} className="w-9 h-9 flex items-center justify-center bg-surface-hover rounded-xl text-ink">←</button>
          <div className="flex-1 min-w-0"><p className="text-ink font-semibold truncate">{title}</p>
            {sub && <p className="text-ink-muted text-xs truncate">{sub}</p>}</div>
        </div>
      </div>
      {children}
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function DriverClient({ mission: init, currentUserId, isReadOnly = false, navApp: initNav }: Props) {
  const router = useRouter()

  const [M, setM]               = useState<Mission>(init)
  const [screen, setScreen]     = useState<Screen>('main')
  // Memorise l ecran d origine avant d entrer dans 'photos' pour pouvoir y
  // retourner apres save/retour. Sans ca, on revenait toujours sur 'main'
  // meme si on venait de 'close'.
  const [photosFrom, setPhotosFrom] = useState<Screen>('main')
  const goPhotos = (from: Screen = 'main') => { setPhotosFrom(from); setScreen('photos') }
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const [navApp, setNavApp]     = useState<NavApp>(initNav || 'gmaps')
  const [showNav, setShowNav]   = useState(false)
  const [showVeh, setShowVeh]   = useState(false)
  const [showGrid, setShowGrid] = useState(false)
  const [showPark, setShowPark] = useState(false)
  const [dischFrom, setDischFrom] = useState<Screen>('main')
  const [addrModal, setAddrModal] = useState<{ title: string; address: string; lat?: number; lng?: number; field?: string } | null>(null)

  // Modify address
  const [modField, setModField] = useState('')
  const [destOnWay, setDestOnWay]   = useState(false)
  const [destArrived, setDestArrived] = useState(false); const [modVal, setModVal] = useState('')
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
  const [disch, setDisch]         = useState<DischargeEntry[]>([])
  const [paid, setPaid]           = useState(false)
  // Etat reel persiste : DB > state local (le state local sert de quick-feedback
  // pendant les 3s avant redirect retour depuis /encaissement)
  const hasAnyPayment   = paid || !!M.payment_collected_at
  // 'unpaid' = mode "A facturer" → considere comme resolu (le bureau facturera)
  const isToInvoice     = hasAnyPayment && M.payment_mode === 'unpaid'
  // Montant a afficher : SOMME de tous les encaissements lies a la mission
  const paidAmount      = M.payment_amount != null ? M.payment_amount : M.amount_to_collect
  // Paiement complet : pas de montant a encaisser, OU mode "A facturer", OU somme >= total prevu
  const requiredAmount  = M.amount_to_collect || 0
  const paymentComplete = requiredAmount <= 0
    || isToInvoice
    || (hasAnyPayment && (M.payment_amount ?? 0) + 0.001 >= requiredAmount)  // +0.001 = tolerance arrondi
  // paidEffective = encaisse ET complet (utilise pour les annotations "Payee" / "Facture a envoyer")
  const paidEffective   = hasAnyPayment && paymentComplete
  // Paiement partiel : au moins un encaissement mais total insuffisant
  const partiallyPaid   = hasAnyPayment && !paymentComplete

  // ── Dérogation paiement (5-tap caché sur banderole rouge) ──────────────────
  // UX : pas de bouton visible (briefing vocal a l equipe). 5 taps rapides
  // (< 2s entre chaque) sur la banderole "A encaisser" → modal s ouvre.
  // Feedback discret a partir du 3e tap (compteur "3/5").
  const [derogTapCount, setDerogTapCount] = useState(0)
  const [derogTapTimer, setDerogTapTimer] = useState<NodeJS.Timeout | null>(null)
  const [derogModalOpen, setDerogModalOpen] = useState(false)
  const [derogMotive, setDerogMotive] = useState('')
  const [derogSubmitting, setDerogSubmitting] = useState(false)
  const [derogPending, setDerogPending] = useState<{ id: string; motive: string; requested_at: string } | null>(null)
  // Modal "Reponse a votre derogation" : declenche par realtime quand le dispatcheur decide
  const [derogResult, setDerogResult] = useState<{
    decision: 'cancelled_amount' | 'adjusted' | 'refused'
    new_amount: number | null
    note: string | null
  } | null>(null)
  const [derogManageOpen, setDerogManageOpen] = useState(false)
  const handleDerogTap = () => {
    const next = derogTapCount + 1
    setDerogTapCount(next)
    if (derogTapTimer) clearTimeout(derogTapTimer)
    if (next >= 5) {
      setDerogTapCount(0)
      // Si une demande existe deja : modal de gestion (modifier / annuler / nouveau)
      if (derogPending) {
        setDerogManageOpen(true)
      } else {
        setDerogModalOpen(true)
      }
      return
    }
    setDerogTapTimer(setTimeout(() => setDerogTapCount(0), 2000))
  }
  const cancelDerogation = async () => {
    if (!derogPending) return
    setDerogSubmitting(true); setErr('')
    try {
      const r = await fetch(`/api/missions/${M.id}/payment-derogation`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setDerogPending(null)
      setDerogManageOpen(false)
    } catch (e: any) {
      setErr(e.message || 'Erreur')
    } finally {
      setDerogSubmitting(false)
    }
  }

  // ── Set amount_to_collect (geste 5-taps cache sur Dossier) ──────────────────
  // Cas inverse de la derogation : mission envoyee SANS montant a encaisser mais
  // qui s avere finalement payante sur place. Le chauffeur ajoute le montant.
  const [setAmtTapCount, setSetAmtTapCount] = useState(0)
  const [setAmtTapTimer, setSetAmtTapTimer] = useState<NodeJS.Timeout | null>(null)
  const [setAmtModalOpen, setSetAmtModalOpen] = useState(false)
  const [setAmtValue, setSetAmtValue] = useState('')
  const [setAmtSubmitting, setSetAmtSubmitting] = useState(false)
  const handleSetAmtTap = () => {
    const next = setAmtTapCount + 1
    setSetAmtTapCount(next)
    if (setAmtTapTimer) clearTimeout(setAmtTapTimer)
    if (next >= 5) {
      setSetAmtTapCount(0)
      setSetAmtValue(String(M.amount_to_collect || ''))
      setSetAmtModalOpen(true)
      return
    }
    setSetAmtTapTimer(setTimeout(() => setSetAmtTapCount(0), 2000))
  }
  const submitSetAmount = async () => {
    const n = parseFloat(setAmtValue)
    if (Number.isNaN(n) || n < 0) { setErr('Montant invalide'); return }
    setSetAmtSubmitting(true); setErr('')
    try {
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: M.id, action: 'set_amount_to_collect', amount: n }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setSetAmtModalOpen(false)
      setSetAmtValue('')
      window.location.reload()
    } catch (e: any) {
      setErr(e.message || 'Erreur')
    } finally {
      setSetAmtSubmitting(false)
    }
  }
  // Charge l etat de derogation pending au mount + refresh sur changement mission
  useEffect(() => {
    let cancelled = false
    fetch(`/api/missions/${M.id}/payment-derogation`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setDerogPending(j.derogation || null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [M.id, M.amount_to_collect])

  // Polling 5s en fallback du Realtime : si Realtime ne fire pas (config Supabase
  // douteuse, websocket flap), le chauffeur voit la decision en max 5s.
  useEffect(() => {
    if (!derogPending) return
    let cancelled = false
    const tick = async () => {
      try {
        const r = await fetch(`/api/missions/${M.id}/payment-derogation?latest=1`)
        const j = await r.json()
        if (cancelled) return
        if (j.derogation) {
          // Toujours pending → maj du motif si modifie ailleurs
          setDerogPending(j.derogation)
        } else if (j.recent_decided) {
          // Decision rendue → modal verdict
          setDerogPending(null)
          setDerogResult({
            decision:   j.recent_decided.status,
            new_amount: j.recent_decided.new_amount ?? null,
            note:       j.recent_decided.decision_note ?? null,
          })
        }
      } catch {}
    }
    const id = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [derogPending?.id, M.id])
  const submitDerogation = async () => {
    const motive = derogMotive.trim()
    if (motive.length < 5) { setErr('Motif trop court'); return }
    setDerogSubmitting(true); setErr('')
    try {
      // Si une demande pending existe deja → PATCH (modifier le motif).
      // Sinon → POST (nouvelle demande).
      const method = derogPending ? 'PATCH' : 'POST'
      const r = await fetch(`/api/missions/${M.id}/payment-derogation`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motive }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setDerogModalOpen(false)
      setDerogMotive('')
      // Re-fetch immediat pour afficher l etat pending
      const r2 = await fetch(`/api/missions/${M.id}/payment-derogation`)
      const j2 = await r2.json()
      setDerogPending(j2.derogation || null)
    } catch (e: any) {
      setErr(e.message || 'Erreur')
    } finally {
      setDerogSubmitting(false)
    }
  }
  const [closeType, setCloseType] = useState<'dsp'|'rem'|'rel'|'dpr'|'park'>(() => (
    isRELMission(init) ? 'rel'
    : isREM(init.mission_type || '') ? 'rem'
    : 'dsp'
  ))
  const [parkDepot, setParkDepot] = useState<VrLoc | null>(null)
  const [closeNote, setCloseNote] = useState('')

  // Motif DPR (Deplacement Pour Rien)
  const [dprMotif,        setDprMotif]        = useState<DprMotifId | ''>('')
  const [dprMotifAutre,   setDprMotifAutre]   = useState('')
  const [showDprMotif,    setShowDprMotif]    = useState(false)
  const [dprFromRem,      setDprFromRem]      = useState(false)  // true si conversion depuis refus REM

  // Signature destinataire (REM uniquement, optionnelle)
  const [destSig,         setDestSig]         = useState('')
  const [showDestSigPad,  setShowDestSigPad]  = useState(false)
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

  // Décharge — flow type → champs dynamiques → signature
  const [dTypeKey, setDTypeKey] = useState<string>('')  // '' = ecran de selection
  const [dMotif, setDMotif] = useState(''); const [dName, setDName] = useState('')
  const [dSig, setDSig]     = useState(''); const [showDSig, setShowDSig] = useState(false)
  const [dPhotos, setDPhotos] = useState<string[]>([])  // urls (apres upload) ou data URLs (temp)
  const [dSchemas, setDSchemas] = useState<DamageSchemaUrls>({})
  const [showSchemaPad, setShowSchemaPad] = useState(false)
  // Catalogue de types : charge depuis l API + Realtime pour propagation immediate
  // des modifs admin. Fallback fige (DISCHARGE_TYPES) si API echoue.
  const [dTypes, setDTypes] = useState<DischargeType[]>(DISCHARGE_TYPES as DischargeType[])
  useEffect(() => {
    let cancelled = false
    const fetchTypes = () => {
      fetch('/api/decharges')
        .then(r => r.json())
        .then(j => { if (!cancelled && j.types) setDTypes(j.types) })
        .catch(() => {})
    }
    fetchTypes()
    // Realtime : INSERT/UPDATE/DELETE sur discharge_types → re-fetch
    const ch = sb.channel('discharge_types-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'discharge_types' }, () => fetchTypes())
      .subscribe()
    return () => { cancelled = true; sb.removeChannel(ch) }
  }, [])
  const getDischarge = (key: string): DischargeType | null =>
    dTypes.find(d => d.key === key) ?? getDischargeFallback(key)
  const resetDischargeForm = () => {
    setDTypeKey(''); setDMotif(''); setDName(''); setDSig(''); setDPhotos([]); setDSchemas({}); setShowDSig(false); setShowSchemaPad(false)
  }

  // Add stop
  const [newStopAddr, setNewStopAddr]   = useState('')
  const [newStopLat, setNewStopLat]     = useState<number|null>(null)
  const [newStopLng, setNewStopLng]     = useState<number|null>(null)
  const [newStopLabel, setNewStopLabel] = useState('')
  // editStopId null = mode creation, sinon id du stop a remplacer dans extra_addresses
  const [editStopId, setEditStopId]     = useState<string|null>(null)

  // VR locations
  const [vrLocs, setVrLocs] = useState<VrLoc[]>([])

  const photoRef = useRef<HTMLInputElement>(null)
  const totPh    = photos.length + photoUrls.length
  const mType    = M.mission_type || ''
  const rem      = isREM(mType)
  const rel      = isRELMission(M)         // REL = relivraison depuis le parc
  const onSite   = !!M.on_site_at
  const loaded   = !!M.loaded_at || M.status === 'delivering' || M.status === 'parked'
  const stops    = [...(M.extra_addresses || [])].sort((a, b) => a.sort_order - b.sort_order)
  // Si dest-final existe déjà dans stops, pas besoin d'ajouter __dest__
  const destFinalInStops = stops.find(s => s.id === 'dest-final')
  const allPoints = [
    ...stops,
    ...(!destFinalInStops && M.destination_address ? [{
      id: '__dest__', type: 'dest',
      label: `Destination${M.destination_name ? ` · ${M.destination_name}` : ''}`,
      address: M.destination_address, lat: null as null, lng: null as null,
      arrived_at: destArrived ? new Date().toISOString() : null as null,
      on_way_at: destOnWay ? new Date().toISOString() : null as null,
      sort_order: stops.length,
    }] : []),
  ]
  const movePoint = (from: number, to: number) => {
    if (to < 0 || to >= allPoints.length) return
    const pts = [...allPoints]
    const [removed] = pts.splice(from, 1)
    pts.splice(to, 0, removed)
    // Inclure la destination comme un vrai stop si elle a été réordonnée
    const newStops = pts.map((p, i) => ({
      id:         p.id === '__dest__' ? crypto.randomUUID() : p.id,
      type:       p.id === '__dest__' ? 'dest' : p.type,
      label:      p.label,
      address:    p.address,
      lat:        p.lat,
      lng:        p.lng,
      arrived_at: p.arrived_at,
      sort_order: i,
    }))
    // La nouvelle destination = dernier stop de type dest, sinon conserver l'ancienne
    const lastDest = [...newStops].reverse().find(s => s.type === 'dest')
    setM(prev => ({
      ...prev,
      extra_addresses: newStops,
      destination_address: lastDest?.address ?? prev.destination_address,
    }))
    apiSilent('update_stops', { stops: newStops })
  }
  // REL override : si c est une relivraison, on affiche le badge REL (violet)
  // plutot que REM (bleu), meme si techniquement c est mission_type='remorquage'.
  const [tbl, tbg] = rel ? TYPE_BADGE.REL : (TYPE_BADGE[mType] || ['AUT', 'bg-ink-faint'])
  const statusStr  = M.status === 'parked' ? 'En dépôt' : M.on_site_at ? 'Sur place'
    : M.on_way_at && M.status === 'in_progress' ? 'En route' : STATUS_BADGE[M.status]?.[0] || M.status
  const statusBg   = M.status === 'parked' ? 'bg-amber-600' : M.on_site_at ? 'bg-orange-500'
    : M.on_way_at && M.status === 'in_progress' ? 'bg-amber-500' : STATUS_BADGE[M.status]?.[1] || 'bg-ink-faint'

  // Google Maps
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; if (!key || document.getElementById('gm-v4')) return
    const s = document.createElement('script'); s.id = 'gm-v4'
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&language=fr`
    document.head.appendChild(s)
  }, [])

  // VR locations
  useEffect(() => {
    // Liste des dépôts physiques où le chauffeur peut déposer un véhicule.
    // /api/depots = dépôts Verviers Dépannage (Pépinster par défaut, Aywaille, etc.).
    fetch('/api/depots').then(r => r.json()).then(d => setVrLocs(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // ⚠ Plus d'auto-accept : le chauffeur doit cliquer "Accepter la mission" en bas.
  // Ouvrir la fiche n'engage pas le chauffeur (il peut consulter avant de prendre).

  // Mission retiree au chauffeur (assigned_to passe a un autre user ou null)
  const [unassignedModal, setUnassignedModal] = useState(false)

  // Realtime subscription
  useEffect(() => {
    const ch = sb.channel(`mission-v4-${M.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'incoming_missions', filter: `id=eq.${M.id}` },
        payload => {
          const next = payload.new as Partial<Mission> & { assigned_to?: string | null }
          // Si la mission est retiree (assigned_to change pour quelqu un d autre
          // ou devient null) le chauffeur doit etre prevenu et rebascule
          // sur la liste de ses missions.
          if (currentUserId && next.assigned_to !== undefined && next.assigned_to !== currentUserId) {
            setUnassignedModal(true)
            return
          }
          setM(prev => ({ ...prev, ...next }))
        })
      // Derogation : si le dispatcheur decide, le row passe de pending a une
      // decision. Le chauffeur voit une modal explicite avec le verdict + OK
      // qui force le reload pour repartir d un etat sain.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_derogations', filter: `mission_id=eq.${M.id}` },
        (payload: any) => {
          const row = payload.new
          if (!row) return
          if (row.status === 'pending') {
            // Nouveau pending (cas rare : autre device meme chauffeur) → fetch
            fetch(`/api/missions/${M.id}/payment-derogation`)
              .then(r => r.json())
              .then(j => setDerogPending(j.derogation || null))
              .catch(() => {})
          } else {
            // Decision rendue → modal pour le chauffeur
            setDerogPending(null)
            setDerogResult({
              decision:   row.status,
              new_amount: row.new_amount ?? null,
              note:       row.decision_note ?? null,
            })
          }
        })
      .subscribe()
    return () => { sb.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [M.id])

  // ── API statuts simples (avec reload) ───────────────────────────────────
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

  // ── API silencieuse (sans reload — pour réordonnement) ───────────────────
  const apiSilent = async (action: string, extra = {}) => {
    try {
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: M.id, action, ...extra }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setM(j.mission)
    } catch (e: any) { setErr(e.message || 'Erreur') }
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

  // ── Capacitor Camera : prise de photos continue + galerie multi ───────────
  // Sur iOS natif, l input <type=file> ouvre un picker systeme limite (1 action a
  // la fois). Capacitor permet : (1) prendre N photos d affilee sans repasser
  // par le menu, (2) selection multi dans la galerie en un coup.
  // Detect Capacitor, fallback au input file si web.
  const [isCapacitor, setIsCapacitor] = useState(false)
  useEffect(() => {
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        setIsCapacitor(Capacitor.isNativePlatform())
      } catch {}
    })()
  }, [])
  const dataUrlToFile = (dataUrl: string, name: string): File => {
    const [meta, b64] = dataUrl.split(',')
    const mime = meta.match(/data:(.*?);base64/)?.[1] || 'image/jpeg'
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return new File([arr], name, { type: mime })
  }
  const capCameraLoop = async () => {
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      // Boucle "prendre photo, valider, prendre encore" :
      // Camera.getPhoto bloque jusqu a ce que l user valide / annule. On reboucle.
      while (true) {
        try {
          const photo = await Camera.getPhoto({
            source:        CameraSource.Camera,
            resultType:    CameraResultType.DataUrl,
            quality:       80,
            saveToGallery: false,
            allowEditing:  false,
          })
          if (!photo.dataUrl) break
          const file = dataUrlToFile(photo.dataUrl, `cam-${Date.now()}.jpg`)
          setPhotos(p => [...p, file])
          setPreviews(p => [...p, photo.dataUrl!])
        } catch {
          // Annule = sortie de la boucle
          break
        }
      }
    } catch (e: any) {
      setErr(`Camera : ${e.message || 'erreur'}`)
    }
  }
  const capPickGallery = async () => {
    try {
      const { Camera } = await import('@capacitor/camera')
      const result = await Camera.pickImages({ quality: 80, limit: 20 })
      if (!result.photos || result.photos.length === 0) return
      // pickImages renvoie webPath (file:// ou blob://) → fetch + convert en File
      for (const p of result.photos) {
        try {
          const res = await fetch(p.webPath)
          const blob = await res.blob()
          const file = new File([blob], `pick-${Date.now()}.${p.format || 'jpg'}`, { type: blob.type || 'image/jpeg' })
          const reader = new FileReader()
          await new Promise<void>((resolve) => {
            reader.onload = e => {
              setPhotos(prev => [...prev, file])
              setPreviews(prev => [...prev, e.target?.result as string])
              resolve()
            }
            reader.readAsDataURL(file)
          })
        } catch {}
      }
    } catch (e: any) {
      setErr(`Galerie : ${e.message || 'erreur'}`)
    }
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

  // ── Ajouter / modifier stop ───────────────────────────────────────────────
  const saveStop = async () => {
    if (!newStopAddr) return
    let nextStops: Stop[]
    if (editStopId) {
      // Mode edition : remplace l'entree existante en gardant id/sort/arrived
      nextStops = stops.map(s => s.id === editStopId
        ? { ...s, label: newStopLabel || newStopAddr, address: newStopAddr, lat: newStopLat, lng: newStopLng }
        : s
      )
    } else {
      const newStop: Stop = {
        id: crypto.randomUUID(), type: 'custom', label: newStopLabel || newStopAddr,
        address: newStopAddr, lat: newStopLat, lng: newStopLng, arrived_at: null, sort_order: stops.length,
      }
      nextStops = [...stops, newStop]
    }
    setLoading(true)
    try {
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: M.id, action: 'update_stops', stops: nextStops }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setM(j.mission); setScreen('main')
      setNewStopAddr(''); setNewStopLabel(''); setNewStopLat(null); setNewStopLng(null); setEditStopId(null)
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
      clearDraft()
      // Mission terminée pour le chauffeur (le dispatcher reprend la main pour la REL).
      // On redirige vers la liste des missions plutôt que de recharger la fiche.
      window.location.href = '/mission'
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
      // DPR exige toujours un motif (modal ouverte avant le passage en closeType='dpr').
      if (closeType === 'dpr' && !dprMotif) {
        setErr('Motif DPR requis'); setLoading(false); return
      }
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_id: M.id, action: 'completed',
          closing_data: {
            final_mission_type:    closeType.toUpperCase(),
            photo_urls:            allUrls.length ? allUrls : undefined,
            closing_notes:         closeNote || undefined,
            signature:             sig || undefined,
            recipient_signature:   destSig || undefined,            // REM : signature destinataire
            discharge_data:        disch.length > 0 ? disch : undefined,
            dpr_motif:             closeType === 'dpr' ? dprMotif : undefined,
            dpr_motif_label:       closeType === 'dpr' ? (
              dprMotif === 'autre'
                ? dprMotifAutre.trim()
                : DPR_MOTIFS.find(m => m.id === dprMotif)?.label
            ) : undefined,
            dpr_converted_from_rem: dprFromRem || undefined,
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
    dsp:  ['bg-green-600',  'DSP Réussi'],
    rem:  ['bg-blue-600',   'REM Confirmé'],
    rel:  ['bg-purple-600', 'REL Livrée'],
    dpr:  ['bg-ink-faint',  'DPR — Déplacement pour rien'],
    park: ['bg-amber-500',  '🅿️ Mise en parc'],
  }
  const [closeBg, closeLabel] = closeLabels[closeType] || ['bg-ink-faint', closeType.toUpperCase()]

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
      // Auto-retour sur l'ecran d'origine apres save (ex: close si on venait
      // du resume de cloture). Plus besoin de cliquer Retour manuellement.
      setScreen(photosFrom)
    } catch (e: any) { setErr(e.message || 'Erreur sauvegarde'); setLoading(false) }
  }

  // ── Photos (wizard guidé par catégorie) ───────────────────────────────────
  if (screen === 'photos') {
    // Catégories suggérées au chauffeur. Le compteur n'est pas tagué côté DB
    // (pas de migration nécessaire) — c'est un guide visuel pour qu'il pense à
    // toutes les vues importantes. Le seuil "couverte" = au moins 1 photo prise
    // après ouverture de la catégorie (via le state local catPhotos).
    const PHOTO_CATS: Array<{ id: string; icon: string; label: string; hint: string; required?: boolean }> = [
      { id: 'plaque',    icon: '🔢', label: 'Plaque',         hint: 'Lisible en gros plan',                  required: true },
      { id: 'avant',     icon: '⬆️', label: 'Avant',          hint: 'Vue 3/4 côté conducteur idéalement',    required: true },
      { id: 'arriere',   icon: '⬇️', label: 'Arrière',        hint: 'Vue 3/4 côté conducteur idéalement',    required: true },
      { id: 'gauche',    icon: '⬅️', label: 'Côté gauche',    hint: 'Vue latérale complète' },
      { id: 'droite',    icon: '➡️', label: 'Côté droit',     hint: 'Vue latérale complète' },
      { id: 'interieur', icon: '🪑', label: 'Intérieur',      hint: 'Tableau de bord + état général' },
      { id: 'defauts',   icon: '⚠️', label: 'Défauts/dégâts', hint: 'Rayures, bosses, cassures (si applicable)' },
      { id: 'vin',       icon: '🆔', label: 'VIN',            hint: 'Numéro de châssis (si visible)' },
      { id: 'km',        icon: '🔢', label: 'Kilométrage',    hint: 'Compteur lisible (si accessible)' },
    ]
    // Catégories couvertes : persistées en BDD via photo_categories_covered
    // pour partage cross-device (PC ↔ iPhone ↔ wrapper). Fallback localStorage
    // pour edge cases avant que la mission soit refresh.
    const lsKey = `photo-cats-${M.id}`
    const coveredFromDb: string[] = Array.isArray(M.photo_categories_covered)
      ? M.photo_categories_covered : []
    const coveredFromLs: string[] = (() => {
      try { return JSON.parse(localStorage.getItem(lsKey) || '[]') } catch { return [] }
    })()
    const coveredCats: string[] = Array.from(new Set([...coveredFromDb, ...coveredFromLs]))

    const markCovered = (catId: string) => {
      // Update local immediat (visuel) puis sync BDD en arriere-plan.
      const next = Array.from(new Set([...coveredCats, catId]))
      localStorage.setItem(lsKey, JSON.stringify(next))
      setM(prev => ({ ...prev, photo_categories_covered: next }))
      // Persistance BDD multi-device (best effort, ne bloque pas l UX).
      fetch('/api/missions/driver-action', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: M.id, action: 'mark_photo_category', category: catId }),
      }).catch(e => console.error('[mark_photo_category]', e))
    }
    const requiredCats = PHOTO_CATS.filter(c => c.required).map(c => c.id)
    const allRequiredDone = requiredCats.every(id => coveredCats.includes(id))

    return (
      <ScreenWrap title="Photos" sub={`${totPh} photo${totPh !== 1 ? 's' : ''} · ${coveredCats.length}/${PHOTO_CATS.length} angles couverts`} back={() => setScreen(photosFrom)}>
        <input ref={photoRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => {
            // La catégorie cliquée a été stockée dans data-cat sur le button
            const cat = (photoRef.current as any)?.dataset?.cat
            if (cat) markCovered(cat)
            addPhotos(e.target.files)
          }} />

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {/* Aperçu des photos déjà prises */}
          {previews.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {photoUrls.map((url, i) => (
                <div key={`u${i}`} className="relative aspect-square rounded-xl overflow-hidden">
                  <img src={url} className="w-full h-full object-cover" />
                  <div className="absolute bottom-0 left-0 right-0 bg-green-600/70 text-ink text-xs text-center">✓</div>
                  <button onClick={async () => {
                    const newUrls = photoUrls.filter((_, j) => j !== i)
                    setPhotoUrls(newUrls); setPreviews(p => p.filter((_, j) => j !== i))
                    saveDraft({ photoUrls: newUrls })
                    await fetch('/api/missions/driver-action', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ mission_id: M.id, action: 'save_photos', photo_urls: newUrls }),
                    }).catch(() => {})
                  }} className="absolute top-1 right-1 w-6 h-6 bg-black/70 rounded-full text-ink text-xs flex items-center justify-center">✕</button>
                </div>
              ))}
              {previews.slice(photoUrls.length).map((src, i) => (
                <div key={`f${i}`} className="relative aspect-square rounded-xl overflow-hidden">
                  <img src={src} className="w-full h-full object-cover" />
                  <div className="absolute bottom-0 left-0 right-0 bg-amber-500/70 text-ink text-xs text-center">non sauv.</div>
                  <button onClick={() => { setPhotos(p => p.filter((_, j) => j !== i)); setPreviews(p => p.filter((_, j) => j !== i + photoUrls.length)) }}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-ink text-xs flex items-center justify-center">✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Wizard : carte par catégorie */}
          <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-2">Que photographier ?</p>
          <div className="grid grid-cols-2 gap-2">
            {PHOTO_CATS.map(cat => {
              const done = coveredCats.includes(cat.id)
              return (
                <button key={cat.id}
                  onClick={() => {
                    if (isCapacitor) {
                      markCovered(cat.id)
                      capCameraLoop()
                    } else {
                      if (photoRef.current) (photoRef.current as any).dataset.cat = cat.id
                      photoRef.current?.click()
                    }
                  }}
                  className={`relative p-3 rounded-2xl border text-left transition active:scale-95 ${
                    done ? 'bg-green-500/10 border-green-500/40' :
                    cat.required ? 'bg-red-500/5 border-red-500/30 hover:border-red-500/60'
                                 : 'bg-surface border hover:border-zinc-600'
                  }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xl">{cat.icon}</span>
                    {done && <span className="text-green-400 text-xs">✓</span>}
                    {!done && cat.required && <span className="text-red-400 text-[10px] font-bold">REQUIS</span>}
                  </div>
                  <p className={`font-semibold text-sm ${done ? 'text-green-300' : 'text-ink'}`}>{cat.label}</p>
                  <p className="text-ink-muted text-[11px] mt-0.5 leading-tight">{cat.hint}</p>
                </button>
              )
            })}
          </div>

          {/* Catégorie libre / photo générique */}
          {isCapacitor ? (
            // App native : 2 boutons distincts pour exploiter Camera (loop) et
            // pickImages (galerie multi) — UX bien plus rapide que <input type=file>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                onClick={() => { markCovered('autre'); capCameraLoop() }}
                className="py-3 border-2 border-dashed border hover:border-zinc-500 rounded-2xl text-ink-secondary text-sm flex items-center justify-center gap-1.5">
                📷 Caméra
              </button>
              <button
                onClick={() => { markCovered('autre'); capPickGallery() }}
                className="py-3 border-2 border-dashed border hover:border-zinc-500 rounded-2xl text-ink-secondary text-sm flex items-center justify-center gap-1.5">
                🖼️ Galerie
              </button>
            </div>
          ) : (
            <button onClick={() => {
                if (photoRef.current) (photoRef.current as any).dataset.cat = 'autre'
                photoRef.current?.click()
              }}
              className="w-full mt-3 py-3 border-2 border-dashed border hover:border-zinc-500 rounded-2xl text-ink-secondary text-sm">
              + Autre photo (libre)
            </button>
          )}

          {!allRequiredDone && (
            <p className="text-amber-400 text-xs bg-amber-500/10 rounded-xl px-3 py-2 mt-2">
              ⚠ {requiredCats.filter(id => !coveredCats.includes(id)).length} angle(s) requis manquant(s)
            </p>
          )}
          {err && <p className="text-red-400 text-sm mt-3">⚠️ {err}</p>}
        </div>
        <div className="px-4 py-4 border-t border space-y-2">
          {photos.length > 0 && (
            <button onClick={savePhotos} disabled={loading}
              className="w-full py-3.5 bg-green-600 disabled:opacity-50 text-ink font-bold rounded-2xl">
              {loading ? '⏳ Sauvegarde…' : `💾 Enregistrer ${photos.length} nouvelle${photos.length > 1 ? 's' : ''}`}
            </button>
          )}
          {photos.length === 0 && (
            <button onClick={() => setScreen(photosFrom)} className="w-full py-3.5 bg-surface-hover text-ink-secondary font-semibold rounded-2xl">← Retour</button>
          )}
        </div>
      </ScreenWrap>
    )
  }

  // ── Décharge ──────────────────────────────────────────────────────────────
  if (screen === 'decharge') {
    const selectedType = dTypeKey ? getDischarge(dTypeKey) : null

    // Plein ecran : pad de dessin schema de degats
    if (showSchemaPad) {
      return (
        <DamageSchemaPad
          initial={dSchemas}
          onSave={(urls) => { setDSchemas(urls); setShowSchemaPad(false) }}
          onCancel={() => setShowSchemaPad(false)}
        />
      )
    }

    // Etape 1 : selection du type (pas encore de type choisi)
    if (!selectedType) {
      return (
        <ScreenWrap title="Choisir une décharge" back={() => { resetDischargeForm(); setScreen(dischFrom) }}>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-1">Type de décharge</p>
            {dTypes.map(t => (
              <button key={t.key} onClick={() => setDTypeKey(t.key)}
                className={`w-full text-left p-3 rounded-2xl border transition active:scale-[0.99] ${
                  t.color === 'green'
                    ? 'bg-green-500/5 border-green-500/30 hover:border-green-500/60'
                    : 'bg-surface border hover:border-zinc-500'
                }`}>
                <p className={`font-semibold text-sm ${t.color === 'green' ? 'text-green-300' : 'text-ink'}`}>{t.label}</p>
                <p className="text-ink-muted text-xs mt-0.5 line-clamp-2">{t.body.split('\n')[0]}</p>
              </button>
            ))}
          </div>
        </ScreenWrap>
      )
    }

    // Etape 2 : saisie + signature pour le type selectionne
    return (
      <ScreenWrap title={selectedType.label} sub="Décharge à faire signer" back={() => setDTypeKey('')}>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Titre formel + texte juridique en lecture seule */}
          <div className={`rounded-2xl p-4 border ${selectedType.color === 'green' ? 'bg-green-500/5 border-green-500/30' : 'bg-red-500/5 border-red-500/30'}`}>
            <p className={`font-bold text-sm uppercase tracking-wide mb-2 ${selectedType.color === 'green' ? 'text-green-300' : 'text-red-400'}`}>
              {selectedType.title}
            </p>
            <p className="text-ink text-sm whitespace-pre-wrap leading-relaxed">{selectedType.body}</p>
            {selectedType.footnote && (
              <p className="text-ink-muted text-xs italic mt-3">⚠ {selectedType.footnote}</p>
            )}
          </div>

          {/* Commentaire si requis */}
          {selectedType.needsComment && (
            <div>
              <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-2">
                {selectedType.commentLabel || 'Commentaire'} *
              </p>
              <textarea rows={3} value={dMotif} onChange={e => setDMotif(e.target.value)}
                placeholder={selectedType.commentLabel || 'Détails…'}
                className="w-full bg-surface border border focus:border-brand rounded-xl px-3 py-3 text-ink text-sm outline-none resize-none" />
            </div>
          )}

          {/* Schéma de dégâts si requis */}
          {selectedType.needsSchema && (
            <div>
              <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-2">Schéma de dégâts</p>
              {Object.values(dSchemas).filter(Boolean).length > 0 ? (
                <div className="grid grid-cols-4 gap-1.5 mb-2">
                  {(['front','back','left','right'] as const).map(v => (
                    <div key={v} className="aspect-[5/3] bg-white border rounded-lg overflow-hidden flex items-center justify-center">
                      {dSchemas[v]
                        ? <img src={dSchemas[v]} className="w-full h-full object-contain" alt={v} />
                        : <span className="text-ink-faint text-[10px]">—</span>}
                    </div>
                  ))}
                </div>
              ) : null}
              <button onClick={() => setShowSchemaPad(true)}
                className="w-full py-3 border-2 border-dashed border rounded-2xl text-ink-secondary text-sm">
                {Object.values(dSchemas).filter(Boolean).length > 0 ? '✏️ Modifier le schéma' : '📐 Dessiner le schéma'}
              </button>
            </div>
          )}

          {/* Photos si requises */}
          {selectedType.needsPhotos && (
            <div>
              <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-2">
                Photos {selectedType.photosHint && <span className="text-ink-faint normal-case">— {selectedType.photosHint}</span>}
              </p>
              {dPhotos.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {dPhotos.map((p, i) => (
                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                      <img src={p} className="w-full h-full object-cover" />
                      <button onClick={() => setDPhotos(arr => arr.filter((_, j) => j !== i))}
                        className="absolute top-1 right-1 w-6 h-6 bg-black/70 rounded-full text-ink text-xs flex items-center justify-center">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={async () => {
                if (isCapacitor) {
                  try {
                    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
                    while (true) {
                      try {
                        const photo = await Camera.getPhoto({
                          source: CameraSource.Camera, resultType: CameraResultType.DataUrl,
                          quality: 80, saveToGallery: false, allowEditing: false,
                        })
                        if (!photo.dataUrl) break
                        setDPhotos(prev => [...prev, photo.dataUrl!])
                      } catch { break }
                    }
                  } catch (e: any) { setErr(`Camera : ${e.message || 'erreur'}`) }
                } else {
                  // Web fallback : input file
                  const input = document.createElement('input')
                  input.type = 'file'; input.accept = 'image/*'; input.multiple = true
                  input.onchange = () => {
                    if (!input.files) return
                    Array.from(input.files).forEach(f => {
                      const r = new FileReader()
                      r.onload = e => setDPhotos(prev => [...prev, e.target?.result as string])
                      r.readAsDataURL(f)
                    })
                  }
                  input.click()
                }
              }} className="w-full py-3 border-2 border-dashed border rounded-2xl text-ink-secondary text-sm">
                📷 Ajouter des photos
              </button>
            </div>
          )}

          {/* Nom du signataire */}
          <div>
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-2">
              {selectedType.nameFieldLabel || 'Nom du signataire'}
            </p>
            <input value={dName} onChange={e => setDName(e.target.value)} placeholder="Prénom Nom"
              className="w-full bg-surface border border focus:border-brand rounded-xl px-3 py-3 text-ink text-sm outline-none" />
          </div>

          {/* Signature */}
          <div>
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-2">Signature *</p>
            {!dSig ? (showDSig
              ? <SigPad onSave={d => { setDSig(d); setShowDSig(false) }} />
              : <button onClick={() => setShowDSig(true)} className="w-full py-3 border border-dashed border rounded-xl text-ink-secondary text-sm">✍️ Faire signer</button>)
              : <div><div className="border border-green-500/30 rounded-xl overflow-hidden bg-surface mb-2"><img src={dSig} className="w-full max-h-20 object-contain" /></div>
                  <button onClick={() => setDSig('')} className="text-ink-muted text-xs">Refaire</button></div>}
          </div>
        </div>

        <div className="px-4 py-4 border-t border flex gap-3">
          <button onClick={() => { resetDischargeForm(); setScreen(dischFrom) }}
            className="flex-1 py-3 bg-surface-hover text-ink-secondary rounded-2xl text-sm">Annuler</button>
          <button
            onClick={() => {
              if (!dSig) { setErr('Signature requise'); return }
              if (selectedType.needsComment && !dMotif.trim()) { setErr('Commentaire requis'); return }
              const entry: DischargeEntry = {
                type_key:    selectedType.key,
                motif:       dMotif.trim() || undefined,
                name:        dName.trim() || undefined,
                sig:         dSig,
                photo_urls:  dPhotos.length > 0 ? dPhotos : undefined,
                schema_urls: Object.values(dSchemas).filter(Boolean).length > 0 ? dSchemas : undefined,
                created_at:  new Date().toISOString(),
              }
              const updated = [...disch, entry]
              setDisch(updated); saveDraft({ disch: updated })
              resetDischargeForm(); setErr('')
              setScreen(dischFrom)
            }}
            disabled={!dSig || (selectedType.needsComment && !dMotif.trim())}
            className={`flex-1 py-3 disabled:opacity-40 text-ink font-semibold rounded-2xl text-sm ${selectedType.color === 'green' ? 'bg-green-600' : 'bg-amber-600'}`}>
            Enregistrer
          </button>
        </div>
        {err && <p className="text-red-400 text-xs px-4 pb-2">⚠️ {err}</p>}
      </ScreenWrap>
    )
  }

  // ── Signature ─────────────────────────────────────────────────────────────
  if (screen === 'sig') return (
    <ScreenWrap title="Signature client" back={() => setScreen('close')}>
      <div className="flex-1 px-4 py-4">
        {sig ? (
          <div>
            <div className="border border-green-500/30 rounded-xl overflow-hidden bg-surface mb-3"><img src={sig} className="w-full max-h-36 object-contain" /></div>
            <p className="text-green-400 text-sm text-center mb-4">✅ Signature enregistrée</p>
            <button onClick={() => setSig('')} className="w-full py-3 bg-surface-hover text-ink-secondary rounded-xl text-sm">Refaire</button>
          </div>
        ) : <SigPad onSave={d => { setSig(d); saveDraft({ sig: d }) }} />}
      </div>
      {sig && <div className="px-4 py-4 border-t border">
        <button onClick={() => setScreen('close')} className="w-full py-3.5 bg-brand text-white font-semibold rounded-2xl">← Retour</button>
      </div>}
    </ScreenWrap>
  )

  // ── Encaissement ──────────────────────────────────────────────────────────
  if (screen === 'encaissement') return (
    <ScreenWrap title="Encaisser le paiement" back={() => setScreen('main')}>
      <div className="flex-1 px-4 py-4 space-y-4">
        <div className="bg-brand rounded-2xl p-6 text-center">
          <p className="text-ink/70 text-sm mb-1">Montant à encaisser</p>
          <p className="text-ink text-4xl font-semibold">{formatEur(M.amount_to_collect || 0)}</p>
        </div>
        {paidEffective
          ? (isToInvoice
              ? <div className="bg-amber-600/20 border border-amber-500/30 rounded-2xl p-4 text-center"><p className="text-amber-400 font-semibold">📄 Facture à envoyer</p></div>
              : <div className="bg-green-600/20 border border-green-500/30 rounded-2xl p-4 text-center"><p className="text-green-400 font-semibold">✅ Payée</p></div>)
          : <a href={`/encaissement?prefill_mission_id=${M.id}&prefill_plate=${plate(M.vehicle_plate || '')}&prefill_brand=${M.vehicle_brand || ''}&prefill_model=${M.vehicle_model || ''}&prefill_amount=${Math.max(0, requiredAmount - (M.payment_amount ?? 0))}&return_to=/mission/${M.id}`} onClick={() => setTimeout(() => setPaid(true), 3000)} className="w-full flex items-center justify-center py-4 bg-brand text-white font-semibold rounded-2xl">💳 Ouvrir l'encaissement</a>}
      </div>
      <div className="px-4 py-4 border-t border">
        <button onClick={() => setScreen('main')} className="w-full py-3 bg-surface-hover text-ink-secondary rounded-2xl text-sm">← Retour</button>
      </div>
    </ScreenWrap>
  )

  // ── Ajouter / modifier stop ───────────────────────────────────────────────
  if (screen === 'add-stop') return (
    <ScreenWrap title={editStopId ? 'Modifier le stop' : 'Ajouter un stop'} back={() => { setScreen('main'); setEditStopId(null); setNewStopAddr(''); setNewStopLabel(''); setNewStopLat(null); setNewStopLng(null) }}>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-2">Label <span className="text-ink-faint normal-case">(optionnel)</span></p>
          <input value={newStopLabel} onChange={e => setNewStopLabel(e.target.value)} placeholder="Garage, domicile client…"
            className="w-full bg-surface border border focus:border-brand rounded-xl px-3 py-3 text-ink text-sm outline-none" />
        </div>
        <div>
          <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-2">Adresse *</p>
          <AddrInput value={newStopAddr} onChange={setNewStopAddr} onPick={(a, lat, lng) => { setNewStopAddr(a); setNewStopLat(lat); setNewStopLng(lng) }} />
        </div>
        {err && <p className="text-red-400 text-sm">⚠️ {err}</p>}
      </div>
      <div className="px-4 py-4 border-t border flex gap-3">
        <button onClick={() => { setScreen('main'); setEditStopId(null); setNewStopAddr(''); setNewStopLabel(''); setNewStopLat(null); setNewStopLng(null) }} className="flex-1 py-3 bg-surface-hover text-ink-secondary rounded-2xl text-sm">Annuler</button>
        <button onClick={saveStop} disabled={!newStopAddr || loading} className="flex-1 py-3 bg-brand disabled:opacity-40 text-ink font-semibold rounded-2xl text-sm">
          {loading ? '⏳…' : (editStopId ? '✓ Enregistrer' : '+ Ajouter')}
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
      <div className="px-4 py-4 border-t border flex gap-3">
        <button onClick={() => setScreen('main')} className="flex-1 py-3 bg-surface-hover text-ink-secondary rounded-2xl text-sm">Annuler</button>
        <button onClick={saveAddr} disabled={!modVal || loading} className="flex-1 py-3 bg-brand disabled:opacity-40 text-ink font-semibold rounded-2xl text-sm">
          {loading ? '⏳…' : 'Enregistrer'}
        </button>
      </div>
    </ScreenWrap>
  )

  // ── Clôture ───────────────────────────────────────────────────────────────
  if (screen === 'close') return (
      <ScreenWrap title={closeType === 'park' ? 'Mise en parc' : 'Clôturer la mission'} sub={`${M.client_name || ''} · ${plate(M.vehicle_plate)}`} back={() => setScreen('main')}>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {/* Type de clôture — informatif, non modifiable ici */}
          <div className={`${closeBg} rounded-2xl px-4 py-3 flex items-center gap-3`}>
            <span className="text-ink font-bold text-sm">{closeLabel}</span>
          </div>

          {/* Sélection dépôt — uniquement pour Mise en parc */}
          {closeType === 'park' && (
            <div className="bg-surface border border-amber-500/30 rounded-2xl p-4">
              <p className="text-amber-400 text-xs uppercase tracking-widest font-semibold mb-2">Dépôt de dépose</p>
              <div className="space-y-2">
                {vrLocs.length === 0
                  ? <p className="text-ink-faint text-sm">Aucun dépôt configuré — vois /admin/depots</p>
                  : vrLocs.map(vr => {
                      const selected = parkDepot?.id === vr.id
                      return (
                        <button key={vr.id} onClick={() => setParkDepot(vr)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition active:scale-95 ${
                            selected ? 'bg-amber-500/15 border border-amber-500/60' : 'bg-surface border border hover:border-zinc-600'
                          }`}>
                          <span className="text-lg">{selected ? '🅿️' : '◯'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-ink text-sm font-medium">{vr.name}{(vr as any).is_default ? ' (défaut)' : ''}</p>
                            <p className="text-ink-muted text-xs truncate">{vr.address}</p>
                          </div>
                        </button>
                      )
                    })}
              </div>
              {M.destination_address && (
                <p className="text-blue-400/80 text-xs mt-3">📍 Adresse de relivraison à enregistrer : {M.destination_address}</p>
              )}
            </div>
          )}

          {/* Récap éditable — chaque ligne cliquable mène à l'écran correspondant */}
          <div className="bg-surface border border rounded-2xl divide-y divide-[#2a2a2a]">
            <div className="px-4 py-3">
              <p className="text-ink-muted text-xs uppercase tracking-widest font-medium">Récapitulatif (cliquer pour modifier)</p>
            </div>

            {/* Véhicule — éditable */}
            <button onClick={() => setShowVeh(true)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition text-left">
              <div className="flex-1 min-w-0">
                <p className="text-ink-muted text-xs">Véhicule</p>
                <p className="text-ink text-sm font-medium truncate">
                  {[M.vehicle_brand, M.vehicle_model].filter(Boolean).join(' ') || '—'} · {plate(M.vehicle_plate)}
                </p>
              </div>
              <span className="text-blue-400 text-xs flex-shrink-0">✏️</span>
            </button>

            {/* Itinéraire complet : prise en charge → stops → destination (dernière) */}
            <div className="px-4 py-3 space-y-1.5">
              <p className="text-ink-muted text-xs">📍 Itinéraire</p>
              <p className="text-ink text-sm flex items-start gap-1.5">
                <span className="text-amber-400 flex-shrink-0">⏺</span>
                <span>{M.incident_address || '—'}{M.incident_city ? `, ${M.incident_city}` : ''}</span>
              </p>
              {rem && allPoints.map((p, idx) => {
                const isLast = idx === allPoints.length - 1
                return (
                  <p key={p.id} className="text-ink text-sm flex items-start gap-1.5">
                    <span className={`flex-shrink-0 ${isLast ? 'text-blue-400' : 'text-ink-muted'}`}>{isLast ? '🏁' : '▸'}</span>
                    <span>
                      {p.label && p.label !== p.address ? <span className="text-ink-secondary">{p.label} — </span> : null}
                      {p.address}
                      {isLast && <span className="text-blue-400 text-xs ml-1">(destination)</span>}
                    </span>
                  </p>
                )
              })}
            </div>

            {/* Photos */}
            <button onClick={() => goPhotos('close')}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition text-left">
              <span className="text-ink-secondary text-sm">📷 Photos</span>
              <span className="flex items-center gap-2">
                <span className={`text-sm font-medium ${totPh >= 3 ? 'text-green-400' : closeType === 'dpr' ? 'text-ink-muted' : 'text-red-400'}`}>
                  {totPh} {totPh >= 3 ? '✓' : closeType === 'dpr' ? '(opt.)' : '/ 3 min.'}
                </span>
                <span className="text-blue-400 text-xs">→</span>
              </span>
            </button>

            {/* Décharge */}
            <button onClick={() => { resetDischargeForm(); setDischFrom('close'); setScreen('decharge') }}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition text-left">
              <span className="text-ink-secondary text-sm">🛡️ Décharge{disch.length > 1 ? 's' : ''}</span>
              <span className="flex items-center gap-2">
                <span className={`text-sm font-medium ${disch.length > 0 ? 'text-amber-400' : 'text-ink-muted'}`}>
                  {disch.length > 0 ? `✓ ${disch.length}` : '+ ajouter'}
                </span>
                <span className="text-blue-400 text-xs">→</span>
              </span>
            </button>

            {/* Signature client (signée pendant la décharge généralement) */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-ink-secondary text-sm">✍️ Signature client</span>
              <span className={`text-sm font-medium ${sig ? 'text-green-400' : 'text-ink-muted'}`}>{sig ? '✓ Signée' : '—'}</span>
            </div>

            {/* Signature destinataire — REM uniquement, optionnelle */}
            {closeType === 'rem' && (
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-ink-secondary text-sm">✍️ Signature destinataire <span className="text-ink-faint text-xs">(opt.)</span></span>
                  <span className={`text-sm font-medium ${destSig ? 'text-green-400' : 'text-ink-muted'}`}>
                    {destSig ? '✓ Signée' : '—'}
                  </span>
                </div>
                {destSig ? (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 border border-green-500/30 rounded-xl overflow-hidden bg-surface">
                      <img src={destSig} className="w-full max-h-20 object-contain" />
                    </div>
                    <button onClick={() => setDestSig('')} className="text-ink-muted text-xs">Refaire</button>
                  </div>
                ) : showDestSigPad ? (
                  <div className="mt-2">
                    <SigPad onSave={d => { setDestSig(d); setShowDestSigPad(false) }} />
                  </div>
                ) : (
                  <button onClick={() => setShowDestSigPad(true)}
                    className="w-full mt-2 py-2.5 border border-dashed border rounded-xl text-ink-secondary text-sm">
                    ✍️ Faire signer le destinataire
                  </button>
                )}
              </div>
            )}

            {/* Encaissement */}
            {M.amount_to_collect != null && M.amount_to_collect > 0 && (
              <button onClick={() => setScreen('encaissement')}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition text-left">
                <span className="text-ink-secondary text-sm">💶 Encaissement</span>
                <span className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${paidEffective ? (isToInvoice ? 'text-amber-400' : 'text-green-400') : 'text-red-400'}`}>
                    {paidEffective
                      ? (isToInvoice ? '📄 Facture à envoyer' : '✓ Payée')
                      : `${formatEur(M.amount_to_collect, { suffix: false })} ${M.amount_currency || 'EUR'}`}
                  </span>
                  <span className="text-blue-400 text-xs">→</span>
                </span>
              </button>
            )}
          </div>

          {/* Décharge rapide "Fin d'intervention sans dégâts" → pré-sélectionne le type */}
          <button onClick={() => {
              resetDischargeForm()
              setDTypeKey('fin_intervention_sans_degats')
              setDischFrom('close'); setScreen('decharge')
            }} className="w-full flex items-center gap-3 px-4 py-3.5 bg-surface border border-dashed border hover:border-zinc-600 rounded-2xl text-left transition">
            <span className="text-xl">🛡️</span>
            <div className="flex-1">
              <p className="text-ink-secondary text-sm font-medium">+ Ajouter une décharge</p>
              <p className="text-ink-faint text-xs">Sans dégâts ou motif personnalisé</p>
            </div>
          </button>
          {disch.map((d, i) => (
            <div key={i} className="flex items-center gap-3 bg-amber-600/10 border border-amber-600/30 rounded-2xl px-4 py-3">
              <span className="text-xl">{d.type_key && getDischarge(d.type_key)?.color === 'green' ? '✅' : '🛡️'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-amber-400 text-sm font-medium">
                  {d.type_key ? (getDischarge(d.type_key)?.label || 'Décharge') : `Décharge ${i + 1}`}
                </p>
                {(d.motif || d.name) && (
                  <p className="text-ink-muted text-xs truncate">
                    {d.name ? d.name : ''}{d.name && d.motif ? ' · ' : ''}{d.motif ? d.motif.slice(0, 60) : ''}{(d.motif || '').length > 60 ? '…' : ''}
                  </p>
                )}
              </div>
              <button onClick={() => { const u = disch.filter((_, j) => j !== i); setDisch(u); saveDraft({ disch: u }) }} className="text-ink-faint text-xs flex-shrink-0">✕</button>
            </div>
          ))}

          {/* Remarques */}
          <div>
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-2">Remarques <span className="text-ink-faint normal-case tracking-normal">(optionnel)</span></p>
            <textarea rows={3} value={closeNote} onChange={e => setCloseNote(e.target.value)}
              placeholder="Observations, état du véhicule…"
              className="w-full bg-surface border border focus:border-brand rounded-xl px-3 py-3 text-ink text-sm outline-none resize-none" />
          </div>

          {closeType !== 'dpr' && totPh < 3 && (
            <button onClick={() => goPhotos('close')}
              className="w-full flex items-center justify-between bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl px-3 py-3 transition active:scale-95">
              <span className="text-amber-400 text-sm font-medium">⚠️ {3 - totPh} photo(s) manquante(s)</span>
              <span className="text-amber-300 text-xs">📷 Ajouter →</span>
            </button>
          )}
          {err && <p className="text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2">⚠️ {err}</p>}
        </div>

        <div className="px-4 py-4 border-t border">
          {closeType === 'park' ? (
            <button onClick={() => parkDepot && doPark(parkDepot)}
              disabled={loading || !parkDepot || totPh < 3}
              className="w-full py-4 bg-amber-500 disabled:opacity-40 text-ink font-semibold rounded-2xl">
              {loading ? '⏳ Envoi…' : `🅿️ Confirmer la mise en parc${parkDepot ? ` à ${parkDepot.name}` : ''}`}
            </button>
          ) : (
            <>
              {/* Blocage cloture tant que paiement incomplet (sauf DPR : pas de prestation, pas d encaissement attendu) */}
              {closeType !== 'dpr' && !paymentComplete && (
                <p className="text-amber-400 text-xs text-center mb-2 px-2">
                  ⚠ Encaissement incomplet : {formatEur(M.payment_amount ?? 0, { suffix: false })} / {formatEur(requiredAmount, { suffix: false })} {M.amount_currency || 'EUR'}.
                  La clôture est bloquée tant que le total prévu n'est pas atteint (ou utilisez "À facturer").
                </p>
              )}
              <button onClick={doClose} disabled={loading || (closeType !== 'dpr' && (totPh < 3 || !paymentComplete))}
                className="w-full py-4 bg-green-600 disabled:opacity-40 text-ink font-semibold rounded-2xl">
                {loading ? '⏳ Envoi…' : '✅ Confirmer la clôture'}
              </button>
            </>
          )}
        </div>
      </ScreenWrap>
  )

  // ── Mission terminee (to_invoice = cloturee, en attente facturation cote bureau) ──
  if (M.status === 'completed' || M.status === 'to_invoice') return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-4 px-4">
      <div className="w-16 h-16 bg-green-600/20 border border-green-500/30 rounded-full flex items-center justify-center text-3xl">✅</div>
      <h1 className="text-ink font-semibold text-xl">Mission terminée</h1>
      <p className="text-ink-muted text-sm">{M.client_name} · {plate(M.vehicle_plate)}</p>
      <button onClick={() => router.push('/mission')} className="w-full max-w-xs py-3 bg-surface border border text-ink-secondary rounded-2xl text-sm">← Mes missions</button>
    </div>
  )

  // ══════════════════════════════════════════════════════════════════════════
  // VUE PRINCIPALE
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-surface pb-48 relative">
      <AmbientBackground variant="light">

      {/* Header avec backdrop-blur pour fondre avec l'ambient */}
      <div className="bg-surface/85 backdrop-blur-md border-b px-4 pt-12 pb-4 sticky top-0 z-20">
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => router.push('/mission')} className="w-9 h-9 flex items-center justify-center bg-surface-hover rounded-xl text-ink">←</button>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-md text-xs font-bold text-ink ${tbg}`}>{tbl}</span>
            <span className={`px-2.5 py-1 rounded-md text-xs font-medium text-ink ${statusBg}`}>{statusStr}</span>
          </div>
        </div>
        <h1 className="text-ink font-semibold text-lg truncate mt-1">{M.client_name || 'Client inconnu'}</h1>
        {M.client_phone && (
          <a href={`tel:${M.client_phone}`} className="inline-flex items-center gap-1.5 mt-1 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1 text-red-400 text-sm font-medium">
            📞 {M.client_phone}
          </a>
        )}
        {/* Stepper visuel : étapes du workflow chauffeur */}
        <Stepper status={M.status} onSite={onSite} loaded={loaded} isRem={rem} isRel={rel} />
      </div>

      {/* Banderole rouge : montant à encaisser (rien encore OU partiel) */}
      {/* 5 taps caches sur la banderole → modal derogation (briefing vocal) */}
      {M.amount_to_collect != null && M.amount_to_collect > 0 && !paidEffective && (
        <div
          onClick={handleDerogTap}
          className={`relative bg-red-600 border-b-2 border-red-700 px-4 py-3 flex items-center justify-between gap-3 select-none ${derogTapCount >= 3 ? 'animate-pulse' : ''}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-2xl">💶</span>
            <div>
              <p className="text-ink font-bold text-sm uppercase tracking-wide">{partiallyPaid ? 'Reste à encaisser' : 'À encaisser'}</p>
              {partiallyPaid ? (
                <p className="text-ink text-xl font-bold">
                  {formatEur(requiredAmount - (M.payment_amount ?? 0), { suffix: false })} {M.amount_currency || 'EUR'}
                  <span className="text-ink/80 text-xs font-normal ml-2">({formatEur(M.payment_amount ?? 0, { suffix: false })} / {formatEur(requiredAmount, { suffix: false })})</span>
                </p>
              ) : (
                <p className="text-ink text-xl font-bold">{formatEur(M.amount_to_collect, { suffix: false })} {M.amount_currency || 'EUR'}</p>
              )}
            </div>
          </div>
          <button onClick={e => { e.stopPropagation(); setScreen('encaissement') }}
            className="px-3 py-2 bg-white text-red-700 rounded-lg text-xs font-bold whitespace-nowrap">
            Encaisser →
          </button>
          {/* Compteur discret à partir du 3e tap */}
          {derogTapCount >= 3 && derogTapCount < 5 && (
            <span className="absolute bottom-1 right-2 text-[10px] text-ink/70 font-mono">{derogTapCount}/5</span>
          )}
        </div>
      )}

      {/* Bandeau dérogation en attente — double tap = check manuel (fallback realtime) */}
      {derogPending && (
        <div
          onClick={async () => {
            const now = Date.now()
            const last = (window as any).__derogTapTs || 0
            if (now - last < 500) {
              (window as any).__derogTapTs = 0
              // Re-fetch et detecte une eventuelle decision deja prise
              try {
                const r = await fetch(`/api/missions/${M.id}/payment-derogation?latest=1`)
                const j = await r.json()
                if (j.derogation == null) {
                  // Plus rien en pending → soit decision rendue, soit cancelled
                  // Force reload pour re-render proprement (la modal peut ne pas
                  // avoir le contexte si decision rendue avant subscription)
                  window.location.reload()
                }
              } catch {
                window.location.reload()
              }
            } else {
              (window as any).__derogTapTs = now
            }
          }}
          className="bg-warning-soft border-b-2 border-warning px-4 py-3 flex items-center gap-3 select-none cursor-pointer"
        >
          <span className="text-2xl">⏳</span>
          <div className="flex-1 min-w-0">
            <p className="text-warning text-sm font-bold uppercase tracking-wide">Dérogation en attente</p>
            <p className="text-ink text-sm truncate">Motif : <span className="font-medium">{derogPending.motive}</span></p>
            <p className="text-ink-secondary text-xs mt-0.5">↻ Double-tap pour rafraîchir</p>
          </div>
        </div>
      )}

      {/* Modal "Mission retirée" : assigned_to a change, le chauffeur doit revenir a sa liste */}
      {unassignedModal && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center px-6 text-center">
          <div className="bg-surface rounded-3xl p-6 space-y-4 max-w-sm w-full">
            <div className="text-5xl" aria-hidden="true">🛑</div>
            <p className="text-ink font-semibold text-lg">Mission retirée</p>
            <p className="text-ink-secondary text-sm">
              Cette mission ne t'est plus attribuée. Le dispatch l'a réaffectée ou désassignée.
            </p>
            <button
              onClick={() => { window.location.href = '/mission' }}
              className="w-full py-3.5 bg-brand text-white font-semibold rounded-2xl text-sm"
            >
              OK, retour à mes missions
            </button>
          </div>
        </div>
      )}

      {/* Modal "Gestion d'une demande existante" : declenche si 5-taps alors qu une demande est pending */}
      {derogManageOpen && derogPending && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => !derogSubmitting && setDerogManageOpen(false)}>
          <div className="bg-surface w-full rounded-t-3xl p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <div>
              <p className="text-ink font-semibold">⏳ Demande déjà en attente</p>
              <p className="text-ink-muted text-xs mt-0.5">Une demande de dérogation est déjà en attente de validation par le dispatcher pour cette mission.</p>
            </div>
            <div className="bg-warning-soft border border-warning rounded-xl p-3">
              <p className="text-ink-muted text-xs uppercase tracking-wide mb-1">Motif actuel</p>
              <p className="text-ink text-sm whitespace-pre-wrap">{derogPending.motive}</p>
            </div>
            {err && <p className="text-red-400 text-xs">⚠️ {err}</p>}
            <button
              onClick={() => { setDerogManageOpen(false); setDerogMotive(derogPending.motive); setDerogModalOpen(true) }}
              disabled={derogSubmitting}
              className="w-full py-3 bg-brand text-white font-semibold rounded-2xl text-sm">
              ✏️ Modifier le motif
            </button>
            <button
              onClick={cancelDerogation}
              disabled={derogSubmitting}
              className="w-full py-3 bg-critical text-white font-medium rounded-2xl text-sm disabled:opacity-50">
              {derogSubmitting ? '⏳…' : '🗑️ Annuler la demande'}
            </button>
            <button
              onClick={async () => {
                await cancelDerogation()
                setDerogMotive('')
                setDerogModalOpen(true)
              }}
              disabled={derogSubmitting}
              className="w-full py-3 bg-surface-hover text-ink-secondary rounded-2xl text-sm disabled:opacity-50">
              🗑️➕ Annuler + nouvelle demande
            </button>
            <button
              onClick={() => setDerogManageOpen(false)}
              disabled={derogSubmitting}
              className="w-full py-2 text-ink-muted text-xs">
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Modal "Définir un montant à encaisser" (geste 5-taps sur Dossier) */}
      {setAmtModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => !setAmtSubmitting && setSetAmtModalOpen(false)}>
          <div className="bg-surface w-full rounded-t-3xl p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <div>
              <p className="text-ink font-semibold">💶 Montant à encaisser</p>
              <p className="text-ink-muted text-xs mt-0.5">Ajoute ou modifie le montant à percevoir auprès du client. La banderole rouge apparaîtra après validation.</p>
            </div>
            <div>
              <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-1.5">Montant (€)</p>
              <input
                type="number" step="0.01" min={0}
                value={setAmtValue}
                onChange={e => setSetAmtValue(e.target.value)}
                placeholder="0.00"
                autoFocus
                className="w-full bg-surface-hover border border rounded-xl px-3 py-3 text-ink text-2xl font-bold text-center outline-none focus:border-brand"
                disabled={setAmtSubmitting}
              />
            </div>
            {err && <p className="text-red-400 text-xs">⚠️ {err}</p>}
            <div className="flex gap-3">
              <button onClick={() => setSetAmtModalOpen(false)} disabled={setAmtSubmitting}
                className="flex-1 py-3 bg-surface-hover text-ink-secondary rounded-2xl text-sm">Annuler</button>
              <button onClick={submitSetAmount} disabled={setAmtSubmitting || !setAmtValue}
                className="flex-1 py-3 bg-brand disabled:opacity-40 text-white font-semibold rounded-2xl text-sm">
                {setAmtSubmitting ? '⏳…' : 'Valider'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal "Réponse à votre dérogation" : OK = reload */}
      {derogResult && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end">
          <div className="bg-surface w-full rounded-t-3xl p-6 space-y-4">
            <div className="text-center">
              <div className="text-5xl mb-2" aria-hidden="true">
                {derogResult.decision === 'refused' ? '❌' : '✅'}
              </div>
              <p className="text-ink font-semibold text-lg">
                {derogResult.decision === 'cancelled_amount' && 'Dérogation acceptée'}
                {derogResult.decision === 'adjusted'         && 'Montant ajusté'}
                {derogResult.decision === 'refused'          && 'Dérogation refusée'}
              </p>
              <p className="text-ink-secondary text-sm mt-1">
                {derogResult.decision === 'cancelled_amount' && 'Le montant à encaisser a été annulé. Tu peux clôturer la mission.'}
                {derogResult.decision === 'adjusted' && `Nouveau montant à encaisser : ${derogResult.new_amount} €.`}
                {derogResult.decision === 'refused'  && 'Tu dois encaisser le montant total prévu.'}
              </p>
            </div>
            {derogResult.note && (
              <div className="bg-surface-hover rounded-xl p-3">
                <p className="text-ink-muted text-xs uppercase tracking-wide mb-1">Note du dispatch</p>
                <p className="text-ink text-sm whitespace-pre-wrap">{derogResult.note}</p>
              </div>
            )}
            <button
              onClick={() => { setDerogResult(null); window.location.reload() }}
              className="w-full py-3.5 bg-brand text-white font-semibold rounded-2xl text-sm"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Modal saisie motif dérogation */}
      {derogModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => !derogSubmitting && setDerogModalOpen(false)}>
          <div className="bg-surface w-full rounded-t-3xl p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <div>
              <p className="text-ink font-semibold">{derogPending ? '✏️ Modifier la demande de dérogation' : '🆘 Demande de dérogation paiement'}</p>
              <p className="text-ink-muted text-xs mt-0.5">{derogPending ? 'Le motif sera mis à jour. Le dispatcheur verra la nouvelle version.' : 'Le dispatcheur de garde sera notifié. Indique pourquoi le client ne peut/veut pas payer.'}</p>
            </div>
            <textarea
              value={derogMotive}
              onChange={e => setDerogMotive(e.target.value)}
              placeholder="Ex : voiture non démarrée, client refuse paiement, prestation contestée…"
              rows={4}
              className="w-full bg-surface-hover border border rounded-xl p-3 text-ink text-sm outline-none focus:border-brand"
              disabled={derogSubmitting}
            />
            {err && <p className="text-red-400 text-xs">⚠️ {err}</p>}
            <div className="flex gap-3">
              <button onClick={() => setDerogModalOpen(false)} disabled={derogSubmitting}
                className="flex-1 py-3 bg-surface-hover text-ink-secondary rounded-2xl text-sm">Annuler</button>
              <button onClick={submitDerogation} disabled={derogSubmitting || derogMotive.trim().length < 5}
                className="flex-1 py-3 bg-brand disabled:opacity-40 text-white font-semibold rounded-2xl text-sm">
                {derogSubmitting ? '⏳…' : (derogPending ? 'Enregistrer' : 'Envoyer la demande')}
              </button>
            </div>
          </div>
        </div>
      )}
      {paidEffective && M.amount_to_collect != null && M.amount_to_collect > 0 && (
        isToInvoice
          ? <div className="bg-amber-600/15 border-b border-amber-600/30 px-4 py-2 flex items-center gap-2">
              <span className="text-lg">📄</span>
              <p className="text-amber-400 text-sm font-medium">Facture à envoyer : {formatEur(paidAmount || 0, { suffix: false })} {M.amount_currency || 'EUR'}</p>
            </div>
          : <div className="bg-green-600/15 border-b border-green-600/30 px-4 py-2 flex items-center gap-2">
              <span className="text-lg">✅</span>
              <p className="text-green-400 text-sm font-medium">Payée : {formatEur(paidAmount || 0, { suffix: false })} {M.amount_currency || 'EUR'}</p>
            </div>
      )}

      <div className="px-4 py-4 space-y-3">

        {/* Banderole REL — visible uniquement pour les missions de relivraison */}
        {rel && (
          <div className="bg-purple-600/10 border border-purple-500/40 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">🚛</span>
              <p className="text-purple-300 text-sm font-bold uppercase tracking-wide">Mission de relivraison</p>
            </div>
            <p className="text-ink-secondary text-xs mb-3">
              Le véhicule est déjà en parc chez nous (zone TRANSIT). Tu pars du parc avec le véhicule chargé et tu le livres à l'adresse client originale.
            </p>
            {M.parent_mission_id && (
              <a href={`/mission/${M.parent_mission_id}`}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 rounded-lg text-purple-300 font-medium">
                📋 Voir la mission parente (remorquage initial) →
              </a>
            )}
          </div>
        )}

        {/* Facturé à + Dossier */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-surface border border rounded-2xl p-3">
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-1">Facturé à</p>
            <p className="text-ink text-sm font-medium truncate">{M.billed_to_name || M.source || '—'}</p>
          </div>
          <div
            onClick={handleSetAmtTap}
            className={`relative bg-surface border border rounded-2xl p-3 select-none ${setAmtTapCount >= 3 ? 'animate-pulse' : ''}`}
          >
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-1">Dossier</p>
            <p className="text-ink text-xs font-mono truncate">{M.dossier_number || M.external_id || '—'}</p>
            {setAmtTapCount >= 3 && setAmtTapCount < 5 && (
              <span className="absolute bottom-1 right-2 text-[10px] text-ink-muted font-mono">{setAmtTapCount}/5</span>
            )}
          </div>
        </div>

        {/* Description */}
        {M.incident_description && (
          <div className="bg-surface border border rounded-2xl p-4">
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-2">Description</p>
            <p className="text-ink text-sm">{M.incident_description}</p>
          </div>
        )}

        {/* Véhicule */}
        <button onClick={() => setShowVeh(true)} className="w-full bg-surface border border rounded-2xl p-4 text-left hover:border-zinc-600 transition">
          <div className="flex justify-between mb-1">
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium">Véhicule</p>
            <span className="text-red-400 text-xs">✏️ Modifier</span>
          </div>
          <p className="text-ink font-semibold">{[M.vehicle_brand, M.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
          {M.vehicle_plate && <p className="text-ink-secondary text-xs font-mono uppercase tracking-widest mt-1">{plate(M.vehicle_plate)}</p>}
        </button>

        {/* DSP : adresse unique */}
        {!rem && (
          <button onClick={() => setAddrModal({ title: "Lieu d'intervention", address: `${M.incident_address || '—'}${M.incident_city ? `, ${M.incident_city}` : ''}`, lat: M.incident_lat, lng: M.incident_lng, field: 'incident' })}
            className="w-full bg-surface border border rounded-2xl p-4 text-left hover:border-zinc-600 transition">
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-1">Lieu d'intervention</p>
            <p className="text-ink text-sm">{M.incident_address || '—'}{M.incident_city ? `, ${M.incident_city}` : ''}</p>
            <p className="text-blue-400 text-xs mt-1">🗺️ Tap → Naviguer ou Modifier</p>
          </button>
        )}

        {/* REM : itinéraire complet */}
        {rem && (
          <div className="bg-surface border border rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border">
              <p className="text-ink-muted text-xs uppercase tracking-widest font-medium">Itinéraire</p>
              {!isReadOnly && (M.status === 'in_progress' || M.status === 'delivering') && (
                <button onClick={() => setScreen('add-stop')} className="text-xs px-3 py-1.5 bg-brand text-white rounded-lg font-medium">+ Stop</button>
              )}
            </div>

            {/* Prise en charge */}
            <button onClick={() => setAddrModal({ title: 'Prise en charge', address: `${M.incident_address || '—'}${M.incident_city ? `, ${M.incident_city}` : ''}`, lat: M.incident_lat, lng: M.incident_lng, field: 'incident' })}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border hover:bg-surface-2 text-left">
              <div className="w-3 h-3 rounded-full bg-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-ink-muted text-xs">Prise en charge</p>
                <p className="text-ink text-sm truncate">{M.incident_address || '—'}{M.incident_city ? `, ${M.incident_city}` : ''}</p>
              </div>
              <span className="text-blue-400 text-xs flex-shrink-0">→</span>
            </button>

            {/* Stops scrollables */}
            <div className="overflow-y-auto max-h-52">
            {/* Tous les stops + destination — réordonnement ▲▼ */}
            {(() => {
              const canReorder = !isReadOnly && (M.status === 'in_progress' || M.status === 'delivering')
              return allPoints.map((point, idx) => (
                <div key={point.id} className="flex items-center gap-2 px-3 py-3 border-b border last:border-none">
                  {/* Poignée drag + flèches */}
                  {canReorder && !point.arrived_at && (
                    <div className="flex flex-col items-center gap-1 flex-shrink-0 pr-1">
                      <button disabled={idx === 0} onClick={() => movePoint(idx, idx - 1)}
                        className="w-6 h-6 flex items-center justify-center rounded-lg bg-surface-hover text-ink-secondary disabled:opacity-20 active:scale-95 text-xs">▲</button>
                      <div className="text-ink-faint text-xs leading-none select-none">⠿</div>
                      <button disabled={idx === allPoints.length - 1} onClick={() => movePoint(idx, idx + 1)}
                        className="w-6 h-6 flex items-center justify-center rounded-lg bg-surface-hover text-ink-secondary disabled:opacity-20 active:scale-95 text-xs">▼</button>
                    </div>
                  )}
                  <div className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: point.id === '__dest__' ? '#2563eb' : (STOP_COLORS[point.type] || STOP_COLORS.custom) }} />
                  <button className="flex-1 min-w-0 text-left py-1" onClick={() => {
                    if (point.id === '__dest__') {
                      setAddrModal({ title: point.label, address: point.address, field: 'destination' })
                    } else {
                      // field='stop:<id>' → la modal sait deroute vers l'edition stop
                      setAddrModal({ title: point.label, address: point.address, lat: point.lat ?? undefined, lng: point.lng ?? undefined, field: `stop:${point.id}` })
                    }
                  }}>
                    <p className="text-ink-muted text-xs">{point.label}</p>
                    <p className="text-ink text-sm truncate">{point.address}</p>
                    <p className="text-blue-400 text-xs mt-0.5">Tap → Naviguer ou Modifier</p>
                  </button>
                  {canReorder && !point.arrived_at && point.id !== '__dest__' && (
                    <button onClick={() => api('arrive_stop', { stop_id: point.id })} disabled={loading}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-ink rounded-lg flex-shrink-0 disabled:opacity-50">
                      → {idx + 1}
                    </button>
                  )}
                  {point.arrived_at && (
                    <span className="text-xs px-2 py-1 bg-green-600/20 text-green-400 rounded-lg flex-shrink-0">✓</span>
                  )}
                </div>
              ))
            })()}
            </div>{/* end scrollable stops */}
          </div>
        )}

        {/* Remarques */}
        {M.remarks_general && (
          <div className="bg-surface border border rounded-2xl p-4">
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-1">Remarques</p>
            <p className="text-ink text-sm">{M.remarks_general}</p>
          </div>
        )}



        {err && <p className="text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2">⚠️ {err}</p>}
      </div>

      {/* Boutons de pointage */}
      {!isReadOnly && (
        <div className="fixed bottom-0 left-0 right-0 bg-surface/95 backdrop-blur border-t border px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] space-y-2 z-30">

          {M.status === 'assigned' && (
            <>
              <p className="text-ink-secondary text-xs text-center px-2">
                Vérifie les infos avant d'accepter. Une fois acceptée, le dispatch est notifié.
              </p>
              <button onClick={() => api('accept')} disabled={loading}
                className="w-full py-4 bg-blue-600 disabled:opacity-50 text-ink font-bold rounded-2xl text-base">
                {loading ? '⏳…' : '✅ Accepter la mission'}
              </button>
            </>
          )}
          {M.status === 'accepted' && (
            <button onClick={() => initNav ? api('on_way') : setShowNav(true)} disabled={loading}
              className="w-full py-4 bg-amber-500 disabled:opacity-50 text-ink font-bold rounded-2xl text-base">
              {loading ? '⏳…' : (rel ? '🚗 En route vers le parc' : '🚗 En route')}
            </button>
          )}
          {/* "Sur place" : skip pour les REL (on demarre du parc, pas d arrivee a marquer) */}
          {M.status === 'in_progress' && !onSite && !rel && (
            <button onClick={() => api('on_site')} disabled={loading}
              className="w-full py-4 bg-orange-500 disabled:opacity-50 text-ink font-bold rounded-2xl text-base">
              {loading ? '⏳…' : '📍 Sur place'}
            </button>
          )}

          {/* REM : Sur place + véhicule pas encore chargé → bouton "Véhicule chargé" + bouton "Refus" */}
          {rem && !rel && M.status === 'in_progress' && onSite && !loaded && (
            <>
              <button onClick={() => api('load_vehicle')} disabled={loading}
                className="w-full py-4 bg-blue-600 disabled:opacity-50 text-ink font-bold rounded-2xl text-base">
                {loading ? '⏳…' : '🚛 Véhicule chargé sur le camion'}
              </button>
              <button
                onClick={() => { setDprFromRem(true); setDprMotif(''); setDprMotifAutre(''); setShowDprMotif(true) }}
                disabled={loading}
                className="w-full py-3 bg-surface border border hover:border-red-500/60 text-ink-secondary hover:text-red-400 font-medium rounded-2xl text-sm">
                ❌ Refus / Impossible — Convertir en DPR
              </button>
            </>
          )}

          {/* REL : in_progress (peu importe onSite) + non chargé → bouton "Véhicule chargé au parc" */}
          {rel && M.status === 'in_progress' && !loaded && (
            <button onClick={() => api('load_vehicle')} disabled={loading}
              className="w-full py-4 bg-blue-600 disabled:opacity-50 text-ink font-bold rounded-2xl text-base">
              {loading ? '⏳…' : '🚛 Véhicule chargé au parc'}
            </button>
          )}

          {/* REM/REL : véhicule chargé → arrivée à destination (+ mise en parc pour REM uniquement) */}
          {rem && (M.status === 'delivering' || (loaded && M.status === 'in_progress')) && (
            <>
              <button onClick={() => { setCloseType(rel ? 'rel' : 'rem'); setScreen('close') }} disabled={loading}
                className="w-full py-4 bg-green-600 disabled:opacity-50 text-ink font-bold rounded-2xl text-base flex items-center justify-center gap-2">
                📍 Arrivé à destination
                {M.destination_address && (
                  <span className="text-xs opacity-75 font-normal truncate max-w-[140px]">{M.destination_address}</span>
                )}
              </button>
              {/* "Mise en parc" : pour REM seulement (une REL ramène DEPUIS le parc, pas vers) */}
              {!rel && (
                <button onClick={() => {
                    if (!parkDepot) {
                      const def = vrLocs.find(v => (v as any).is_default) || vrLocs[0]
                      if (def) setParkDepot(def)
                    }
                    setCloseType('park')
                    setScreen('close')
                  }} disabled={loading}
                  className="w-full py-4 bg-amber-500 disabled:opacity-50 text-ink font-bold rounded-2xl text-base">
                  🅿️ Mise en parc
                </button>
              )}
            </>
          )}

          {/* DSP : sur place → photos / terminer (pas de chargement) */}
          {!rem && onSite && M.status !== 'completed' && (
            <>
              {totPh < 3 && (
                <button onClick={() => goPhotos('main')}
                  className="w-full py-4 bg-orange-500 text-ink font-bold rounded-2xl text-base flex items-center justify-center gap-2">
                  📷 Photos <span className="text-sm font-normal opacity-75">({totPh}/3)</span>
                </button>
              )}
              {totPh >= 3 && (
                <button onClick={() => { setCloseType('dsp'); setScreen('close') }}
                  className="w-full py-4 bg-green-600 text-ink font-bold rounded-2xl text-base">
                  🏁 Terminer
                </button>
              )}
            </>
          )}

          {/* En parc : la mission est finie pour le chauffeur, plus rien à faire.
              Le dispatcher prendra le relais pour créer la REL si besoin. */}
          {M.status === 'parked' && (
            <div className="w-full py-3 px-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-center">
              <p className="text-amber-400 text-sm font-semibold">🅿️ Véhicule déposé au parc</p>
              <p className="text-amber-300/80 text-xs mt-1">Mission terminée pour toi. Le dispatcher gère la suite.</p>
            </div>
          )}

          {/* Bouton secondaire — Actions (DPR, photos, etc.) toujours accessible quand on est sur place ou plus avancé */}
          {(onSite || M.status === 'parked' || M.status === 'delivering' || loaded) && (
            <button onClick={() => setShowGrid(true)}
              className="w-full py-3 bg-surface border border hover:border-zinc-600 text-ink-secondary hover:text-ink font-medium rounded-2xl text-sm flex items-center justify-center gap-2">
              ☰ Autres actions
            </button>
          )}
        </div>
      )}

      {/* ── Modal Actions ☰ ─────────────────────────────────────────────── */}
      {showGrid && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => setShowGrid(false)}>
          <div className="bg-surface w-full rounded-t-3xl pb-8" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 bg-surface-hover rounded-full" /></div>
            <div className="px-5 pb-3 border-b border flex items-center justify-between">
              <div>
                <p className="text-ink font-semibold">{M.client_name}</p>
                <p className="text-ink-muted text-xs">{[M.vehicle_brand, M.vehicle_model].filter(Boolean).join(' ')} · {plate(M.vehicle_plate)}</p>
              </div>
              <button onClick={() => setShowGrid(false)} className="text-ink-muted text-2xl">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4">
              {/* Photos */}
              <button onClick={() => { setShowGrid(false); goPhotos('main') }}
                className={`relative rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border transition active:scale-95 ${totPh > 0 ? 'bg-green-600/20 border-green-600/40' : 'bg-surface border'}`}>
                <span className="text-2xl">📷</span>
                <span className={`text-sm font-medium ${totPh > 0 ? 'text-green-400' : 'text-ink-secondary'}`}>Photos</span>
                {totPh > 0 && <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-xs font-bold bg-green-500 text-ink">{totPh}</span>}
              </button>
              {/* Décharge */}
              <button onClick={() => { setShowGrid(false); resetDischargeForm(); setDischFrom('main'); setScreen('decharge') }}
                className={`relative rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border transition active:scale-95 ${disch.length > 0 ? 'bg-amber-600/20 border-amber-600/40' : 'bg-surface border'}`}>
                <span className="text-2xl">📋</span>
                <span className={`text-sm font-medium ${disch.length > 0 ? 'text-amber-400' : 'text-ink-secondary'}`}>Décharge</span>
                {disch.length > 0 && <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-ink">{disch.length}</span>}
              </button>
              {/* Encaisser */}
              {M.amount_to_collect != null && M.amount_to_collect > 0 && (
                <button onClick={() => { setShowGrid(false); setScreen('encaissement') }}
                  className={`relative rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border transition active:scale-95 ${
                    paidEffective
                      ? (isToInvoice ? 'bg-amber-600/20 border-amber-600/40' : 'bg-green-600/20 border-green-600/40')
                      : 'bg-surface border'
                  }`}>
                  <span className="text-2xl">{isToInvoice ? '📄' : '💳'}</span>
                  <span className={`text-sm font-medium ${
                    paidEffective ? (isToInvoice ? 'text-amber-400' : 'text-green-400') : 'text-ink-secondary'
                  }`}>{paidEffective ? (isToInvoice ? 'À facturer' : 'Payée') : 'Encaisser'}</span>
                  {paidEffective && <span className={`absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-xs font-bold text-ink ${isToInvoice ? 'bg-amber-500' : 'bg-green-500'}`}>✓</span>}
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
              {/* DPR — ouvre la modal motif avant de basculer */}
              <button onClick={() => { setShowGrid(false); setDprFromRem(false); setDprMotif(''); setDprMotifAutre(''); setShowDprMotif(true) }}
                className="rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-surface border transition active:scale-95">
                <span className="text-2xl">❌</span>
                <span className="text-sm font-medium text-ink-secondary">DPR</span>
              </button>
              {/* Terminer */}
              <button onClick={() => { setShowGrid(false); setCloseType(rem ? 'rem' : 'dsp'); setScreen('close') }}
                className={`${rem ? '' : 'col-span-2'} rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-brand border-brand transition active:scale-95`}>
                <span className="text-2xl">🏁</span>
                <span className="text-sm font-bold text-ink">Terminer</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Mise en parc ───────────────────────────────────────────── */}
      {showPark && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => setShowPark(false)}>
          <div className="bg-surface w-full rounded-t-3xl p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h2 className="text-ink font-semibold text-lg">🅿️ Choisir le dépôt</h2>
              <button onClick={() => setShowPark(false)} className="text-ink-muted text-2xl">×</button>
            </div>
            {M.destination_address && (
              <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl px-3 py-2.5">
                <p className="text-blue-300 text-xs font-medium">📍 Adresse de relivraison à enregistrer</p>
                <p className="text-ink text-sm">{M.destination_address}</p>
              </div>
            )}
            {vrLocs.length === 0
              ? <p className="text-ink-faint text-sm text-center py-4">Aucun dépôt configuré — vois /admin/depots</p>
              : vrLocs.map(vr => (
                <button key={vr.id} onClick={() => doPark(vr)} disabled={loading}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 bg-surface border rounded-2xl text-left hover:border-zinc-600 transition disabled:opacity-50 active:scale-95 ${
                    vr.is_default ? 'border-amber-500/40' : 'border'
                  }`}>
                  <span className="text-xl">🅿️</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-ink font-medium text-sm flex items-center gap-2">
                      {vr.name}
                      {vr.is_default && <span className="text-amber-400 text-xs font-normal">défaut</span>}
                    </p>
                    <p className="text-ink-muted text-xs truncate">{vr.address}</p>
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* ── Modal DPR motif (Deplacement Pour Rien typé) ───────────────── */}
      {showDprMotif && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => setShowDprMotif(false)}>
          <div className="bg-surface w-full rounded-t-3xl pb-8 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 bg-surface-hover rounded-full" /></div>
            <div className="px-5 pb-3 border-b border flex items-center justify-between">
              <div>
                <h2 className="text-ink font-semibold text-lg">
                  {dprFromRem ? '❌ Refus de prise en charge' : '❌ DPR — Déplacement pour rien'}
                </h2>
                <p className="text-ink-muted text-xs">Sélectionne le motif</p>
              </div>
              <button onClick={() => setShowDprMotif(false)} className="text-ink-muted text-2xl">×</button>
            </div>
            <div className="px-4 py-3 space-y-2">
              {DPR_MOTIFS.map(m => {
                const selected = dprMotif === m.id
                return (
                  <button key={m.id} onClick={() => setDprMotif(m.id)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl border text-left transition active:scale-95 ${
                      selected ? 'bg-brand/15 border-brand' : 'bg-surface border hover:border-zinc-600'
                    }`}>
                    <span className="text-xl">{m.icon}</span>
                    <span className={`flex-1 text-sm ${selected ? 'text-ink font-semibold' : 'text-ink-secondary'}`}>{m.label}</span>
                    <span className={`w-5 h-5 rounded-full border-2 ${selected ? 'bg-brand border-brand' : 'border-zinc-600'}`}>
                      {selected && <span className="block w-full h-full rounded-full bg-brand" />}
                    </span>
                  </button>
                )
              })}
              {dprMotif === 'autre' && (
                <textarea rows={3} value={dprMotifAutre} onChange={e => setDprMotifAutre(e.target.value.slice(0, 500))}
                  placeholder="Précise le motif…" autoFocus
                  className="w-full bg-surface border border focus:border-brand rounded-xl px-3 py-3 text-ink text-sm outline-none resize-none mt-2" />
              )}
            </div>
            <div className="px-4 pt-2 pb-4 flex gap-3">
              <button onClick={() => setShowDprMotif(false)} className="flex-1 py-3 bg-surface-hover text-ink-secondary rounded-2xl text-sm">
                Annuler
              </button>
              <button
                onClick={() => {
                  // Validation : motif requis ; "Autre" requiert un texte
                  if (!dprMotif) return
                  if (dprMotif === 'autre' && !dprMotifAutre.trim()) return
                  setShowDprMotif(false)
                  setCloseType('dpr')
                  setScreen('close')
                }}
                disabled={!dprMotif || (dprMotif === 'autre' && !dprMotifAutre.trim())}
                className="flex-1 py-3 bg-brand disabled:opacity-40 text-white font-semibold rounded-2xl text-sm">
                Continuer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal adresse (naviguer / modifier) ─────────────────────────── */}
      {addrModal && (
        <AddrActionModal
          title={addrModal.title} address={addrModal.address}
          onNavigate={() => { const u = gUrl(navApp, addrModal.lat, addrModal.lng, addrModal.address); if (u) window.open(u, '_blank'); setAddrModal(null) }}
          onModify={addrModal.field ? () => {
            const f = addrModal.field!
            if (f.startsWith('stop:')) {
              // Edition d'un stop : pre-remplir l'ecran add-stop en mode edit
              const stopId = f.slice(5)
              const target = stops.find(s => s.id === stopId)
              setEditStopId(stopId)
              setNewStopAddr(addrModal.address)
              setNewStopLabel(target?.label || '')
              setNewStopLat(addrModal.lat ?? null)
              setNewStopLng(addrModal.lng ?? null)
              setAddrModal(null); setScreen('add-stop')
            } else {
              setModField(f); setModVal(addrModal.address); setModLat(addrModal.lat ?? null); setModLng(addrModal.lng ?? null); setAddrModal(null); setScreen('modify-addr')
            }
          } : undefined}
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
      </AmbientBackground>
    </div>
  )
}
