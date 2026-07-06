'use client'
// DriverClient v4 — spec figée — DSP/REM, stops, mise en parc, realtime

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { formatEur } from '@/lib/format'
import { buildEncaissementUrl } from '@/lib/missions/encaissement-url'
import AmbientBackground from '@/components/AmbientBackground'
import { DISCHARGE_TYPES, getDischarge as getDischargeFallback, type DischargeEntry, type DischargeType } from '@/lib/decharges'
import DamageSchemaPad, { type DamageSchemaUrls } from '@/components/decharges/DamageSchemaPad'
import OcrScanModal from '@/components/OcrScanModal'
import VehiclePlateLookup from '@/components/vehicles/VehiclePlateLookup'
import type { VehicleMatch } from '@/types/vehicles'
import { KEY_LOCATIONS } from '@/lib/key-location'
import { KeyTag } from '@/components/missions/KeyInfoCard'
import { TtsButton } from '@/components/audio/TtsButton'
import { openNavigation } from '@/lib/open-navigation'
import AddressField from '@/components/AddressField'
import { T }    from '@/lib/i18n/T'
import { useT } from '@/lib/i18n/I18nProvider'

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
  key_location?: string | null; saisie_key_hook?: string | null // emplacement clé (hérité du parc pour une REL)
  client_name?: string; client_phone?: string
  billed_to_name?: string; source?: string; dossier_number?: string; external_id?: string
  vehicle_brand?: string; vehicle_model?: string; vehicle_plate?: string; vehicle_vin?: string
  incident_address?: string; incident_city?: string; incident_lat?: number; incident_lng?: number
  // Autoroute : BK + sens de circulation saisis par le dispatcher quand
  // l adresse contient une autoroute. Olivier 2026-06-05.
  incident_borne_km?: string | null
  incident_sens?:     string | null
  incident_description?: string; remarks_general?: string
  // Particularites/warnings choisies par le dispatcher a la creation
  // (ex: Complexe, Vehicule electrique, Cle absente, etc.). INFO CRITIQUE
  // pour le chauffeur : doit etre tres visible.
  warnings?: string[] | null
  // Infos transmises par le dispatch lors de la creation, a afficher
  // au chauffeur. Olivier 2026-05-26.
  vehicle_class?: 'car' | 'moto' | string | null
  distance_km?: number | null
  duration_min?: number | null
  snc_scenario?: 'dsp' | 'rem_client' | 'rem_depot' | 'rem_direct' | string | null
  snc_requires_balisage?: boolean | null
  police_blocked?: boolean | null
  remarks_billing?: string | null
  destination_address?: string; destination_name?: string; destination_lat?: number; destination_lng?: number; redelivery_address?: string
  destination_borne_km?: string | null
  destination_sens?:     string | null
  intervention_date?: string; received_at?: string
  accepted_at?: string; on_way_at?: string; on_site_at?: string
  loaded_at?: string
  completed_at?: string; parked_at?: string; delivering_at?: string
  amount_guaranteed?: number; amount_currency?: string; amount_to_collect?: number
  payment_collected_at?: string | null; payment_mode?: string | null; payment_amount?: number | null
  park_stage_name?: string; extra_addresses?: Stop[]; driver_photos?: string[]
  photo_categories_covered?: string[]  // categories du wizard photos couvertes (persiste en BDD, multi-device)
  // Workflow encaisser-avant-creer (Olivier 2026-06-01).
  // true : mission creee en draft, en attente du paiement complet avant
  // declenchement des hooks externes (TowSoft/Helpdesk/email).
  awaiting_payment?: boolean | null
}
interface VrLoc { id: string; name: string; address: string; lat: number | null; lng: number | null; is_default?: boolean }
interface Props { mission: Mission; currentUserId?: string; isReadOnly?: boolean; navApp?: NavApp; defaultParcZone?: string | null }

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Olivier 2026-06-18 : null-safe. Le defaut `= ''` ne couvre QUE undefined ;
// si le dispatcher n'a pas saisi de plaque, vehicle_plate vaut null -> plate(null)
// faisait `null.replace(...)` -> crash client "Application error" a l'arrivee.
const plate = (v?: string | null) => (v || '').replace(/[-.\s]/g, '').toUpperCase()
// REM ou Transport (les 2 impliquent un transport vehicule). Insensible casse,
// gere les variants REM/REMORQUAGE/rem/remorquage.
const isREM = (t: string | null | undefined = '') => {
  const n = (t ?? '').toLowerCase().trim()
  return ['rem', 'remorquage', 'transport'].includes(n)
}
// REL = mission de relivraison (vehicule en parc -> client). Detect via :
//  1. mission_type = 'relivraison' / 'REL' : REL creee manuellement par le
//     dispatcher dans NewMissionClient (normalisee par normalizeMissionType
//     -> 'relivraison' en BDD).
//  2. incident_type = 'relivraison'         : conventions Kaze (Olivier 2026-05-20).
//  3. parent_mission_id non null            : REL auto-creee par
//     createRelivraisonMission depuis une mission parc.
// C est techniquement proche d une REM mais avec un workflow legerement
// adapte (skip "Sur place", on demarre du parc charge).
const isRELMission = (m: Mission) => {
  const mt = (m.mission_type || '').toLowerCase().trim()
  return mt === 'relivraison' || mt === 'rel'
      || m.incident_type === 'relivraison'
      || !!m.parent_mission_id
}
// Olivier 2026-06-16 : capture GPS au moment d'un pointage (lieu de pointage
// sur la carte trajet dispatch). STRICTEMENT non bloquant : cap ~2s, renvoie
// null sur le moindre échec/refus/timeout → le pointage part quand même.
async function captureGeo(): Promise<{ lat: number; lng: number } | null> {
  try {
    return await Promise.race([
      (async (): Promise<{ lat: number; lng: number } | null> => {
        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            const { Geolocation } = await import('@capacitor/geolocation')
            const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 1800 })
            return { lat: pos.coords.latitude, lng: pos.coords.longitude }
          }
        } catch { /* fallback web */ }
        if (typeof navigator === 'undefined' || !navigator.geolocation) return null
        return await new Promise(resolve => {
          navigator.geolocation.getCurrentPosition(
            p  => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: false, maximumAge: 30_000, timeout: 1800 }
          )
        })
      })(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)),
    ])
  } catch { return null }
}

// Actions de pointage pour lesquelles on enregistre le lieu GPS.
const GEO_POINTAGE_ACTIONS = new Set([
  'accept', 'on_way', 'on_site', 'load_vehicle', 'park', 'completed',
  'start_delivery', 'complete_delivery',
])

const TYPE_BADGE: Record<string, [string, string]> = {
  DSP: ['DSP', 'bg-brand'], REM: ['REM', 'bg-blue-600'], DPR: ['DPR', 'bg-ink-faint'],
  REL: ['REL', 'bg-purple-600'],
  depannage: ['DSP', 'bg-brand'], remorquage: ['REM', 'bg-blue-600'],
  reparation_place: ['DSP', 'bg-brand'], transport: ['REM', 'bg-blue-600'],
}
// [label fallback FR, classe Tailwind bg, cle i18n optionnelle]
const STATUS_BADGE: Record<string, [string, string, string?]> = {
  assigned:    ['À accepter',  'bg-blue-600',   'mission_list.status_to_accept'],
  accepted:    ['Acceptée',    'bg-indigo-600', 'mission_list.status_accepted'],
  in_progress: ['En cours',    'bg-orange-500', 'mission_list.status_in_progress'],
  parked:      ['En dépôt',    'bg-amber-600',  'mission_detail.status_parked'],
  delivering:  ['En livraison','bg-teal-600'],
  completed:   ['Terminée',    'bg-green-600',  'mission_list.status_completed'],
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

// ─── Autoroute : BK + sens (saisis par le dispatcher, doivent etre TRES
//     visibles cote chauffeur — sinon il arrive a la mauvaise borne ou dans
//     le mauvais sens). Bandeau jaune. Olivier 2026-06-05.
function HighwayInfo({ bk, sens }: { bk?: string | null; sens?: string | null }) {
  const hasBk   = !!bk   && String(bk).trim().length   > 0
  const hasSens = !!sens && String(sens).trim().length > 0
  if (!hasBk && !hasSens) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold">
      <span>🛣️</span>
      {hasBk && <span>BK {bk}</span>}
      {hasBk && hasSens && <span className="opacity-50">·</span>}
      {hasSens && <span>{sens}</span>}
    </div>
  )
}

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
// Pad de signature : pointer events (touch + souris + stylet), fond blanc
// fixe (papier), trait noir fixe (encre). Independant du theme dark/light.
function SigPad({ onSave }: { onSave: (d: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const pen = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [drawn, setDrawn] = useState(false)

  // Initialise un fond blanc opaque sur le canvas (sinon toDataURL → fond
  // transparent, ce qui peut etre illisible sur le PDF).
  useEffect(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
  }, [])

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) / r.width  * c.width,
      y: (e.clientY - r.top)  / r.height * c.height,
    }
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    const p = getPos(e)
    pen.current = true
    last.current = p
    // Petit point initial pour signer un simple tap
    ctx.fillStyle = '#111111'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2)
    ctx.fill()
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pen.current) return
    e.preventDefault()
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    const p = getPos(e)
    if (!last.current) { last.current = p; return }
    ctx.lineWidth   = 2.8
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    ctx.strokeStyle = '#111111'
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    setDrawn(true)
  }
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pen.current = false
    last.current = null
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
  }
  const clear = () => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    setDrawn(false)
  }
  return (
    <div>
      <div className="border border rounded-xl overflow-hidden bg-white mb-3">
        <canvas
          ref={ref}
          width={680}
          height={260}
          className="w-full touch-none"
          style={{ aspectRatio: '680 / 260' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
      </div>
      <div className="flex gap-2">
        <button onClick={clear} className="flex-1 py-2.5 bg-surface-hover text-ink-secondary rounded-xl text-sm">Effacer</button>
        <button onClick={() => ref.current && onSave(ref.current.toDataURL('image/png'))} disabled={!drawn}
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
  // Refs pour onChange/onPick : evite closure stale (listener cree une fois).
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange
  const onPickRef   = useRef(onPick);   onPickRef.current   = onPick
  useEffect(() => {
    const init = () => {
      if (!ref.current || !(window as any).google?.maps?.places || ac.current) return
      ac.current = new (window as any).google.maps.places.Autocomplete(ref.current, { fields: ['name', 'formatted_address', 'geometry'] })
      ac.current.addListener('place_changed', () => {
        const p = ac.current.getPlace(); if (!p?.geometry) return
        const a = p.name && p.formatted_address ? `${p.name}, ${p.formatted_address}` : (p.formatted_address || p.name || '')
        onChangeRef.current(a); onPickRef.current(a, p.geometry.location.lat(), p.geometry.location.lng())
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
function VehSheet({ m, onSave, onClose, isNative }: {
  m:        Mission
  // odooId : véhicule Odoo sélectionné dans la liste proposée (lien direct).
  // createNew : aucun ne correspond → créer un nouveau véhicule dans Odoo.
  onSave:   (p: string, b: string, mo: string, v: string, odooId: number | null, createNew: boolean) => void
  onClose:  () => void
  isNative: boolean
}) {
  const [p, setP]   = useState(plate(m.vehicle_plate))
  const [b, setB]   = useState(m.vehicle_brand || '')
  const [mo, setMo] = useState(m.vehicle_model || '')
  const [v, setV]   = useState(m.vehicle_vin || '')
  const [scan, setScan] = useState<'plate' | 'vin' | null>(null)
  const [lookupOpen, setLookupOpen] = useState(false)

  // Modif détectée vs valeurs initiales → on ne touche à Odoo QUE si modif.
  const isModified =
    plate(p) !== plate(m.vehicle_plate || '') ||
    b  !== (m.vehicle_brand || '') ||
    mo !== (m.vehicle_model || '') ||
    v  !== (m.vehicle_vin   || '')

  const handleSave = () => {
    // Pas de modif → comportement actuel (on ne fait rien côté Odoo).
    if (!isModified) { onClose(); return }
    // Modif → on lance la recherche Odoo (proposition des véhicules trouvés).
    // VehiclePlateLookup résout seul : 1 match exact → onSelect, 0 → onCreateNew,
    // plusieurs → affiche la liste au chauffeur.
    setLookupOpen(true)
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={onClose}>
      <div className="bg-surface w-full rounded-t-3xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between"><h2 className="text-ink font-semibold text-lg">Modifier le véhicule</h2><button onClick={onClose} className="text-ink-muted text-2xl">×</button></div>

        {/* Plaque : input + bouton scan (app native uniquement) */}
        <div>
          <p className="text-ink-muted text-xs mb-1.5">Plaque</p>
          <div className="flex gap-2">
            <input value={p} onChange={e => setP(e.target.value)}
              className="flex-1 bg-surface border border focus:border-brand rounded-xl px-3 py-3 text-ink text-sm outline-none" />
            {isNative && (
              <button type="button" onClick={() => setScan('plate')}
                className="px-3 py-3 bg-brand/10 text-brand rounded-xl text-sm font-medium flex items-center gap-1.5">
                📷 Scan
              </button>
            )}
          </div>
        </div>

        <div><p className="text-ink-muted text-xs mb-1.5">Marque</p>
          <input value={b} onChange={e => setB(e.target.value)}
            className="w-full bg-surface border border focus:border-brand rounded-xl px-3 py-3 text-ink text-sm outline-none" /></div>

        <div><p className="text-ink-muted text-xs mb-1.5">Modèle</p>
          <input value={mo} onChange={e => setMo(e.target.value)}
            className="w-full bg-surface border border focus:border-brand rounded-xl px-3 py-3 text-ink text-sm outline-none" /></div>

        {/* VIN : input + bouton scan */}
        <div>
          <p className="text-ink-muted text-xs mb-1.5">VIN (optionnel)</p>
          <div className="flex gap-2">
            <input value={v} onChange={e => setV(e.target.value)}
              className="flex-1 bg-surface border border focus:border-brand rounded-xl px-3 py-3 text-ink text-sm outline-none font-mono" />
            {isNative && (
              <button type="button" onClick={() => setScan('vin')}
                className="px-3 py-3 bg-brand/10 text-brand rounded-xl text-sm font-medium flex items-center gap-1.5">
                📷 Scan
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-3 bg-surface-hover text-ink-secondary rounded-2xl text-sm">Annuler</button>
          <button onClick={handleSave} className="flex-1 py-3 bg-brand text-white font-semibold rounded-2xl text-sm">Enregistrer</button>
        </div>
      </div>

      {/* Recherche Odoo par plaque (déclenchée à l'enregistrement si modif) :
          propose les véhicules trouvés, lie l'existant ou crée le nouveau.
          On conserve les valeurs saisies par le chauffeur (sa correction). */}
      <VehiclePlateLookup
        plate={plate(p)}
        open={lookupOpen}
        onSelect={(veh: VehicleMatch) => { setLookupOpen(false); onSave(plate(p), b, mo, v, veh.id, false) }}
        onCreateNew={() => { setLookupOpen(false); onSave(plate(p), b, mo, v, null, true) }}
        onCancel={() => setLookupOpen(false)}
      />

      {scan && (
        <OcrScanModal
          mode={scan}
          current={scan === 'plate' ? p : v}
          onPick={txt => {
            if (scan === 'plate') setP(plate(txt))
            else                  setV(txt)
          }}
          onClose={() => setScan(null)}
        />
      )}
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

// ─── Briefing audio : un seul bouton qui lit l essentiel de la mission ─────
// (type + adresse + vehicule + montant + alertes). Utile pour conduite,
// gants, ou chauffeur non-lecteur.
const SOURCE_TTS_LABELS: Record<string, string> = {
  police_mg:       'Mal Garée',
  police_rodeo:    'Rodéo',
  police_avp:      'Accident voie publique',
  police_accident: 'Accident',
  police_saisie:   'Saisie',
  police_snc:      'Siabis non couvert',
  sia_couvert:     'Siabis couvert',
  prive:           'Appel privé',
}

function BriefingTtsButton({ mission }: { mission: Mission }) {
  const parts: string[] = []
  const typeLabel = SOURCE_TTS_LABELS[mission.source || ''] || mission.source || 'Mission'
  parts.push(`Mission ${typeLabel}.`)
  const addr = [mission.incident_address, mission.incident_city].filter(Boolean).join(', ')
  if (addr) parts.push(`Adresse : ${addr}.`)
  if (mission.destination_address) parts.push(`Destination : ${mission.destination_address}.`)
  const veh = [mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')
  if (veh || mission.vehicle_plate) {
    parts.push(`Véhicule : ${veh}${mission.vehicle_plate ? `, plaque ${mission.vehicle_plate.toUpperCase()}` : ''}.`)
  }
  if (mission.amount_to_collect && mission.amount_to_collect > 0) {
    parts.push(`Montant à encaisser : ${mission.amount_to_collect} euros.`)
  }
  if (Array.isArray(mission.warnings) && mission.warnings.length > 0) {
    parts.push(`Particularités : ${mission.warnings.join(', ')}.`)
  }
  if (mission.incident_description) parts.push(`Description : ${mission.incident_description}.`)

  const briefing = parts.join(' ')

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-center gap-3">
      <TtsButton text={briefing} size="lg" />
      <div className="flex-1 text-left">
        <p className="text-blue-900 text-sm font-semibold leading-tight">Écouter le briefing</p>
        <p className="text-blue-700 text-xs">Type, adresse, véhicule, montant, particularités</p>
      </div>
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function DriverClient({ mission: init, currentUserId, isReadOnly = false, navApp: initNav, defaultParcZone = null }: Props) {
  const router = useRouter()
  const { t } = useT()   // traductions FR/albanais pour les messages d'erreur (strings)

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
  // Appel Prive : flag local pour signaler que le client n a pas pu payer
  // sur place (revele le bandeau "Mise en parc Transit"). Toggle par bouton
  // dans le bandeau Appel Prive. Pas persiste en BDD (info ephemere).
  const [paymentImpossible, setPaymentImpossible] = useState(false)
  // Montant calcule via estimate-price (utilise par le bandeau Appel Prive
  // quand requiredAmount=0 pour montrer le tarif applique : forfait
  // negocie OU fallback police_accident, en HT et TVAC).
  const [estimatedAmount, setEstimatedAmount] = useState<{ htva: number; tvac: number } | null>(null)
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

  // Fetch estimation tarif (utilisee par bandeau Appel Prive quand pas de
  // montant pre-saisi : on affiche le total calcule HT + TVAC pour que le
  // chauffeur sache quel montant proposer au client). Best-effort, silent.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/missions/${M.id}/price-estimate`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        if (j?.ok && typeof j.total_eur === 'number' && j.total_eur > 0) {
          const htva = j.total_eur
          const tvac = Math.round(htva * 1.21 * 100) / 100
          setEstimatedAmount({ htva, tvac })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [M.id])

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
  // Workflow specifique Police Accident : le chauffeur indique si le vehicule
  // est roulant + dans le bon sens. Si oui+oui -> zone A, sinon -> Transit.
  // L admin parc verra la zone suggeree au moment de l inventaire.
  const [isRollable,        setIsRollable]        = useState<boolean | null>(null)
  const [isRightDirection,  setIsRightDirection]  = useState<boolean | null>(null)
  // Override manuel de la zone (Saisie : J par defaut, mais le chauffeur peut
  // basculer en Transit s il n y a plus de place en J).
  const [parkZoneOverride,  setParkZoneOverride]  = useState<string | null>(null)
  // Emplacement de la clé à la mise en parc (Olivier 2026-06-18).
  // Défaut « Dans le véhicule » (cas le plus fréquent).
  const [keyLocation,       setKeyLocation]       = useState<string>('in_vehicle')

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
  // Olivier 2026-06-03 : logging temporaire pour diagnostiquer la boucle.
  // JSON.stringify pour que les valeurs soient visibles en texte (sinon
  // la console affiche juste "Object" qu il faut cliquer pour expand).
  if (typeof window !== 'undefined') {
    console.log('[DriverClient]', JSON.stringify({
      st: M.status, mt: M.mission_type, src: M.source,
      snc: (M as any).snc_scenario,
      onSite_at: M.on_site_at, loaded_at: M.loaded_at, delivering_at: M.delivering_at,
      onSite, loaded, rem, rel,
      awaiting: M.awaiting_payment,
      paid: M.payment_amount, due: M.amount_to_collect,
      url: typeof window !== 'undefined' ? window.location.href : '',
    }))
  }
  const stops    = [...(M.extra_addresses || [])].sort((a, b) => a.sort_order - b.sort_order)
  // Si dest-final existe déjà dans stops, pas besoin d'ajouter __dest__
  const destFinalInStops = stops.find(s => s.id === 'dest-final')
  const allPoints = [
    ...stops,
    ...(!destFinalInStops && M.destination_address ? [{
      id: '__dest__', type: 'dest',
      label: `Destination${M.destination_name ? ` · ${M.destination_name}` : ''}`,
      // Olivier 2026-06-05 : avant lat/lng etaient hardcodes null -> bug
      // navigation app (l adresse n etait pas transferee dans Maps/Waze).
      address: M.destination_address,
      lat:     M.destination_lat ?? null,
      lng:     M.destination_lng ?? null,
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
  const statusI18nKey = M.status === 'parked' ? 'mission_detail.status_parked'
    : M.on_site_at ? 'mission_detail.status_on_site'
    : M.on_way_at && M.status === 'in_progress' ? 'mission_detail.status_on_way'
    : STATUS_BADGE[M.status]?.[2] || null

  // Google Maps
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; if (!key || document.getElementById('gm-v4')) return
    const s = document.createElement('script'); s.id = 'gm-v4'
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&region=BE&language=fr`
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
  const api = async (action: string, extra: Record<string, any> = {}) => {
    console.log(`[api] CALL action=${action}`, { extra, currentStatus: M.status, currentLoaded: !!M.loaded_at })
    setLoading(true); setErr('')
    try {
      // Lieu de pointage : on tente d'attacher la position GPS (non bloquant,
      // cap 2s) sauf si l'appelant a déjà fourni lat/lng.
      let geo: { lat: number; lng: number } | null = null
      if (GEO_POINTAGE_ACTIONS.has(action) && (extra as any).lat == null) {
        geo = await captureGeo()
      }
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: M.id, action, ...(geo || {}), ...extra }),
      })
      const j = await r.json()
      console.log(`[api] RES action=${action} ok=${r.ok}`, { newStatus: j.mission?.status, newLoadedAt: j.mission?.loaded_at, newDeliveringAt: j.mission?.delivering_at })
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setM(j.mission)
      // Olivier 2026-06-03 : preserve les searchParams existants (notamment
      // ?legacy=1 utilise par SNC/SC) pour eviter le re-bascule sur SncMissionFiche
      // apres chaque action (boucle infinie Vehicule charge ↔ Arrivee destination).
      {
        const __url = new URL(window.location.href)
        __url.searchParams.set('t', String(Date.now()))
        console.log(`[api] RELOAD URL=${__url.toString()}`)
        window.location.href = __url.toString()
      }
    } catch (e: any) {
      console.error(`[api] ERR action=${action}:`, e?.message || e)
      setErr(e.message || 'Erreur')
    }
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

  // Olivier 2026-06-02 PM : choix du scenario SNC depuis la fiche chauffeur.
  // Quand le dispatch reclassifie une mission en Siabis non couvert / couvert
  // (source = police_snc / sia_couvert), le chauffeur doit choisir DSP / REM
  // client / REM depot. Adapte aussi mission_type automatiquement :
  // dsp = depannage, rem_client/rem_depot = remorquage.
  //
  // Apres choix, on appelle /api/snc-preview-tarif pour calculer le tarif
  // SNC et PATCH amount_to_collect (sauf REM depot : pas d encaissement
  // immediat, le client passera au bureau).
  //
  // Pour REM client : la destination doit etre saisie AVANT (lat/lng), sinon
  // l API renvoie 400. On bloque le clic dans ce cas avec un message clair.
  const [sncSaving, setSncSaving]   = useState<string | null>(null)
  const [sncInfoMsg, setSncInfoMsg] = useState<string | null>(null)

  // Modal "adresse de destination" (DSP→REM, SNC/SC REM client & REM dépôt).
  const [destPrompt, setDestPrompt] = useState<null | { kind: 'rem' | 'rem_client' | 'rem_depot' | 'rem_direct' | 'arrival' | 'park' }>(null)
  // Adresse de relivraison confirmée au moment de la mise en parc (dispatch REM).
  // null = « communiquée plus tard » → le serveur retombe sur la destination
  // pré-parc comme relivraison par défaut. Passée à doPark.
  const [parkRedelivery, setParkRedelivery] = useState<string | null>(null)
  const [destAddr,   setDestAddr]   = useState('')
  const [destLat,    setDestLat]    = useState<number | null>(null)
  const [destLng,    setDestLng]    = useState<number | null>(null)

  const pickSncScenario = async (
    scenario: 'dsp' | 'rem_client' | 'rem_depot' | 'rem_direct',
    destOverride?: { lat: number | null; lng: number | null },
  ) => {
    setSncInfoMsg(null)
    // REM client + REM directe ont besoin de la destination (lat/lng)
    // pour estimer le tarif. REM depot n en a pas besoin (mise en parc).
    const dLat = destOverride?.lat ?? M.destination_lat
    const dLng = destOverride?.lng ?? M.destination_lng
    if ((scenario === 'rem_client' || scenario === 'rem_direct')
        && (dLat == null || dLng == null)) {
      setSncInfoMsg('Saisis d\'abord l\'adresse de destination (clique sur l\'itinéraire pour l\'ajouter).')
      return
    }
    setSncSaving(scenario); setErr('')
    try {
      const newType = scenario === 'dsp' ? 'depannage' : 'remorquage'
      // 1) PATCH scenario + type
      const r = await fetch(`/api/missions/${M.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ snc_scenario: scenario, mission_type: newType }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setM(prev => ({ ...prev, snc_scenario: scenario as any, mission_type: newType }))

      // 2) Calcul tarif SNC (sauf REM depot : pas d encaissement immediat)
      if (scenario !== 'rem_depot' && M.incident_lat != null && M.incident_lng != null) {
        const variant = M.source === 'sia_couvert' ? 'sc' : 'snc'
        const pr = await fetch('/api/snc-preview-tarif', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            scenario,
            variant,
            requires_balisage: Boolean(M.snc_requires_balisage),
            incident_lat:      M.incident_lat,
            incident_lng:      M.incident_lng,
            destination_lat:   dLat,
            destination_lng:   dLng,
            intervention_at:   M.intervention_date || (M as any).received_at || new Date().toISOString(),
          }),
        })
        const pj = await pr.json().catch(() => null)
        if (pr.ok && pj?.ok && typeof pj.total_tvac === 'number') {
          // Pour SC (Siabis couvert) : facturation a l assistance, PAS
          // d encaissement client (amount_to_collect reste null).
          const amount = variant === 'sc' ? null : pj.total_tvac
          await fetch(`/api/missions/${M.id}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ amount_to_collect: amount }),
          })
          setM(prev => ({ ...prev, amount_to_collect: amount as any }))
        }
      } else if (scenario === 'rem_depot') {
        // REM depot : pas d encaissement immediat
        await fetch(`/api/missions/${M.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ amount_to_collect: null }),
        })
        setM(prev => ({ ...prev, amount_to_collect: null as any }))
      }
    } catch (e: any) {
      setErr(e.message || 'Impossible de définir le scénario')
    } finally {
      setSncSaving(null)
    }
  }

  // Toggle balisage SNC : re-PATCH + recalcule le tarif si scenario deja choisi
  const toggleSncBalisage = async () => {
    const next = !M.snc_requires_balisage
    try {
      await fetch(`/api/missions/${M.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ snc_requires_balisage: next }),
      })
      setM(prev => ({ ...prev, snc_requires_balisage: next }))
      // Si scenario deja choisi et pas REM depot → recalcul du tarif
      if (M.snc_scenario && M.snc_scenario !== 'rem_depot' && M.incident_lat != null && M.incident_lng != null) {
        const variant = M.source === 'sia_couvert' ? 'sc' : 'snc'
        const pr = await fetch('/api/snc-preview-tarif', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            scenario: M.snc_scenario, variant,
            requires_balisage: next,
            incident_lat:    M.incident_lat,    incident_lng: M.incident_lng,
            destination_lat: M.destination_lat, destination_lng: M.destination_lng,
            intervention_at: M.intervention_date || (M as any).received_at || new Date().toISOString(),
          }),
        })
        const pj = await pr.json().catch(() => null)
        if (pr.ok && pj?.ok && typeof pj.total_tvac === 'number' && variant !== 'sc') {
          await fetch(`/api/missions/${M.id}`, {
            method:  'PATCH', headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ amount_to_collect: pj.total_tvac }),
          })
          setM(prev => ({ ...prev, amount_to_collect: pj.total_tvac as any }))
        }
      }
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
      // Olivier 2026-06-03 : preserve les searchParams existants (notamment
      // ?legacy=1 utilise par SNC/SC) pour eviter le re-bascule sur SncMissionFiche
      // apres chaque action (boucle infinie Vehicule charge ↔ Arrivee destination).
      {
        const __url = new URL(window.location.href)
        __url.searchParams.set('t', String(Date.now()))
        window.location.href = __url.toString()
      }
    } catch (e: any) { setErr(e.message || 'Erreur') }
    finally { setLoading(false) }
  }

  // ── Modal adresse de destination (DSP→REM, SNC/SC REM client & REM dépôt) ──
  const openDestPrompt = (kind: 'rem' | 'rem_client' | 'rem_depot' | 'rem_direct' | 'arrival' | 'park') => {
    setShowGrid(false)
    setErr('')
    setDestAddr(M.destination_address || '')
    setDestLat(M.destination_lat ?? null)
    setDestLng(M.destination_lng ?? null)
    setDestPrompt({ kind })
  }

  // later=true : "Adresse communiquée plus tard" (uniquement REM dépôt).
  const confirmDestPrompt = async (later = false) => {
    if (!destPrompt) return
    const kind = destPrompt.kind
    // Mise en parc (dispatch REM) : l'adresse saisie = adresse de RELIVRAISON.
    // On NE modifie PAS la destination ici (le serveur la remplacera par le dépôt
    // au moment du parc). On capture la relivraison puis on enchaîne sur l'écran
    // parc (dépôt / clé / photos).
    if (kind === 'park') {
      setParkRedelivery(later ? null : (destAddr.trim() || null))
      setDestPrompt(null)
      setCloseType('park')
      setScreen('close')
      return
    }
    if (!later) {
      const a = destAddr.trim()
      if (!a) { setErr('Adresse de destination requise'); return }
      setLoading(true)
      try {
        const body: any = { destination_address: a }
        if (destLat != null) body.destination_lat = destLat
        if (destLng != null) body.destination_lng = destLng
        const r = await fetch(`/api/missions/${M.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error || 'Échec enregistrement adresse'); setLoading(false); return }
        setM(prev => ({ ...prev, destination_address: a, destination_lat: destLat as any, destination_lng: destLng as any }))
      } catch { setErr('Erreur réseau'); setLoading(false); return }
      finally { setLoading(false) }
    }
    setDestPrompt(null)
    if (kind === 'rem') {
      await changeType('REM')   // recharge la fiche
    } else if (kind === 'arrival') {
      // Arrivée à destination d'un REM sans adresse : adresse enregistrée →
      // on enchaîne sur l'écran de clôture.
      setCloseType('rem')
      setScreen('close')
    } else {
      await pickSncScenario(kind, later ? undefined : { lat: destLat, lng: destLng })
    }
  }

  // ── Reclasser en Siabis couvert / non couvert ───────────────────────────────
  // Olivier 2026-06-21 : Momo oublie parfois de typer la mission en Siabis au
  // dispatch → pas de balisage ni de scénario côté chauffeur. Le chauffeur peut
  // reclasser ici. Recharge ensuite pour basculer sur la vue Siabis.
  const setSiabisSource = async (newSource: 'police_snc' | 'sia_couvert') => {
    setShowGrid(false); setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/missions/${M.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: newSource }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      const __url = new URL(window.location.href)
      __url.searchParams.set('t', String(Date.now()))
      window.location.href = __url.toString()
    } catch (e: any) { setErr(e.message || 'Échec de la reclassification Siabis') }
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
  // Detecte si une exception Capacitor Camera correspond a un click "Annuler"
  // (vs une vraie erreur permission/hardware). Patterns connus iOS/Android.
  const isUserCancellation = (e: any): boolean => {
    const msg = String(e?.message || e || '').toLowerCase()
    return msg.includes('cancel')        // "User cancelled photos app", "cancelled"
        || msg.includes('cancell')       // "cancelled"
        || msg.includes('dismiss')       // certains plugins disent "User dismissed"
        || msg.includes('no image')      // "No image picked"
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
      // L user a annule la prise de photo → silent (pas une erreur)
      if (isUserCancellation(e)) return
      setErr(`Camera : ${e.message || 'erreur'}`)
    }
  }
  const capPickGallery = async () => {
    // On utilise getPhoto en LOOP avec source PHOTOS (pas pickImages) parce que
    // pickImages renvoie le webPath natif (souvent HEIC sur iPhone) que WebKit
    // ne sait pas decoder via <img> → "Load failed". Avec getPhoto +
    // resultType DataUrl, Capacitor convertit nativement HEIC → JPEG cote
    // iOS avant de renvoyer la dataUrl → 100% fiable.
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      while (true) {
        try {
          const photo = await Camera.getPhoto({
            source:        CameraSource.Photos,
            resultType:    CameraResultType.DataUrl,
            quality:       80,
            saveToGallery: false,
            allowEditing:  false,
          })
          if (!photo.dataUrl) break
          const file = dataUrlToFile(photo.dataUrl, `pick-${Date.now()}.jpg`)
          setPhotos(p => [...p, file])
          setPreviews(p => [...p, photo.dataUrl!])
        } catch (e: any) {
          // Annulation user (tape "Annuler" dans le picker) = sortie de boucle
          if (isUserCancellation(e)) break
          throw e  // vraie erreur → catch externe
        }
      }
    } catch (e: any) {
      if (isUserCancellation(e)) return
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

  // Zone suggeree selon le scenario :
  //   - Police Accident : Y+Y -> 'A', sinon 'Transit' (Olivier 2026-05-24)
  //   - Police Saisie   : 'J' par defaut, le chauffeur peut basculer en
  //                       'Transit' s il n y a plus de place en J
  //   - autres          : null (le personnel parc choisit a l inventaire)
  const isPoliceAccident = M.source === 'police_accident'
  const isPoliceSaisie   = M.source === 'police_saisie'
  // REM dispatch (assistance/Touring/Kaze/VAB/privé…), hors police & SIABIS :
  // la mise en parc demande d'abord de confirmer l'adresse de relivraison.
  const isDispatchRem = rem && !isPoliceAccident && !isPoliceSaisie
    && M.source !== 'police_snc' && M.source !== 'sia_couvert'
  // Appel Prive : si le client n a pas regle, mise en parc obligatoire en
  // Transit (pas de livraison sans paiement). Le forfait/tarif sera facture
  // depuis le bureau via le module Facturation.
  const isAppelPrive     = M.source === 'prive'

  // Olivier 2026-06-22 « catalog strict » : la zone de mise en parc vient du
  // parc par défaut de la source (Administration → Sources de mission), résolu
  // côté serveur et passé en prop. Le serveur (driver-action) reste autoritaire.
  const suggestedZoneKey: string | null = defaultParcZone ?? null

  // ── Mise en parc ──────────────────────────────────────────────────────────
  const doPark = async (vr: VrLoc) => {
    // Roulant / non roulant OBLIGATOIRE (demande Axel 2026-07-05).
    if (isRollable === null) { setErr(t('mission_detail.rollable_required')); return }
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
          park_data: {
            stage_name:         vr.name,
            zone_key:           suggestedZoneKey || undefined,
            // Roulant/non roulant : désormais pour TOUTES les mises en parc.
            is_rollable:        isRollable != null ? isRollable : undefined,
            is_right_direction: isPoliceAccident ? !!isRightDirection : undefined,
            key_location:       keyLocation || undefined,
          },
          park_address: vr.address, park_lat: vr.lat, park_lng: vr.lng,
          // Relivraison confirmée dans le modal (dispatch REM) ; sinon repli sur
          // la destination pré-parc (le serveur fait ce repli aussi).
          redelivery_address: parkRedelivery ?? (M.destination_address || undefined),
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
      // Olivier 2026-06-05 : envoyer le format BDD canonical (depannage /
       // remorquage / trajet_vide / relivraison) au lieu de DSP/REM/DPR/REL
       // brut. Sinon mission_type='DPR' en BDD -> ne matche aucun helper
       // (isDSP, missionKind), label cote facturation/missions-terminees
       // tombe sur "AUTRE" et l estimation tarif foire.
       const FINAL_TYPE_MAP: Record<string, string> = {
         dsp: 'depannage',
         rem: 'remorquage',
         dpr: 'trajet_vide',
         rel: 'relivraison',
       }
      const r = await fetch('/api/missions/driver-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_id: M.id, action: 'completed',
          closing_data: {
            final_mission_type:    FINAL_TYPE_MAP[closeType] || closeType,
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
      clearDraft()
      {
        const __url = new URL(window.location.href)
        __url.searchParams.set('t', String(Date.now()))
        window.location.href = __url.toString()
      }
    } catch (e: any) { setErr(e.message || 'Erreur') }
    finally { setLoading(false) }
  }

  // Éviter l'hydratation mismatch (localStorage vs SSR)
  if (!mounted) return null

  // Clôture labels (doit être avant les early returns)
  const closeLabels: Record<string, [string, string]> = {
    dsp:  ['bg-green-600',  t('close.label_dsp')],
    rem:  ['bg-blue-600',   t('close.label_rem')],
    rel:  ['bg-purple-600', t('close.label_rel')],
    dpr:  ['bg-ink-faint',  t('close.label_dpr')],
    park: ['bg-amber-500',  t('close.label_park')],
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
    // 3 categories photo simplifiees (Olivier 2026-05-23) : plusieurs
    // photos possibles par categorie. Triees alpha pour coherence UX.
    // Le scan OCR plaque/VIN reste dans VehSheet via le bouton scan dedie.
    const PHOTO_CATS: Array<{ id: string; icon: string; label: string; hint: string; required?: boolean }> = [
      { id: 'km',       icon: '🔢', label: 'Kilométrage', hint: 'Compteur lisible',                                          required: true },
      { id: 'vehicule', icon: '🚗', label: 'Véhicule',    hint: 'Avant, arrière, côtés, intérieur, défauts (multi-photos)', required: true },
      { id: 'vin',      icon: '🆔', label: 'VIN',         hint: 'Numéro de châssis visible',                                  required: true },
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
      <ScreenWrap title="Photos" sub={`${totPh} photo${totPh !== 1 ? 's' : ''} · ${coveredCats.length}/${PHOTO_CATS.length} catégories couvertes`} back={() => setScreen(photosFrom)}>
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
                <div className="grid grid-cols-5 gap-1.5 mb-2">
                  {(['top','front','back','left','right'] as const).map(v => (
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
                  } catch (e: any) {
                    if (isUserCancellation(e)) return
                    setErr(`Camera : ${e.message || 'erreur'}`)
                  }
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
          : <a href={buildEncaissementUrl(M as any, { amount: Math.max(0, requiredAmount - (M.payment_amount ?? 0)), returnTo: `/mission/${M.id}` })} onClick={() => setTimeout(() => setPaid(true), 3000)} className="w-full flex items-center justify-center py-4 bg-brand text-white font-semibold rounded-2xl">💳 Ouvrir l'encaissement</a>}
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
        <AddrInput
          value={modVal}
          onChange={v => { setModVal(v); setModLat(null); setModLng(null) }}
          onPick={(a, lat, lng) => { setModVal(a); setModLat(lat); setModLng(lng) }} />
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
      <ScreenWrap title={closeType === 'park' ? t('close.title_park') : t('close.title_close')} sub={`${M.client_name || ''} · ${plate(M.vehicle_plate)}`} back={() => setScreen('main')}>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {/* Type de clôture — informatif, non modifiable ici */}
          <div className={`${closeBg} rounded-2xl px-4 py-3 flex items-center gap-3`}>
            <span className="text-ink font-bold text-sm">{closeLabel}</span>
          </div>

          {/* Sélection dépôt — uniquement pour Mise en parc */}
          {closeType === 'park' && (
            <div className="bg-surface border border-amber-500/30 rounded-2xl p-4">
              <p className="text-amber-400 text-xs uppercase tracking-widest font-semibold mb-2"><T k="close.depot_label" /></p>
              <div className="space-y-2">
                {vrLocs.length === 0
                  ? <p className="text-ink-faint text-sm"><T k="close.no_depot" /></p>
                  : vrLocs.map(vr => {
                      const selected = parkDepot?.id === vr.id
                      return (
                        <button key={vr.id} onClick={() => setParkDepot(vr)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition active:scale-95 ${
                            selected ? 'bg-amber-500/15 border border-amber-500/60' : 'bg-surface border border hover:border-zinc-600'
                          }`}>
                          <span className="text-lg">{selected ? '🅿️' : '◯'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-ink text-sm font-medium">{vr.name}{(vr as any).is_default ? ` ${t('close.default_paren')}` : ''}</p>
                            <p className="text-ink-muted text-xs truncate">{vr.address}</p>
                          </div>
                        </button>
                      )
                    })}
              </div>
              {M.destination_address && (
                <p className="text-blue-400/80 text-xs mt-3">{t('close.redelivery_to_save')} : {M.destination_address}</p>
              )}
            </div>
          )}

          {/* Emplacement de la clé — obligatoire à la mise en parc. Olivier 2026-06-18. */}
          {closeType === 'park' && (
            <div className="bg-surface border border-amber-500/30 rounded-2xl p-4">
              <p className="text-amber-400 text-xs uppercase tracking-widest font-semibold mb-2"><T k="close.key_where" /></p>
              <div className="grid grid-cols-2 gap-2">
                {KEY_LOCATIONS.map(k => {
                  const selected = keyLocation === k.value
                  return (
                    <button key={k.value} onClick={() => setKeyLocation(k.value)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition active:scale-95 ${
                        selected ? 'bg-amber-500/15 border border-amber-500/60' : 'bg-surface border border hover:border-zinc-600'
                      }`}>
                      <span className="text-lg flex-shrink-0">{k.icon}</span>
                      <span className="text-ink text-xs font-medium leading-tight">{t(`key_loc.${k.value}`)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Véhicule roulant / non roulant — OBLIGATOIRE (demande Axel 2026-07-05). */}
          {closeType === 'park' && (
            <div className="bg-surface border border-amber-500/30 rounded-2xl p-4">
              <p className="text-amber-400 text-xs uppercase tracking-widest font-semibold mb-2"><T k="mission_detail.vehicle_state" /></p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setIsRollable(true)}
                  className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl font-medium text-sm transition active:scale-95 ${isRollable === true ? 'bg-green-500/20 border border-green-500/60 text-green-300' : 'bg-surface border border hover:border-zinc-600 text-ink'}`}>
                  <T k="mission_detail.rollable_yes" />
                </button>
                <button onClick={() => setIsRollable(false)}
                  className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl font-medium text-sm transition active:scale-95 ${isRollable === false ? 'bg-red-500/20 border border-red-500/60 text-red-300' : 'bg-surface border border hover:border-zinc-600 text-ink'}`}>
                  <T k="mission_detail.rollable_no" />
                </button>
              </div>
            </div>
          )}

          {/* Récap éditable — chaque ligne cliquable mène à l'écran correspondant */}
          <div className="bg-surface border border rounded-2xl divide-y divide-[#2a2a2a]">
            <div className="px-4 py-3">
              <p className="text-ink-muted text-xs uppercase tracking-widest font-medium"><T k="close.recap_title" /></p>
            </div>

            {/* Véhicule — éditable */}
            <button onClick={() => setShowVeh(true)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition text-left">
              <div className="flex-1 min-w-0">
                <p className="text-ink-muted text-xs"><T k="close.vehicle" /></p>
                <p className="text-ink text-sm font-medium truncate">
                  {[M.vehicle_brand, M.vehicle_model].filter(Boolean).join(' ') || '—'} · {plate(M.vehicle_plate)}
                </p>
              </div>
              <span className="text-blue-400 text-xs flex-shrink-0">✏️</span>
            </button>

            {/* Itinéraire complet : prise en charge → stops → destination (dernière) */}
            <div className="px-4 py-3 space-y-1.5">
              <p className="text-ink-muted text-xs"><T k="close.route" /></p>
              <p className="text-ink text-sm flex items-start gap-1.5">
                <span className="text-amber-400 flex-shrink-0">⏺</span>
                <span>{M.incident_address || '—'}{M.incident_city ? `, ${M.incident_city}` : ''}</span>
              </p>
              {(rem || rel) && allPoints.map((p, idx) => {
                const isLast = idx === allPoints.length - 1
                return (
                  <p key={p.id} className="text-ink text-sm flex items-start gap-1.5">
                    <span className={`flex-shrink-0 ${isLast ? 'text-blue-400' : 'text-ink-muted'}`}>{isLast ? '🏁' : '▸'}</span>
                    <span>
                      {p.label && p.label !== p.address ? <span className="text-ink-secondary">{p.label} — </span> : null}
                      {p.address}
                      {isLast && <span className="text-blue-400 text-xs ml-1">{t('close.destination_paren')}</span>}
                    </span>
                  </p>
                )
              })}
            </div>

            {/* Photos */}
            <button onClick={() => goPhotos('close')}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition text-left">
              <span className="text-ink-secondary text-sm"><T k="close.photos" /></span>
              <span className="flex items-center gap-2">
                <span className={`text-sm font-medium ${totPh >= 3 ? 'text-green-400' : closeType === 'dpr' ? 'text-ink-muted' : 'text-red-400'}`}>
                  {totPh} {totPh >= 3 ? '✓' : closeType === 'dpr' ? t('close.photos_opt') : t('close.photos_min')}
                </span>
                <span className="text-blue-400 text-xs">→</span>
              </span>
            </button>

            {/* Décharge */}
            <button onClick={() => { resetDischargeForm(); setDischFrom('close'); setScreen('decharge') }}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition text-left">
              <span className="text-ink-secondary text-sm">{disch.length > 1 ? t('close.discharge_plural') : t('close.discharge')}</span>
              <span className="flex items-center gap-2">
                <span className={`text-sm font-medium ${disch.length > 0 ? 'text-amber-400' : 'text-ink-muted'}`}>
                  {disch.length > 0 ? `✓ ${disch.length}` : t('close.add_short')}
                </span>
                <span className="text-blue-400 text-xs">→</span>
              </span>
            </button>

            {/* Signature client — obligatoire pour les missions Kaze (IMA) */}
            <button
              onClick={() => setScreen('sig')}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition text-left"
            >
              <span className="text-ink-secondary text-sm">
                <T k="close.sig_client" />
                {M.source === 'kaze' && (
                  <span className="text-red-400 ml-1">*</span>
                )}
              </span>
              <span className="flex items-center gap-2">
                <span className={`text-sm font-medium ${
                  sig ? 'text-green-400' : (M.source === 'kaze' ? 'text-red-400' : 'text-ink-muted')
                }`}>
                  {sig ? t('close.signed') : (M.source === 'kaze' ? t('close.sig_required_tag') : '—')}
                </span>
                <span className="text-blue-400 text-xs">→</span>
              </span>
            </button>

            {/* Signature destinataire — REM uniquement, optionnelle */}
            {closeType === 'rem' && (
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-ink-secondary text-sm"><T k="close.sig_dest" /> <span className="text-ink-faint text-xs">{t('close.photos_opt')}</span></span>
                  <span className={`text-sm font-medium ${destSig ? 'text-green-400' : 'text-ink-muted'}`}>
                    {destSig ? t('close.signed') : '—'}
                  </span>
                </div>
                {destSig ? (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 border border-green-500/30 rounded-xl overflow-hidden bg-surface">
                      <img src={destSig} className="w-full max-h-20 object-contain" />
                    </div>
                    <button onClick={() => setDestSig('')} className="text-ink-muted text-xs"><T k="close.redo" /></button>
                  </div>
                ) : showDestSigPad ? (
                  <div className="mt-2">
                    <SigPad onSave={d => { setDestSig(d); setShowDestSigPad(false) }} />
                  </div>
                ) : (
                  <button onClick={() => setShowDestSigPad(true)}
                    className="w-full mt-2 py-2.5 border border-dashed border rounded-xl text-ink-secondary text-sm">
                    <T k="close.sig_dest_make" />
                  </button>
                )}
              </div>
            )}

            {/* Encaissement */}
            {M.amount_to_collect != null && M.amount_to_collect > 0 && (
              <button onClick={() => setScreen('encaissement')}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition text-left">
                <span className="text-ink-secondary text-sm"><T k="close.encaissement" /></span>
                <span className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${paidEffective ? (isToInvoice ? 'text-amber-400' : 'text-green-400') : 'text-red-400'}`}>
                    {paidEffective
                      ? (isToInvoice ? t('close.invoice_to_send') : t('close.paid'))
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
              <p className="text-ink-secondary text-sm font-medium"><T k="close.add_discharge" /></p>
              <p className="text-ink-faint text-xs"><T k="close.add_discharge_sub" /></p>
            </div>
          </button>
          {disch.map((d, i) => (
            <div key={i} className="flex items-center gap-3 bg-amber-600/10 border border-amber-600/30 rounded-2xl px-4 py-3">
              <span className="text-xl">{d.type_key && getDischarge(d.type_key)?.color === 'green' ? '✅' : '🛡️'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-amber-400 text-sm font-medium">
                  {d.type_key ? (getDischarge(d.type_key)?.label || t('close.discharge_word')) : `${t('close.discharge_word')} ${i + 1}`}
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
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-2"><T k="close.remarks" /> <span className="text-ink-faint normal-case tracking-normal">{t('close.optional_paren')}</span></p>
            <textarea rows={3} value={closeNote} onChange={e => setCloseNote(e.target.value)}
              placeholder={t('close.remarks_ph')}
              className="w-full bg-surface border border focus:border-brand rounded-xl px-3 py-3 text-ink text-sm outline-none resize-none" />
          </div>

          {closeType !== 'dpr' && totPh < 3 && (
            <button onClick={() => goPhotos('close')}
              className="w-full flex items-center justify-between bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl px-3 py-3 transition active:scale-95">
              <span className="text-amber-400 text-sm font-medium">{t('close.photos_missing', { n: 3 - totPh })}</span>
              <span className="text-amber-300 text-xs"><T k="close.photos_add" /></span>
            </button>
          )}
          {err && <p className="text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2">⚠️ {err}</p>}
        </div>

        <div className="px-4 py-4 border-t border">
          {closeType === 'park' ? (
            <>
              {!keyLocation && <p className="text-amber-400 text-xs text-center mb-2"><T k="close.key_before_confirm" /></p>}
              {isRollable === null && <p className="text-amber-400 text-xs text-center mb-2">🚗 <T k="mission_detail.rollable_required" /></p>}
              <button onClick={() => parkDepot && doPark(parkDepot)}
                disabled={loading || !parkDepot || totPh < 3 || !keyLocation || isRollable === null}
                className="w-full py-4 bg-amber-500 disabled:opacity-40 text-ink font-semibold rounded-2xl">
                {loading ? t('close.sending') : (parkDepot ? t('close.confirm_park_at', { name: parkDepot.name }) : t('close.confirm_park'))}
              </button>
            </>
          ) : (
            <>
              {/* Blocage cloture tant que paiement incomplet (sauf DPR : pas de prestation, pas d encaissement attendu) */}
              {closeType !== 'dpr' && !paymentComplete && (
                <p className="text-amber-400 text-xs text-center mb-2 px-2">
                  {t('close.pay_incomplete', { paid: formatEur(M.payment_amount ?? 0, { suffix: false }), total: formatEur(requiredAmount, { suffix: false }), cur: M.amount_currency || 'EUR' })}
                </p>
              )}
              {/* Blocage signature obligatoire pour les missions Kaze (IMA) */}
              {M.source === 'kaze' && !sig && (
                <p className="text-red-400 text-xs text-center mb-2 px-2">
                  {t('close.sig_kaze_required')}
                </p>
              )}
              <button onClick={doClose} disabled={loading
                || (closeType !== 'dpr' && (totPh < 3 || !paymentComplete))
                || (M.source === 'kaze' && !sig)}
                className="w-full py-4 bg-green-600 disabled:opacity-40 text-ink font-semibold rounded-2xl">
                {loading ? t('close.sending') : t('close.confirm_close')}
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
      {M.completed_at && (Date.now() - new Date(M.completed_at).getTime()) < 6 * 60 * 60 * 1000 && (
        <button onClick={() => setScreen('close')}
          className="w-full max-w-xs py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-2xl text-sm">
          ✏️ Modifier la clôture
        </button>
      )}
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
            <span className={`px-2.5 py-1 rounded-md text-xs font-medium text-ink ${statusBg}`}>
              {statusI18nKey ? <T k={statusI18nKey} /> : statusStr}
            </span>
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

        {/* 🔊 Briefing audio : lit type + adresse + vehicule + montant + alertes.
            Visible pour tous (utile en conduite/avec gants/non-lecteur). */}
        <BriefingTtsButton mission={M} />

        {/* ⚠ Particularites du dispatch — bandeau ROUGE bien lisible
            en theme clair iOS (text-red-700 + bg-red-50). */}
        {Array.isArray(M.warnings) && M.warnings.length > 0 && (
          <div className="bg-red-50 border-2 border-red-500 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚠️</span>
                <p className="text-red-700 text-sm font-bold uppercase tracking-wide">
                  Particularités à connaître
                </p>
              </div>
              <TtsButton text={`Particularités à connaître : ${(M.warnings || []).join(', ')}`} size="md" />
            </div>
            <div className="flex flex-wrap gap-2">
              {M.warnings.map((w, i) => (
                <span key={i} className="inline-flex items-center px-3 py-1.5 bg-white border border-red-400 rounded-lg text-red-800 text-sm font-semibold shadow-sm">
                  {w}
                </span>
              ))}
            </div>
          </div>
        )}

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
            {/* Emplacement de la clé (hérité de la mise en parc) — pour aller
                chercher la clé avant de charger. Olivier 2026-06-19. */}
            {M.key_location && (
              <div className="flex items-center gap-2 mb-3 bg-amber-500/10 border border-amber-500/40 rounded-xl px-3 py-2">
                <span className="text-amber-200 text-sm font-semibold">
                  🔑 Clé : {KEY_LOCATIONS.find(k => k.value === M.key_location)?.label || M.key_location}
                </span>
                <KeyTag keyLocation={M.key_location} hook={M.saisie_key_hook} />
              </div>
            )}
            {M.parent_mission_id && (
              <a href={`/mission/${M.parent_mission_id}`}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 rounded-lg text-purple-300 font-medium">
                📋 Voir la mission parente (remorquage initial) →
              </a>
            )}
          </div>
        )}

        {/* Appel Privé : workflow paiement -> livraison/parc.
            3 etats : paid OK / encaisser / paiement impossible (toggle). */}
        {isAppelPrive && (
          <div className={`rounded-2xl p-4 border-2 ${paidEffective
            ? 'bg-green-50 border-green-500'
            : paymentImpossible
              ? 'bg-amber-50 border-amber-500'
              : 'bg-blue-50 border-blue-500'}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">📞</span>
              <p className={`text-sm font-bold uppercase tracking-wide ${
                paidEffective ? 'text-green-700'
                : paymentImpossible ? 'text-amber-700'
                : 'text-blue-700'
              }`}>
                Appel Privé — {
                  paidEffective ? 'Paiement OK'
                  : paymentImpossible ? 'Mise en parc obligatoire'
                  : 'Encaisser le paiement'
                }
              </p>
            </div>

            {paidEffective ? (
              <p className="text-green-900 text-xs">
                ✅ Le client a réglé. Tu peux livrer le véhicule à l&apos;adresse client (REM).
              </p>
            ) : paymentImpossible ? (
              <>
                <p className="text-amber-900 text-sm mb-2">
                  Le client n&apos;a pas pu payer. Mets le véhicule en parc <strong>zone TRANSIT</strong> (facturation ultérieure depuis le bureau).
                </p>
                <p className="text-amber-800 text-xs font-semibold mb-3">
                  ⚠ Pas de livraison sans paiement.
                </p>
                <button
                  type="button"
                  onClick={() => setPaymentImpossible(false)}
                  className="text-xs px-3 py-1.5 bg-white border border-amber-500 rounded-lg text-amber-800 font-semibold hover:bg-amber-100"
                >
                  ↩ Annuler — réessayer le paiement
                </button>
              </>
            ) : (
              <>
                <p className="text-blue-900 text-sm mb-3">
                  {requiredAmount > 0 ? (
                    <>Le client doit régler <strong>{formatEur(requiredAmount)}</strong>. Ouvre l&apos;encaissement pour saisir le paiement.</>
                  ) : estimatedAmount ? (
                    (M as any).special_tarif_htva != null && Number((M as any).special_tarif_htva) > 0 ? (
                      <>Tarif négocié par le bureau : <strong>{estimatedAmount.tvac.toFixed(2)} € TVAC</strong> <span className="text-blue-700">({estimatedAmount.htva.toFixed(2)} € HTVA)</span>. Ouvre l&apos;encaissement pour encaisser ce montant au client.</>
                    ) : (
                      <>Montant à encaisser : <strong>{estimatedAmount.tvac.toFixed(2)} € TVAC</strong> <span className="text-blue-700">({estimatedAmount.htva.toFixed(2)} € HTVA)</span> — tarif calculé automatiquement. Ouvre l&apos;encaissement pour saisir le paiement.</>
                    )
                  ) : (
                    'Aucun montant pré-saisi par le bureau. Ouvre l\'encaissement pour saisir le montant à encaisser au client.'
                  )}
                </p>
                <div className="flex flex-col gap-2">
                  <a
                    href={buildEncaissementUrl(M as any, { amount: Math.max(0, requiredAmount - (M.payment_amount ?? 0)), returnTo: `/mission/${M.id}` })}
                    onClick={() => setTimeout(() => setPaid(true), 3000)}
                    className="w-full flex items-center justify-center py-3 bg-brand text-white font-semibold rounded-xl text-sm"
                  >
                    💳 Encaisser le paiement
                  </a>
                  <button
                    type="button"
                    onClick={() => setPaymentImpossible(true)}
                    className="w-full text-xs px-3 py-2 bg-white border border-amber-500 rounded-lg text-amber-800 font-semibold hover:bg-amber-100"
                  >
                    🅿️ Paiement impossible par le client → mise en parc Transit
                  </button>
                </div>
              </>
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

        {/* Bandeau Bloqué par la police (AVP : auto, autres : si saisi) */}
        {M.police_blocked && (
          <div className="bg-amber-50 border-2 border-amber-500 rounded-2xl p-3 flex items-start gap-2">
            <span className="text-xl">🚓</span>
            <div>
              <p className="text-amber-700 text-sm font-bold uppercase tracking-wide">Bloquée par la police</p>
              <p className="text-amber-900 text-xs">Le propriétaire doit être passé au commissariat avant restitution.</p>
            </div>
          </div>
        )}

        {/* Olivier 2026-06-02 PM : choix du scenario SNC quand le dispatch
            a reclassifie une mission en Siabis non couvert / couvert. Les
            3 tuiles restent toujours visibles et le chauffeur peut basculer
            entre elles a tout moment (comme dans PoliceClient.tsx a la
            creation). La tuile active est mise en evidence (bg + ring). */}
        {(M.source === 'police_snc' || M.source === 'sia_couvert') && !isReadOnly && (
          <div className="bg-blue-50 border-2 border-blue-500 rounded-2xl p-4 space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-2xl">🚔</span>
              <div>
                <p className="text-blue-900 text-sm font-bold uppercase tracking-wide">
                  Mission {M.source === 'police_snc' ? 'Siabis non couvert' : 'Siabis couvert'}
                </p>
                <p className="text-blue-900 text-xs mt-0.5">
                  Choisis le scénario d&apos;intervention. Tu peux changer tant que la mission n&apos;est pas clôturée.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {([
                { key: 'dsp' as const,        label: '🔧 DSP — Dépannage sur place',     desc: M.source === 'sia_couvert' ? 'Réparation sur place, facturée à l\'assistance (pas d\'encaissement).' : 'Réparation sur place, client paie en direct au chauffeur.' },
                // SNC : REM avec paiement immediat par le client (pas couvert)
                ...(M.source === 'police_snc' ? [{ key: 'rem_client' as const, label: '🚛 REM avec paiement immédiat', desc: 'Remorquage vers destination du client, paiement immédiat.' }] : []),
                // SC : REM directe (forfait SC + km livraison assistance, pas
                // de passage depot). Coherent avec le choix dispatcher.
                ...(M.source === 'sia_couvert' ? [{ key: 'rem_direct' as const, label: '🚛 REM directe', desc: 'Remorquage direct sans passage dépôt (forfait SC + km livraison assistance).' }] : []),
                { key: 'rem_depot' as const,  label: '🏢 REM vers dépôt Pepinster',       desc: M.source === 'sia_couvert' ? 'Mise en zone Transit, relivraison ultérieure au tarif assistance.' : 'Mise en zone Transit, le client passera au bureau ensuite.' },
              ]).map(opt => {
                const isActive = M.snc_scenario === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => opt.key === 'dsp' ? pickSncScenario('dsp') : openDestPrompt(opt.key)}
                    disabled={sncSaving !== null}
                    className={`p-3 rounded-xl border-2 text-left transition disabled:opacity-50 ${
                      isActive
                        ? 'bg-blue-100 border-blue-600 ring-2 ring-blue-300'
                        : 'bg-surface border-blue-300 hover:border-blue-500'
                    }`}
                  >
                    <div className="text-ink font-semibold text-sm flex items-center justify-between">
                      <span>{opt.label}</span>
                      {isActive && <span className="text-blue-700 text-xs">✓ Actif</span>}
                    </div>
                    <div className="text-ink-muted text-xs mt-0.5">{opt.desc}</div>
                    {sncSaving === opt.key && <div className="text-blue-700 text-xs mt-1">⏳ Application en cours…</div>}
                  </button>
                )
              })}
            </div>

            {/* Toggle balisage (impacte le tarif si scenario != rem_depot) */}
            <label className="flex items-start gap-3 cursor-pointer p-3 bg-surface border border-blue-300 rounded-xl">
              <input
                type="checkbox"
                checked={Boolean(M.snc_requires_balisage)}
                onChange={toggleSncBalisage}
                className="mt-1 w-5 h-5"
              />
              <div className="flex-1">
                <div className="text-ink text-sm font-medium">Intervention avec balisage</div>
                <div className="text-ink-muted text-xs mt-0.5">
                  Coche si un véhicule de sécurité a dû être placé (autoroute / voie rapide). Génère un supplément SIABAL.
                </div>
              </div>
            </label>

            {sncInfoMsg && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-2 text-amber-900 text-xs">
                ⚠ {sncInfoMsg}
              </div>
            )}
          </div>
        )}

        {/* Bandeau infos mission : véhicule classe, distance, SNC scenario,
            balisage, remarques facturation. Affichage conditionnel. */}
        {(M.vehicle_class === 'moto' || M.distance_km || M.snc_scenario || M.snc_requires_balisage || M.remarks_billing) && (
          <div className="bg-surface border rounded-2xl p-3 space-y-2">
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium">Infos mission</p>
            {M.vehicle_class === 'moto' && (
              <div className="flex items-center gap-2 text-sm">
                <span>🏍️</span>
                <span className="text-ink font-medium">Véhicule : Moto / 2 roues</span>
              </div>
            )}
            {(M.distance_km != null && M.distance_km > 0) && (
              <div className="flex items-center gap-2 text-sm">
                <span>🛣️</span>
                <span className="text-ink"><strong>{M.distance_km} km</strong>{M.duration_min ? ` · ~${M.duration_min} min` : ''}</span>
              </div>
            )}
            {(M.source === 'police_snc' || M.source === 'sia_couvert') && M.snc_scenario && (
              <div className="flex items-center gap-2 text-sm">
                <span>🛣️</span>
                <span className="text-ink">Scénario : <strong>{
                  M.snc_scenario === 'dsp'        ? 'DSP — dépannage sur place'
                : M.snc_scenario === 'rem_client' ? 'REM avec paiement immédiat'
                : M.snc_scenario === 'rem_depot'  ? 'REM vers dépôt Pepinster'
                : M.snc_scenario
                }</strong></span>
              </div>
            )}
            {M.snc_requires_balisage && (
              <div className="flex items-center gap-2 text-sm">
                <span>🚧</span>
                <span className="text-amber-700 font-semibold">Balisage requis (autoroute / voie rapide)</span>
              </div>
            )}
            {M.remarks_billing && (
              <div className="text-sm pt-1 border-t border">
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-ink-muted text-xs">📝 Remarques facturation</p>
                  <TtsButton text={M.remarks_billing} size="sm" />
                </div>
                <p className="text-ink">{M.remarks_billing}</p>
              </div>
            )}
          </div>
        )}

        {/* Description */}
        {M.incident_description && (
          <div className="bg-surface border border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-ink-muted text-xs uppercase tracking-widest font-medium">Description</p>
              <TtsButton text={M.incident_description} size="sm" />
            </div>
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
          {plate(M.vehicle_plate)
            ? <p className="text-ink-secondary text-xs font-mono uppercase tracking-widest mt-1">{plate(M.vehicle_plate)}</p>
            : <p className="mt-1 inline-flex items-center gap-1.5 text-amber-700 bg-amber-100 border border-amber-300 rounded-lg px-2 py-1 text-xs font-semibold">
                ⚠️ Plaque manquante — tape ici pour l'ajouter
              </p>
          }
        </button>

        {/* DSP : adresse unique (ni REM ni REL) */}
        {!rem && !rel && (
          <button onClick={() => setAddrModal({ title: "Lieu d'intervention", address: `${M.incident_address || '—'}${M.incident_city ? `, ${M.incident_city}` : ''}`, lat: M.incident_lat, lng: M.incident_lng, field: 'incident' })}
            className="w-full bg-surface border border rounded-2xl p-4 text-left hover:border-zinc-600 transition">
            <p className="text-ink-muted text-xs uppercase tracking-widest font-medium mb-1">Lieu d'intervention</p>
            <p className="text-ink text-sm">{M.incident_address || '—'}{M.incident_city ? `, ${M.incident_city}` : ''}</p>
            <HighwayInfo bk={M.incident_borne_km} sens={M.incident_sens} />
            <p className="text-blue-400 text-xs mt-1">🗺️ Tap → Naviguer ou Modifier</p>
          </button>
        )}

        {/* REM ou REL : itinéraire complet (prise en charge → stops → destination) */}
        {(rem || rel) && (
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
                <HighwayInfo bk={M.incident_borne_km} sens={M.incident_sens} />
                {(M as any).incident_info && (
                  <p className="text-amber-700 text-xs font-medium mt-0.5 whitespace-pre-wrap">ℹ️ {(M as any).incident_info}</p>
                )}
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
                      // Olivier 2026-06-05 : ajoute lat/lng (comme pour les stops)
                      // sinon Maps/Waze ouvre sans coords ni adresse.
                      setAddrModal({ title: point.label, address: point.address, lat: point.lat ?? undefined, lng: point.lng ?? undefined, field: 'destination' })
                    } else {
                      // field='stop:<id>' → la modal sait deroute vers l'edition stop
                      setAddrModal({ title: point.label, address: point.address, lat: point.lat ?? undefined, lng: point.lng ?? undefined, field: `stop:${point.id}` })
                    }
                  }}>
                    <p className="text-ink-muted text-xs">{point.label}</p>
                    <p className="text-ink text-sm truncate">{point.address}</p>
                    {point.id === '__dest__' && (
                      <>
                        <HighwayInfo bk={M.destination_borne_km} sens={M.destination_sens} />
                        {(M as any).destination_info && (
                          <p className="text-amber-700 text-xs font-medium mt-0.5 whitespace-pre-wrap">ℹ️ {(M as any).destination_info}</p>
                        )}
                        {(M as any).redelivery_info && (
                          <p className="text-amber-700 text-xs font-medium mt-0.5 whitespace-pre-wrap">ℹ️ Relivraison : {(M as any).redelivery_info}</p>
                        )}
                      </>
                    )}
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

        {/* Avance de fonds : deplacee dans la grille "Autres actions" sur place
            (cf <button "Avance de fonds"> dans showGrid) — Olivier 2026-06-01.
            Avant : bouton visible sur la fiche, encombrait la vue meme avant arrivee.
            Maintenant : accessible uniquement quand on a deja un statut actif
            (sur place / charge / delivering / parked) via le bouton "Autres actions". */}



        {err && <p className="text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2">⚠️ {err}</p>}
      </div>

      {/* Olivier 2026-06-01 — Workflow encaisser-avant-creer.
          Si la mission est en awaiting_payment, on remplace tous les boutons
          d action normaux par :
            - "Encaisser le solde (XX €)" tant qu il reste a payer
            - "Finaliser la mission" / "Charger et livrer" quand solde = 0
              (POST /api/missions/[id]/finalize puis bascule sur le flow normal)
          Olivier 2026-06-03 : label dynamique selon mission_type — pour REM
          (remorquage), apres encaissement le chauffeur doit encore charger
          et livrer → bouton "Charger le véhicule" et message clair pour ne
          plus confondre avec une cloture totale. */}
      {!isReadOnly && M.awaiting_payment && (() => {
        const required = Number(M.amount_to_collect || 0)
        const paid     = Number(M.payment_amount    || 0)
        const remaining = Math.max(0, required - paid)
        const isFullyPaid = required > 0 && paid + 0.01 >= required
        const encUrl = buildEncaissementUrl(M as any, { amount: remaining, returnTo: `/mission/${M.id}` })
        const isRemorquage = (M.mission_type || '').toLowerCase() === 'remorquage'
        const continueLabel  = isRemorquage ? '🚛 Charger le véhicule et livrer →' : '✅ Finaliser la mission'
        const continueExplain = isRemorquage
          ? 'Paiement complet. Tu peux charger le véhicule et le livrer.'
          : 'Paiement complet. Tu peux maintenant finaliser la mission.'

        return (
          <div className="fixed bottom-0 left-0 right-0 bg-surface/95 backdrop-blur border-t border px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] space-y-2 z-30">
            <div className="text-center px-2">
              <p className="text-amber-400 text-xs font-semibold uppercase tracking-wide">
                ⏸ Mission en attente de paiement
              </p>
              <p className="text-ink-secondary text-xs mt-1">
                {isFullyPaid
                  ? continueExplain
                  : `Encaissé ${formatEur(paid, { suffix: false })} / ${formatEur(required, { suffix: false })} — reste ${formatEur(remaining, { suffix: false })} à encaisser.`}
              </p>
            </div>
            {!isFullyPaid && (
              <button
                type="button"
                onClick={() => router.push(encUrl)}
                className="w-full block text-center py-4 bg-amber-500 hover:bg-amber-600 text-ink font-bold rounded-2xl text-base">
                💳 Encaisser le solde ({formatEur(remaining, { suffix: false })} €)
              </button>
            )}
            {isFullyPaid && (
              <button
                onClick={async () => {
                  setLoading(true); setErr('')
                  try {
                    const res = await fetch(`/api/missions/${M.id}/finalize`, { method: 'POST' })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Erreur finalisation')
                    // Recharge la mission pour passer en mode normal (sans awaiting_payment)
                    router.refresh()
                  } catch (e: any) {
                    setErr(e.message || 'Erreur finalisation')
                  } finally { setLoading(false) }
                }}
                disabled={loading}
                className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold rounded-2xl text-base">
                {loading ? '⏳ Finalisation...' : continueLabel}
              </button>
            )}
            {err && <p className="text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2 text-center">⚠️ {err}</p>}
          </div>
        )
      })()}

      {/* Boutons de pointage normaux (uniquement si pas en attente paiement) */}
      {!isReadOnly && !M.awaiting_payment && (
        <div className="fixed bottom-0 left-0 right-0 bg-surface/95 backdrop-blur border-t border px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] space-y-2 z-30">

          {M.status === 'assigned' && (
            <>
              <p className="text-ink-secondary text-xs text-center px-2">
                <T k="mission_detail.btn_accept_hint" />
              </p>
              <button onClick={() => api('accept')} disabled={loading}
                className="w-full py-4 bg-blue-600 disabled:opacity-50 text-ink font-bold rounded-2xl text-base">
                {loading ? <T k="mission_detail.loading" /> : <T k="mission_detail.btn_accept" />}
              </button>
            </>
          )}
          {M.status === 'accepted' && (
            <button onClick={() => initNav ? api('on_way') : setShowNav(true)} disabled={loading}
              className="w-full py-4 bg-amber-500 disabled:opacity-50 text-ink font-bold rounded-2xl text-base">
              {loading ? <T k="mission_detail.loading" /> : (rel ? <T k="mission_detail.btn_on_way_park" /> : <T k="mission_detail.btn_on_way" />)}
            </button>
          )}
          {/* "Sur place" : skip pour les REL (on demarre du parc, pas d arrivee a marquer) */}
          {M.status === 'in_progress' && !onSite && !rel && (
            <button onClick={() => api('on_site')} disabled={loading}
              className="w-full py-4 bg-orange-500 disabled:opacity-50 text-ink font-bold rounded-2xl text-base">
              {loading ? <T k="mission_detail.loading" /> : <T k="mission_detail.btn_on_site" />}
            </button>
          )}

          {/* REM : Sur place + véhicule pas encore chargé → bouton "Véhicule chargé" + bouton "Refus" */}
          {rem && !rel && M.status === 'in_progress' && onSite && !loaded && (
            <>
              <button onClick={() => api('load_vehicle')} disabled={loading}
                className="w-full py-4 bg-blue-600 disabled:opacity-50 text-ink font-bold rounded-2xl text-base">
                {loading ? <T k="mission_detail.loading" /> : <T k="mission_detail.btn_loaded_truck" />}
              </button>
              <button
                onClick={() => { setDprFromRem(true); setDprMotif(''); setDprMotifAutre(''); setShowDprMotif(true) }}
                disabled={loading}
                className="w-full py-3 bg-surface border border hover:border-red-500/60 text-ink-secondary hover:text-red-400 font-medium rounded-2xl text-sm">
                <T k="mission_detail.btn_refuse_dpr" />
              </button>
            </>
          )}

          {/* REL : in_progress (peu importe onSite) + non chargé → bouton "Véhicule chargé au parc" */}
          {rel && M.status === 'in_progress' && !loaded && (
            <button onClick={() => api('load_vehicle')} disabled={loading}
              className="w-full py-4 bg-blue-600 disabled:opacity-50 text-ink font-bold rounded-2xl text-base">
              {loading ? <T k="mission_detail.loading" /> : <T k="mission_detail.btn_loaded_park" />}
            </button>
          )}

          {/* REM/REL : véhicule chargé → arrivée à destination (+ mise en parc pour REM uniquement) */}
          {(rem || rel) && (M.status === 'delivering' || (loaded && M.status === 'in_progress')) && (
            <>
              <button onClick={() => {
                  // Olivier 2026-06-24 : REM sans adresse de destination → on
                  // demande de l'encoder à l'arrivée avant de clôturer.
                  if (rem && !rel && !M.destination_address) { openDestPrompt('arrival'); return }
                  setCloseType(rel ? 'rel' : 'rem'); setScreen('close')
                }} disabled={loading}
                className="w-full py-4 bg-green-600 disabled:opacity-50 text-ink font-bold rounded-2xl text-base flex items-center justify-center gap-2">
                <T k="mission_detail.btn_arrived_dest" />
                {M.destination_address && (
                  <span className="text-xs opacity-75 font-normal truncate max-w-[140px]">{M.destination_address}</span>
                )}
              </button>
              {/* "Mise en parc" : pour REM seulement (une REL ramène DEPUIS le parc, pas vers).
                  Olivier 2026-07-03 : séparateur non-cliquable ("ou") + marge entre les
                  deux boutons → évite le fat-finger « Arrivé » ⇄ « Mise en parc ». */}
              {!rel && (
                <>
                  <div aria-hidden="true"
                    className="flex items-center gap-3 py-3 my-1 select-none pointer-events-none">
                    <div className="flex-1 h-px bg-surface-hover" />
                    <span className="text-ink-faint text-xs font-medium">ou</span>
                    <div className="flex-1 h-px bg-surface-hover" />
                  </div>
                  <button onClick={() => {
                      if (!parkDepot) {
                        const def = vrLocs.find(v => (v as any).is_default) || vrLocs[0]
                        if (def) setParkDepot(def)
                      }
                      // Dispatch REM : on confirme d'abord l'adresse de relivraison.
                      // Police / SIABIS : parc direct (fourrière, pas de relivraison).
                      if (isDispatchRem) { openDestPrompt('park') }
                      else { setCloseType('park'); setScreen('close') }
                    }} disabled={loading}
                    className="w-full py-4 bg-amber-500 disabled:opacity-50 text-ink font-bold rounded-2xl text-base">
                    <T k="mission_detail.btn_park" />
                  </button>
                </>
              )}
            </>
          )}

          {/* DSP : sur place → photos / terminer (pas de chargement).
              Olivier 2026-06-02 : pour mission_type='trajet_vide' (DPR ou
              Mal Garee deplacement_paye), on ne charge pas et on ne depanne
              pas → pas de photos requises, bouton Terminer direct. */}
          {!rem && onSite && M.status !== 'completed' && (
            <>
              {M.mission_type !== 'trajet_vide' && totPh < 3 && (
                <button onClick={() => goPhotos('main')}
                  className="w-full py-4 bg-orange-500 text-ink font-bold rounded-2xl text-base flex items-center justify-center gap-2">
                  <T k="mission_detail.btn_photos" /> <span className="text-sm font-normal opacity-75">({totPh}/3)</span>
                </button>
              )}
              {(M.mission_type === 'trajet_vide' || totPh >= 3) && (
                <button onClick={() => { setCloseType(M.mission_type === 'trajet_vide' ? 'dpr' : 'dsp'); setScreen('close') }}
                  className="w-full py-4 bg-green-600 text-ink font-bold rounded-2xl text-base">
                  <T k="mission_detail.btn_finish" />
                </button>
              )}
            </>
          )}

          {/* En parc : la mission est finie pour le chauffeur, plus rien à faire.
              Le dispatcher prendra le relais pour créer la REL si besoin. */}
          {M.status === 'parked' && (
            <div className="w-full py-3 px-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-center">
              <p className="text-amber-400 text-sm font-semibold"><T k="mission_detail.parked_card_title" /></p>
              <p className="text-amber-300/80 text-xs mt-1"><T k="mission_detail.parked_card_subtitle" /></p>
            </div>
          )}

          {/* Bouton secondaire — Actions (DPR, photos, etc.) toujours accessible quand on est sur place ou plus avancé */}
          {(onSite || M.status === 'parked' || M.status === 'delivering' || loaded) && (
            <button onClick={() => setShowGrid(true)}
              className="w-full py-3 bg-surface border border hover:border-zinc-600 text-ink-secondary hover:text-ink font-medium rounded-2xl text-sm flex items-center justify-center gap-2">
              <T k="mission_detail.btn_other_actions" />
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
              {/* Photos — masque pour les missions sans chargement/depannage
                  (DPR, Mal Garee deplacement_paye : mission_type='trajet_vide'). */}
              {M.mission_type !== 'trajet_vide' && (
                <button onClick={() => { setShowGrid(false); goPhotos('main') }}
                  className={`relative rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border transition active:scale-95 ${totPh > 0 ? 'bg-green-600/20 border-green-600/40' : 'bg-surface border'}`}>
                  <span className="text-2xl">📷</span>
                  <span className={`text-sm font-medium ${totPh > 0 ? 'text-green-400' : 'text-ink-secondary'}`}><T k="mission_detail.action_photos" /></span>
                  {totPh > 0 && <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-xs font-bold bg-green-500 text-ink">{totPh}</span>}
                </button>
              )}
              {/* Décharge */}
              <button onClick={() => { setShowGrid(false); resetDischargeForm(); setDischFrom('main'); setScreen('decharge') }}
                className={`relative rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border transition active:scale-95 ${disch.length > 0 ? 'bg-amber-600/20 border-amber-600/40' : 'bg-surface border'}`}>
                <span className="text-2xl">📋</span>
                <span className={`text-sm font-medium ${disch.length > 0 ? 'text-amber-400' : 'text-ink-secondary'}`}><T k="mission_detail.action_discharge" /></span>
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
                  }`}>
                    {paidEffective ? (isToInvoice ? <T k="mission_detail.action_to_invoice" /> : <T k="mission_detail.action_paid" />) : <T k="mission_detail.action_collect" />}
                  </span>
                  {paidEffective && <span className={`absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-xs font-bold text-ink ${isToInvoice ? 'bg-amber-500' : 'bg-green-500'}`}>✓</span>}
                </button>
              )}
              {/* Avance de fonds — Olivier 2026-06-01 : deplace depuis la fiche
                  principale vers cette grille (visible quand on est sur place,
                  pas avant). */}
              {['accepted', 'in_progress', 'parked', 'delivering'].includes(M.status) && (
                <a
                  href={`/avance-fonds?mission_id=${M.id}&plate=${encodeURIComponent(M.vehicle_plate || '')}&brand=${encodeURIComponent(M.vehicle_brand || '')}&model=${encodeURIComponent(M.vehicle_model || '')}&mission_ref=${encodeURIComponent(M.dossier_number || M.external_id || '')}`}
                  onClick={() => setShowGrid(false)}
                  className="rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-indigo-600/10 border-indigo-600/30 transition active:scale-95">
                  <span className="text-2xl">💰</span>
                  <span className="text-sm font-medium text-indigo-400"><T k="mission_detail.action_advance" /></span>
                </a>
              )}
              {/* DSP↔REM */}
              <button onClick={() => rem ? changeType('DSP') : openDestPrompt('rem')} disabled={loading}
                className="rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-blue-600/10 border-blue-600/30 transition active:scale-95 disabled:opacity-50">
                <span className="text-2xl">🔄</span>
                <span className="text-sm font-medium text-blue-400">
                  {rem ? <T k="mission_detail.action_swap_to_dsp" /> : <T k="mission_detail.action_swap_to_rem" />}
                </span>
              </button>
              {/* Reclasser en Siabis (Olivier 2026-06-21) — si le dispatch a oublié
                  de typer la mission. Affiche le bouton de l'AUTRE variante. */}
              {M.source !== 'police_snc' && (
                <button onClick={() => setSiabisSource('police_snc')} disabled={loading}
                  className="rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-orange-600/10 border-orange-600/30 transition active:scale-95 disabled:opacity-50">
                  <span className="text-2xl">🚨</span>
                  <span className="text-sm font-medium text-orange-400 text-center leading-tight">Siabis NON couvert</span>
                </button>
              )}
              {M.source !== 'sia_couvert' && (
                <button onClick={() => setSiabisSource('sia_couvert')} disabled={loading}
                  className="rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-teal-600/10 border-teal-600/30 transition active:scale-95 disabled:opacity-50">
                  <span className="text-2xl">🚨</span>
                  <span className="text-sm font-medium text-teal-400 text-center leading-tight">Siabis couvert</span>
                </button>
              )}
              {/* Mise en parc (REM uniquement) */}
              {rem && (
                <button onClick={() => { setShowGrid(false); if (isDispatchRem) { openDestPrompt('park') } else { setShowPark(true) } }}
                  className="rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-amber-600/10 border-amber-600/30 transition active:scale-95">
                  <span className="text-2xl">🅿️</span>
                  <span className="text-sm font-medium text-amber-400"><T k="mission_detail.action_park" /></span>
                </button>
              )}
              {/* DPR — ouvre la modal motif avant de basculer */}
              <button onClick={() => { setShowGrid(false); setDprFromRem(false); setDprMotif(''); setDprMotifAutre(''); setShowDprMotif(true) }}
                className="rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-surface border transition active:scale-95">
                <span className="text-2xl">❌</span>
                <span className="text-sm font-medium text-ink-secondary"><T k="mission_detail.action_dpr" /></span>
              </button>
              {/* Terminer */}
              <button onClick={() => { setShowGrid(false); setCloseType(rem ? 'rem' : 'dsp'); setScreen('close') }}
                className="col-span-2 rounded-2xl py-5 flex flex-col items-center justify-center gap-2 border bg-brand border-brand transition active:scale-95">
                <span className="text-2xl">🏁</span>
                <span className="text-sm font-bold text-ink"><T k="mission_detail.action_finish" /></span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Adresse de destination (DSP→REM, SNC/SC REM) ───────────── */}
      {destPrompt && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => !loading && setDestPrompt(null)}>
          <div className="bg-surface w-full rounded-t-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h2 className="text-ink font-semibold text-lg">
                {destPrompt.kind === 'park' ? t('close.park_confirm_title') : t('close.dest_title')}
              </h2>
              <button onClick={() => setDestPrompt(null)} className="text-ink-muted text-2xl">×</button>
            </div>
            <p className="text-ink-muted text-sm">
              {destPrompt.kind === 'park'
                ? (M.destination_address ? t('close.park_desc_edit') : t('close.park_desc_new'))
                : (M.destination_address ? t('close.dest_desc_edit') : t('close.dest_desc_new'))}
            </p>
            <AddressField
              value={destAddr}
              onChange={setDestAddr}
              onSelect={(a, la, ln) => { setDestAddr(a); setDestLat(la); setDestLng(ln) }}
              gmKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
              placeholder={destPrompt.kind === 'park' ? t('close.ph_redelivery') : t('close.ph_destination')}
            />
            {err && <p className="text-red-400 text-sm">⚠ {err}</p>}
            <button onClick={() => confirmDestPrompt(false)} disabled={loading || !destAddr.trim()}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-bold transition disabled:opacity-50">
              {loading ? t('mission_detail.loading') : (destPrompt.kind === 'park' ? t('close.confirm_deposit') : t('close.validate'))}
            </button>
            {(destPrompt.kind === 'rem_depot' || destPrompt.kind === 'park') && (
              <button onClick={() => confirmDestPrompt(true)} disabled={loading}
                className="w-full py-3 bg-surface-2 border text-ink rounded-2xl text-sm font-semibold transition disabled:opacity-50">
                <T k="close.addr_later" />
              </button>
            )}
            <button onClick={() => setDestPrompt(null)} disabled={loading}
              className="w-full py-2 text-ink-muted text-sm disabled:opacity-50"><T k="close.cancel" /></button>
          </div>
        </div>
      )}

      {/* ── Modal Mise en parc ───────────────────────────────────────────── */}
      {showPark && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => setShowPark(false)}>
          <div className="bg-surface w-full rounded-t-3xl p-6 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h2 className="text-ink font-semibold text-lg"><T k="close.choose_depot" /></h2>
              <button onClick={() => setShowPark(false)} className="text-ink-muted text-2xl">×</button>
            </div>

            {/* « Catalog strict » : la zone vient du parc par défaut de la
                source (Administration → Sources de mission). Olivier 2026-06-22. */}
            {suggestedZoneKey && (
              <div className="bg-blue-900/15 border border-blue-700/30 rounded-2xl p-3">
                <p className="text-blue-300 text-xs font-medium"><T k="close.park_zone" /></p>
                <p className="text-ink-muted text-xs mt-1">
                  {t('close.park_zone_desc', { zone: suggestedZoneKey })}
                </p>
              </div>
            )}

            {M.destination_address && (
              <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl px-3 py-2.5">
                <p className="text-blue-300 text-xs font-medium"><T k="close.redelivery_to_save" /></p>
                <p className="text-ink text-sm">{M.destination_address}</p>
                <HighwayInfo bk={M.destination_borne_km} sens={M.destination_sens} />
              </div>
            )}

            {/* Véhicule roulant / non roulant — OBLIGATOIRE avant de choisir le dépôt. */}
            <div className="bg-surface border border-amber-500/30 rounded-2xl p-3">
              <p className="text-amber-400 text-xs uppercase tracking-widest font-semibold mb-2"><T k="mission_detail.vehicle_state" /></p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setIsRollable(true)}
                  className={`px-3 py-2.5 rounded-xl font-medium text-sm transition active:scale-95 ${isRollable === true ? 'bg-green-500/20 border border-green-500/60 text-green-300' : 'bg-surface border border hover:border-zinc-600 text-ink'}`}><T k="mission_detail.rollable_yes" /></button>
                <button onClick={() => setIsRollable(false)}
                  className={`px-3 py-2.5 rounded-xl font-medium text-sm transition active:scale-95 ${isRollable === false ? 'bg-red-500/20 border border-red-500/60 text-red-300' : 'bg-surface border border hover:border-zinc-600 text-ink'}`}><T k="mission_detail.rollable_no" /></button>
              </div>
              {isRollable === null && <p className="text-amber-400/90 text-xs mt-2"><T k="mission_detail.rollable_then_depot" /></p>}
            </div>

            {vrLocs.length === 0
              ? <p className="text-ink-faint text-sm text-center py-4"><T k="close.no_depot" /></p>
              : vrLocs.map(vr => {
                return (
                  <button key={vr.id} onClick={() => doPark(vr)} disabled={loading || isRollable === null}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 bg-surface border rounded-2xl text-left hover:border-zinc-600 transition disabled:opacity-50 active:scale-95 ${
                      vr.is_default ? 'border-amber-500/40' : 'border'
                    }`}>
                    <span className="text-xl">🅿️</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-ink font-medium text-sm flex items-center gap-2">
                        {vr.name}
                        {vr.is_default && <span className="text-amber-400 text-xs font-normal"><T k="close.default_tag" /></span>}
                      </p>
                      <p className="text-ink-muted text-xs truncate">{vr.address}</p>
                    </div>
                  </button>
                )
              })}
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
          onNavigate={() => { openNavigation(navApp, addrModal.lat, addrModal.lng, addrModal.address); setAddrModal(null) }}
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
        openNavigation(app, M.incident_lat, M.incident_lng, M.incident_address)
        api('on_way')
      }} />}

      {/* Vehicle sheet */}
      {showVeh && <VehSheet m={M} isNative={isCapacitor} onClose={() => setShowVeh(false)} onSave={async (p, b, mo, v, odooId, createNew) => {
        setShowVeh(false)
        try {
          let vehicleId: number | null = odooId
          // Aucun véhicule Odoo correspondant → on en crée un (marque/modèle requis).
          if (createNew && vehicleId == null) {
            if (!b.trim() || !mo.trim()) throw new Error('Marque et modèle requis pour créer le véhicule')
            const cr = await fetch('/api/odoo/create-vehicle', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plate: p, brand: b, model: mo, vin: v || undefined }),
            })
            const cj = await cr.json()
            if (!cr.ok || !cj.ok) throw new Error(cj.error || 'Création du véhicule échouée')
            vehicleId = cj.vehicle_id
          }
          const r = await fetch('/api/missions/update-vehicle', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mission_id: M.id, vehicle_plate: p, vehicle_brand: b, vehicle_model: mo, vehicle_vin: v, ...(vehicleId != null ? { odoo_vehicle_id: vehicleId } : {}) }),
          })
          const j = await r.json()
          if (!r.ok) throw new Error(j.error || 'Erreur')
          setM(m => ({ ...m, vehicle_plate: j.mission?.vehicle_plate ?? p, vehicle_brand: j.mission?.vehicle_brand ?? b, vehicle_model: j.mission?.vehicle_model ?? mo, vehicle_vin: j.mission?.vehicle_vin ?? v } as any))
        } catch (e: any) {
          setErr(e.message || 'Échec de la mise à jour du véhicule')
        }
      }} />}
      </AmbientBackground>
    </div>
  )
}
