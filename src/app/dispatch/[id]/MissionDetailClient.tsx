'use client'

import { useState, useEffect, useRef }    from 'react'
import { useRouter }   from 'next/navigation'
import Link            from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { Pencil } from 'lucide-react'
import { DriverTimeline } from '@/components/missions/DriverTimeline'
import PriceEstimateCard from '@/components/missions/PriceEstimateCard'
import MissionRemarks from '@/components/missions/MissionRemarks'
import AddressField, { verifyAddressViaPlaces } from '@/components/AddressField'
import DriverPickerModal from '@/components/DriverPickerModal'
import ScanButton from '@/components/ScanButton'
import CreateClientModal from '@/components/CreateClientModal'
import RestituerMalGareeModal from '@/components/restitution/RestituerMalGareeModal'
import GererSncDepotModal from '@/components/restitution/GererSncDepotModal'
import AppShell from '@/components/layout/AppShell'
import { getSourceLabel, getSourceColor, type SourceDisplay as CatalogSource } from '@/lib/missions/source-display'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mission {
  id: string
  external_id: string
  dossier_number: string | null
  source: string
  source_format: string
  mission_type: string | null
  incident_type: string | null
  incident_description: string | null
  client_name: string | null
  client_phone: string | null
  client_address: string | null
  vehicle_plate: string | null
  vehicle_brand: string | null
  vehicle_model: string | null
  vehicle_vin: string | null
  vehicle_fuel: string | null
  vehicle_gearbox: string | null
  incident_address: string | null
  incident_city: string | null
  incident_country: string
  incident_lat: number | null
  incident_lng: number | null
  destination_name: string | null
  destination_address: string | null
  incident_borne_km: string | null
  incident_sens: string | null
  destination_borne_km: string | null
  destination_sens: string | null
  odoo_vehicle_id: number | null
  depot_depart_id: string | null
  amount_guaranteed: number | null
  amount_currency: string
  amount_to_collect: number | null
  vehicle_mileage: number | null
  driver_photos: string[] | null
  discharge_data: { motif: string; name: string; sig: string }[] | null
  discharge_motif: string | null
  discharge_name: string | null
  discharge_sig: string | null
  client_signature: string | null
  client_signature_name: string | null
  closing_notes: string | null
  payment_method: string | null
  odoo_helpdesk_id: number | null
  odoo_task_id: number | null
  odoo_ticket_url: string | null
  odoo_task_url: string | null
  amount_collected: number | null
  incident_at: string | null
  received_at: string
  intervention_date: string | null
  status: string
  dispatch_mode: string
  assigned_to: string | null
  assigned_at: string | null
  assigned_user: { id: string; name: string; phone?: string } | null
  accepted_at: string | null
  on_way_at: string | null
  on_site_at: string | null
  completed_at: string | null
  parse_confidence: number | null
  raw_content: string | null
  billed_to_name: string | null
  billed_to_id: number | null
  assisted_name: string | null
  assisted_phone: string | null
  extra_addresses: Stop[] | null
  invoice_method?: 'manual' | 'auto' | null
  invoice_number?: string | null
  invoice_url?:    string | null
  invoiced_at?:    string | null
  police_blocked?: boolean
  parked_at?:      string | null
  // Position dans le parc (mission parked). Cf migration 202605182100.
  parc_zone_key?:    string | null
  parc_row_number?:  number | null
  parc_slot_index?:  number | null
  park_stage_name?:  string | null  // nom du depot/stage (ex: "Pepinster")
  // Particularites/warnings saisies par le dispatcher a la creation
  warnings?:         string[] | null
}

interface Stop {
  id:         string
  type:       string
  label:      string
  address:    string
  lat:        number | null
  lng:        number | null
  arrived_at: string | null
  on_way_at?: string | null
  sort_order: number
}

interface MissionLog {
  id: string
  action: string
  notes: string | null
  created_at: string
  actor: { name: string } | null
}

interface Driver {
  id: string
  name: string
  avatar_url: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// SOURCE_LABELS retire : remplace par les helpers getSourceLabel /
// getSourceColor qui lisent mission_source_catalog (charge en prop).

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new:         { label: 'Nouvelle',     color: 'text-warning'   },
  dispatching: { label: 'En attente',   color: 'text-info'      },
  assigned:    { label: 'Assignée',     color: 'text-purple'    },
  accepted:    { label: 'Acceptée',     color: 'text-success'   },
  in_progress: { label: 'En cours',     color: 'text-alert'     },
  completed:   { label: 'Terminée',     color: 'text-ink-muted' },
  cancelled:   { label: 'Annulée',      color: 'text-critical'  },
  ignored:     { label: 'Refusée',      color: 'text-critical'  },
  parse_error: { label: 'Erreur',       color: 'text-critical'  },
}

const MISSION_TYPES = ['remorquage', 'relivraison', 'depannage', 'transport', 'trajet_vide', 'reparation_place', 'autre']
const FUEL_TYPES    = ['Autre', 'Diesel', 'Électrique', 'Essence', 'GPL', 'Hybride']
const GEARBOX_TYPES = ['Automatique', 'Manuelle', 'Semi-automatique']

const LOG_ICONS: Record<string, string> = {
  received:   '📥',
  parsed:     '🔍',
  dispatched: '✅',
  accepted:   '👍',
  refused:    '❌',
  reassigned: '🔄',
  completed:  '🏁',
  cancelled:  '🚫',
  error:      '⚠️',
}

// ── Date helpers (intervention_date) ──────────────────────────────────────────

// <input type="datetime-local"> attend YYYY-MM-DDTHH:mm en HEURE LOCALE.
function toDateTimeLocalString(d: Date): string {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  const hh   = String(d.getHours()).padStart(2, '0')
  const min  = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`
}

const FR_DAYS   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']
const FR_MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']

function formatInterventionDate(local: string): string {
  if (!local) return 'Non définie — cliquez pour ajouter'
  const d = new Date(local)
  if (isNaN(d.getTime())) return 'Date invalide'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${FR_DAYS[d.getDay()]} ${d.getDate()} ${FR_MONTHS[d.getMonth()]} ${d.getFullYear()} à ${hh}:${mm}`
}

// ── Input helpers ─────────────────────────────────────────────────────────────


function AddressReviewModal({
  which, parsedAddress, currentAddress, googleSuggestion, gmKey, onPick, onSkip,
}: {
  which:            'incident' | 'destination'
  parsedAddress:    string
  currentAddress:   string
  googleSuggestion?: { addr: string; lat: number; lng: number }
  gmKey:            string
  onPick:           (addr: string, lat: number | null, lng: number | null) => void
  onSkip:           () => void
}) {
  const [manualAddr, setManualAddr] = useState('')
  const [manualPick, setManualPick] = useState<{ lat: number; lng: number } | null>(null)
  const title = which === 'incident' ? "Lieu d'incident" : 'Destination'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-surface border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6 border-b border">
          <h2 className="text-ink font-bold text-lg flex items-center gap-2">
            🛰️ Vérifier l'adresse — {title}
          </h2>
          <p className="text-ink-secondary text-xs mt-1">
            Choisis une adresse géolocalisée pour permettre le calcul des kilomètres.
          </p>
        </div>

        <div className="p-6 space-y-3">
          {/* Adresse parsée originale */}
          <button type="button" onClick={() => onPick(parsedAddress, null, null)}
            className="w-full text-left p-4 bg-surface hover:bg-surface-2 border hover:border-ink-faint rounded-xl transition">
            <p className="text-ink-muted text-xs font-medium uppercase mb-1">📥 Adresse reçue (parser)</p>
            <p className="text-ink text-sm">{parsedAddress || <span className="text-ink-faint">(vide)</span>}</p>
            <p className="text-warning text-xs mt-2">⚠ Sera envoyée sans coordonnées GPS — pas de calcul KM</p>
          </button>

          {/* Suggestion Google */}
          {googleSuggestion && (
            <button type="button" onClick={() => onPick(googleSuggestion.addr, googleSuggestion.lat, googleSuggestion.lng)}
              className="w-full text-left p-4 bg-success-soft hover:bg-success-soft border border-success hover:border-success rounded-xl transition">
              <p className="text-success text-xs font-medium uppercase mb-1">🌐 Suggestion Google</p>
              <p className="text-ink text-sm">{googleSuggestion.addr}</p>
              <p className="text-success text-xs mt-2">✓ Géolocalisée ({googleSuggestion.lat.toFixed(5)}, {googleSuggestion.lng.toFixed(5)})</p>
            </button>
          )}

          {/* Saisie manuelle avec autocomplete */}
          <div className="p-4 bg-surface border rounded-xl">
            <p className="text-brand text-xs font-medium uppercase mb-2">🔍 Saisie manuelle</p>
            <AddressField
              value={manualAddr}
              onChange={v => { setManualAddr(v); setManualPick(null) }}
              onSelect={(addr, lat, lng) => { setManualAddr(addr); setManualPick({ lat, lng }) }}
              gmKey={gmKey}
              placeholder="Tape une adresse précise…"
            />
            {manualPick && (
              <button type="button"
                onClick={() => onPick(manualAddr, manualPick.lat, manualPick.lng)}
                className="mt-3 w-full px-4 py-2.5 bg-brand hover:bg-brand/80 text-white text-sm font-semibold rounded-xl transition">
                Utiliser cette adresse
              </button>
            )}
          </div>
        </div>

        <div className="p-4 border-t border flex justify-between">
          <p className="text-ink-muted text-xs self-center">
            Adresse actuelle dans le form : <span className="text-ink-secondary">{currentAddress || '(vide)'}</span>
          </p>
          <button type="button" onClick={onSkip}
            className="px-4 py-2 text-ink-secondary hover:text-ink text-xs transition">
            Plus tard
          </button>
        </div>
      </div>
    </div>
  )
}

function RelivrerButton({
  missionId, initialRedeliveryAddress, originalDestination, parentSource,
}: {
  missionId: string
  initialRedeliveryAddress?: string | null
  originalDestination?: string | null
  parentSource: string | null
}) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [address, setAddress] = useState(initialRedeliveryAddress || originalDestination || '')

  // Cas reprise par assistance (Appel Prive, SNC, SC, Police Accident) : le
  // dispatcher peut basculer la facturation REL vers l assistance qui reprend
  // le dossier (Touring, Ethias, etc.). La REM parente garde son tarif
  // d origine. Default = '' (= garde la source parente).
  const parentSourceLower = (parentSource || '').toLowerCase()
  const allowsSourceOverride = ['prive', 'police_snc', 'police_accident'].includes(parentSourceLower)
  const [sourceOverride, setSourceOverride] = useState<string>('')
  const [sourcesList, setSourcesList] = useState<Array<{ key: string; label: string }>>([])

  useEffect(() => {
    if (!allowsSourceOverride) return
    fetch('/api/missions/sources')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d?.sources)) {
          // Filtre la source parente elle-meme (pas besoin d override vers le meme)
          // + les sources Police qui ne sont jamais des "assistances qui reprennent"
          const excluded = new Set([parentSourceLower, 'police_mg', 'police_rodeo', 'police_avp', 'police_saisie'])
          setSourcesList(d.sources.filter((s: any) => !excluded.has((s.key || '').toLowerCase())))
        }
      })
      .catch(() => {})
  }, [allowsSourceOverride, parentSourceLower])

  const hasAddress = (initialRedeliveryAddress || '').trim().length > 0

  const handle = async () => {
    const finalAddr = address.trim()
    if (!finalAddr) {
      setError('Adresse de relivraison requise pour créer la mission REL')
      return
    }
    if (!confirm(`Créer la mission de relivraison ?\nLe véhicule sera à charger depuis le parc et livré à :\n${finalAddr}`)) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/missions/${missionId}/relivrer`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          redelivery_address: finalAddr,
          source_override:    sourceOverride.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setCreatedId(data.mission_id)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (createdId) {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4">
        <p className="text-emerald-300 text-sm font-semibold mb-2">✅ Mission REL créée</p>
        <Link href={`/dispatch/${createdId}`}
          className="block w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium text-center transition">
          📋 Ouvrir la mission de relivraison →
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter space-y-3">
      <div>
        <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-2">🅿️ Véhicule en parc</h3>
        <p className="text-ink-secondary text-xs">
          Le véhicule attend en zone TRANSIT. Indique l'adresse de relivraison pour planifier la REL dans le dispatch.
        </p>
      </div>

      <div>
        <label className="block text-ink-muted text-xs mb-1.5">
          Adresse de relivraison {hasAddress && <span className="text-success">· enregistrée</span>}
        </label>
        <textarea
          value={address}
          onChange={e => setAddress(e.target.value)}
          rows={2}
          placeholder="Rue, n°, code postal, ville…"
          className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint resize-none"
        />
        {!hasAddress && originalDestination && (
          <p className="text-ink-muted text-xs mt-1">
            💡 Pré-remplie depuis l'adresse client originale. Vérifie / corrige si besoin.
          </p>
        )}
      </div>

      {/* Cas Appel Privé / SNC / Police Accident : choix de la source
          tarifaire de la REL si le dossier a été repris par une assistance. */}
      {allowsSourceOverride && (
        <div>
          <label className="block text-ink-muted text-xs mb-1.5">
            Source tarifaire de la REL
          </label>
          <select
            value={sourceOverride}
            onChange={e => setSourceOverride(e.target.value)}
            className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
          >
            <option value="">Garder la source d&apos;origine</option>
            {sourcesList.map(s => (
              <option key={s.key} value={s.key}>Reprise par {s.label}</option>
            ))}
          </select>
          <p className="text-ink-muted text-xs mt-1">
            💡 Si une assurance a repris le dossier, choisis-la ici. La REL sera facturée à son tarif. La mission parente garde sa source d&apos;origine.
          </p>
        </div>
      )}

      <button onClick={handle} disabled={loading || !address.trim()}
        className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
        {loading ? '⏳ Création…' : '🚛 Créer la mission de relivraison'}
      </button>
      {error && <p className="text-critical text-xs">⚠ {error}</p>}
    </div>
  )
}

function MissionKmInfo({ missionId, refreshKey }: { missionId: string; refreshKey: string }) {
  const [data, setData]   = useState<{ total_km: number; segments: Array<{ label: string; km: number | null }>; error: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    fetch(`/api/missions/${missionId}/km`).then(r => r.json()).then(d => {
      if (d.error && !d.segments) setData({ total_km: 0, segments: [], error: d.error })
      else setData(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [missionId, refreshKey])

  return (
    <div className="mt-4 pt-4 border-t border">
      <div className="flex items-center justify-between mb-2">
        <p className="text-ink-muted text-xs uppercase tracking-wide font-medium">📏 Kilométrage</p>
        {data?.total_km != null && data.segments.length > 0 && (
          <span className="text-ink font-semibold text-sm">{data.total_km} km</span>
        )}
      </div>
      {loading && <p className="text-ink-faint text-xs">Calcul…</p>}
      {!loading && data?.error && data.segments.length === 0 && (
        <p className="text-ink-faint text-xs">⚠ {data.error}</p>
      )}
      {!loading && data?.segments && data.segments.length > 0 && (
        <ul className="space-y-1">
          {data.segments.map((s, i) => (
            <li key={i} className="flex items-center justify-between text-xs">
              <span className="text-ink-secondary truncate flex-1 min-w-0">{s.label}</span>
              <span className={`flex-shrink-0 ml-2 ${s.km == null ? 'text-ink-faint' : 'text-ink-secondary'}`}>
                {s.km != null ? `${s.km} km` : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GeoStatusBanner({ status, onReview }: {
  status:   { state: 'idle'|'checking'|'confirmed'|'different'|'not_found'; suggestion?: { addr: string; lat: number; lng: number } }
  onReview: () => void
}) {
  if (status.state === 'idle')      return null
  if (status.state === 'checking')  return <p className="text-ink-muted text-xs">⏳ Vérification Google…</p>
  if (status.state === 'confirmed') return <p className="text-success text-xs">✅ Adresse confirmée par Google</p>
  if (status.state === 'different') return (
    <div className="px-3 py-2 bg-success-soft border border-success rounded-xl flex items-center justify-between gap-2">
      <p className="text-success text-xs">✅ Normalisée par Google (lat/lng appliqués)</p>
      <button type="button" onClick={onReview}
        className="flex-shrink-0 px-2.5 py-1 bg-surface-hover hover:bg-surface-2 text-ink-secondary rounded-lg text-xs transition">
        Pas la bonne ?
      </button>
    </div>
  )
  // not_found
  return (
    <div className="px-3 py-2 bg-critical-soft border border-critical rounded-xl flex items-center justify-between gap-2">
      <p className="text-critical text-xs">❌ Adresse non trouvée par Google — pas de calcul KM possible</p>
      <button type="button" onClick={onReview}
        className="flex-shrink-0 px-2.5 py-1 bg-critical-soft hover:bg-critical-fill text-white rounded-lg text-xs font-semibold transition">
        Corriger
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-ink-muted text-xs mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder, readOnly, title }: {
  value: string; onChange: (v: string) => void; placeholder?: string
  readOnly?: boolean
  title?: string
}) {
  if (readOnly) {
    return (
      <input
        value={value}
        readOnly
        placeholder={placeholder}
        title={title}
        className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink-secondary text-sm placeholder:text-ink-faint cursor-not-allowed"
      />
    )
  }
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      title={title}
      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint"
    />
  )
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand"
    >
      <option value="">— Sélectionner —</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function DynamicSourceSelect({ value, onChange }: {
  value: string; onChange: (v: string) => void
}) {
  const [sources, setSources] = useState<{ source: string; label: string }[]>([])

  useEffect(() => {
    fetch('/api/missions/sources')
      .then(r => r.json())
      .then(j => setSources(j.sources || []))
      .catch(() => {})
  }, [])

  // Si la source courante n'est pas (encore) dans la liste fetched, l'inclure
  // pour eviter d'afficher un dropdown vide pendant le load ou si la valeur
  // est inconnue (legacy).
  const currentKey = (value || '').toLowerCase().trim()
  const hasCurrent = !currentKey || sources.some(s => s.source === currentKey)
  const merged = hasCurrent ? sources : [{ source: currentKey, label: currentKey }, ...sources]
  // Tri alphabetique par label (Olivier 2026-05-25 : l API retourne par
  // sort_order qui n est pas alphabetique, mais l user veut alpha dans ce
  // dropdown d edition de fiche).
  const options = [...merged].sort((a, b) =>
    a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })
  )

  return (
    <select
      value={currentKey}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand"
    >
      <option value="">— Sélectionner —</option>
      {options.map(s => (
        <option key={s.source} value={s.source}>{s.label}</option>
      ))}
    </select>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

interface LinkedMissionLight {
  id: string
  external_id: string | null
  dossier_number?: string | null
  status: string
  vehicle_plate?: string | null
  destination_address?: string | null
  redelivery_address?: string | null
  completed_at?: string | null
  parked_at?: string | null
  received_at?: string | null
  intervention_date?: string | null
  assigned_to?: string | null
}

export default function MissionDetailClient({
  mission: initialMission,
  logs,
  drivers,
  sources,
  linkedParent,
  linkedChild,
  userName,
  userRole,
  userEmail,
  userId,
  userModules = [],
  userHasOdooAccess = false,
  googleMapsKey,
  autoDispatchStatus,
}: {
  mission:       Mission
  logs:          MissionLog[]
  drivers:       Driver[]
  sources:       CatalogSource[]
  linkedParent?: LinkedMissionLight | null
  linkedChild?:  LinkedMissionLight | null
  userName:      string
  userRole:      string
  userEmail?:    string
  userId?:       string
  userModules?:  string[]
  userHasOdooAccess?: boolean
  googleMapsKey: string
  autoDispatchStatus?: string | null
}) {
  const router = useRouter()

  // Combiner rue + ville/CP en une seule adresse complète si la ville n'y est pas déjà.
  // Le parser email écrit incident_address (rue) et incident_city séparément. L'UI a un seul
  // champ unifié, donc on les concatène à l'init.
  const combineAddress = (street: string | null, city: string | null) => {
    const s = (street || '').trim()
    const c = (city   || '').trim()
    if (!s) return c
    if (!c) return s
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
    return norm(s).includes(norm(c)) ? s : `${s}, ${c}`
  }

  // Formulaire éditable
  const [form, setForm] = useState({
    source:               initialMission.source               || '',
    mission_type:         initialMission.mission_type         || '',
    incident_type:        initialMission.incident_type        || '',
    incident_description: initialMission.incident_description || '',
    billed_to_name:       initialMission.billed_to_name       || '',
    client_name:          initialMission.client_name          || '',
    client_phone:         initialMission.client_phone         || '',
    client_address:       initialMission.client_address       || '',
    vehicle_plate:        initialMission.vehicle_plate        || '',
    vehicle_brand:        initialMission.vehicle_brand        || '',
    vehicle_model:        initialMission.vehicle_model        || '',
    vehicle_vin:          initialMission.vehicle_vin          || '',
    vehicle_fuel:         initialMission.vehicle_fuel         || '',
    vehicle_gearbox:      initialMission.vehicle_gearbox      || '',
    incident_address:     combineAddress(initialMission.incident_address, initialMission.incident_city),
    incident_lat:         initialMission.incident_lat         != null ? String(initialMission.incident_lat)  : '',
    incident_lng:         initialMission.incident_lng         != null ? String(initialMission.incident_lng)  : '',
    incident_city:        initialMission.incident_city        || '',
    destination_name:     initialMission.destination_name     || '',
    // Destination : nom du lieu (garage, hôtel) en PRÉFIXE de l'adresse → "Garage X, Rue Y"
    destination_address:  initialMission.destination_name && initialMission.destination_address
                            && !initialMission.destination_address.toLowerCase().includes(initialMission.destination_name.toLowerCase())
                            ? `${initialMission.destination_name}, ${initialMission.destination_address}`
                            : (initialMission.destination_address || ''),
    destination_lat:      '',
    destination_lng:      '',
    incident_borne_km:    initialMission.incident_borne_km    || '',
    incident_sens:        initialMission.incident_sens        || '',
    destination_borne_km: initialMission.destination_borne_km || '',
    destination_sens:     initialMission.destination_sens     || '',
    amount_guaranteed:    initialMission.amount_guaranteed != null ? String(initialMission.amount_guaranteed) : '',
    amount_to_collect:    initialMission.amount_to_collect != null  ? String(initialMission.amount_to_collect)  : '',
  })

  // Détection autoroute belge/française : "A" suivi de 1-3 chiffres en début d'adresse,
  // ou mot-clé "autoroute" / "highway".
  const isHighway = (addr: string) =>
    /(^|[\s,])A\d{1,3}\b/.test(addr) || /\b(autoroute|highway)\b/i.test(addr)

  // ── Auto-vérification Google sur chargement ─────────────────────────────────
  // État par adresse : 'idle' | 'checking' | 'confirmed' | 'different' | 'not_found'
  type GeoStatus = { state: 'idle'|'checking'|'confirmed'|'different'|'not_found'; suggestion?: { addr: string; lat: number; lng: number } }
  const [incidentGeo,    setIncidentGeo]    = useState<GeoStatus>({ state: 'idle' })
  const [destinationGeo, setDestinationGeo] = useState<GeoStatus>({ state: 'idle' })

  // Vérification d'adresse via Places API client-side (même moteur que l'autocomplete,
  // bien plus tolérant que Geocoding API pour les adresses abrégées/approximatives).
  const verifyAddress = async (addr: string): Promise<GeoStatus> => {
    if (!addr.trim()) return { state: 'idle' }
    try {
      const r = await verifyAddressViaPlaces(addr, googleMapsKey)
      if (!r) return { state: 'not_found' }
      return {
        state: r.same ? 'confirmed' : 'different',
        suggestion: { addr: r.formatted, lat: r.lat, lng: r.lng },
      }
    } catch {
      return { state: 'not_found' }
    }
  }

  // Persistance silencieuse partielle — pour que d'autres opérations (driver-eta,
  // calcul KM…) puissent lire les champs depuis la DB sans attendre un save manuel.
  // Incrémente automatiquement kmRefresh pour rafraîchir le calcul KM live.
  const silentPatch = (fields: Record<string, any>) => {
    fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(fields),
    }).catch(() => {})
    // Si une donnée KM-relevant change → trigger refresh
    if (Object.keys(fields).some(k => /lat|lng|depot_depart_id|extra_addresses|destination_address|incident_address/.test(k))) {
      setKmRefresh(k => k + 1)
    }
  }

  // Au chargement : vérifier les 2 adresses et appliquer silencieusement la version
  // canonique Google (confirmed OU different — on fait confiance à Places, comme si
  // le dispatcher avait tapé l'adresse et choisi la 1re suggestion). La bannière
  // signale le statut. Le dispatcher peut toujours rouvrir le modal pour corriger.
  useEffect(() => {
    (async () => {
      if (form.incident_address && !initialMission.incident_lat) {
        setIncidentGeo({ state: 'checking' })
        const r = await verifyAddress(form.incident_address)
        setIncidentGeo(r)
        if (r.suggestion && (r.state === 'confirmed' || r.state === 'different')) {
          setForm(prev => ({
            ...prev,
            incident_address: r.suggestion!.addr,
            incident_lat:     String(r.suggestion!.lat),
            incident_lng:     String(r.suggestion!.lng),
          }))
          silentPatch({
            incident_address: r.suggestion!.addr,
            incident_lat:     r.suggestion!.lat,
            incident_lng:     r.suggestion!.lng,
          })
        }
      }
      if (form.destination_address) {
        setDestinationGeo({ state: 'checking' })
        const r = await verifyAddress(form.destination_address)
        setDestinationGeo(r)
        if (r.suggestion && (r.state === 'confirmed' || r.state === 'different')) {
          setForm(prev => ({
            ...prev,
            destination_address: r.suggestion!.addr,
            destination_lat:     String(r.suggestion!.lat),
            destination_lng:     String(r.suggestion!.lng),
          }))
          silentPatch({
            destination_address: r.suggestion!.addr,
            destination_lat:     r.suggestion!.lat,
            destination_lng:     r.suggestion!.lng,
          })
        }
      }
    })()
  }, [])

  // ── Modal de vérification d'adresse ─────────────────────────────────────────
  // Ouverte automatiquement quand le geocoding renvoie "different" ou "not_found".
  // Le dispatcher choisit entre adresse originale, suggestion Google, ou saisie manuelle.
  // Indispensable pour le calcul des kilométrages (sans lat/lng, pas de KM).
  const [activeReview,  setActiveReview]  = useState<'incident'|'destination'|null>(null)

  // Plus d'auto-ouverture : le modal est strictement à la demande du dispatcher
  // (clic "Corriger" sur la bannière "❌ non trouvée"). Pour les cas confirmed/different,
  // l'application est silencieuse et le dispatcher juge sur pièce.
  const closeReview = () => setActiveReview(null)
  const reopenReview = (which: 'incident'|'destination') => setActiveReview(which)

  const [selectedDriver, setSelectedDriver]   = useState(initialMission.assigned_to || '')
  const [showDriverModal, setShowDriverModal] = useState(false)
  const [depots, setDepots]                   = useState<Array<{id:string;name:string;address:string;is_default:boolean}>>([])
  const [depotId, setDepotId]                 = useState<string>(initialMission.depot_depart_id || '')
  // Stops intermédiaires : liste de {id, label, address, lat, lng, sort_order}
  // Le dernier stop = destination dans le calcul KM. Sauvegarde en extra_addresses (JSONB).
  const [stops, setStops]                     = useState<Stop[]>(() => {
    const raw = initialMission.extra_addresses
    return Array.isArray(raw) ? [...raw].sort((a, b) => a.sort_order - b.sort_order) : []
  })

  // Charger la liste des dépôts pour le sélecteur "Dépôt de départ"
  useEffect(() => {
    fetch('/api/depots').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : []
      setDepots(list)
      // Si rien de pré-saisi, défaut = depot is_default
      if (!initialMission.depot_depart_id) {
        const def = list.find((x: any) => x.is_default)
        if (def) setDepotId(def.id)
      }
    }).catch(() => {})
  }, [])
  const [showRawContent, setShowRawContent]   = useState(false)
  const [loadingConfirm, setLoadingConfirm]   = useState(false)
  const [loadingRefuse,  setLoadingRefuse]    = useState(false)
  const [loadingSave,    setLoadingSave]      = useState(false)
  const [brands,         setBrands]           = useState<{id:number;name:string}[]>([])
  const [models,         setModels]           = useState<{id:number;name:string}[]>([])
  const [loadingBrands,  setLoadingBrands]    = useState(false)
  const [loadingIMA,     setLoadingIMA]       = useState(false)
  const [imaSuccess,     setImaSuccess]       = useState(false)
  const [status,         setStatus]           = useState(initialMission.status)
  const [odooTicketUrl,  setOdooTicketUrl]    = useState<string | null>(initialMission.odoo_ticket_url || null)
  const [odooTaskUrl,    setOdooTaskUrl]      = useState<string | null>(initialMission.odoo_task_url || null)
  const [loadingOdoo,    setLoadingOdoo]      = useState(false)
  const [odooError,      setOdooError]        = useState<string | null>(null)

  // ── Date d'intervention (modifiable inline via picker datetime-local) ──
  const dateInputRef = useRef<HTMLInputElement>(null)
  const [interventionDate, setInterventionDate] = useState<string>(
    initialMission.intervention_date
      ? toDateTimeLocalString(new Date(initialMission.intervention_date))
      : ''
  )
  const [isSavingDate, setIsSavingDate] = useState(false)

  const handleInterventionDateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    const previousValue = interventionDate
    setInterventionDate(newValue)
    setIsSavingDate(true)
    try {
      const isoToSave = newValue ? new Date(newValue).toISOString() : null
      const res = await fetch(`/api/missions/${initialMission.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervention_date: isoToSave }),
      })
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`)
    } catch (err) {
      console.error('Erreur save intervention_date:', err)
      setInterventionDate(previousValue)
      alert("Erreur lors de l'enregistrement de la date d'intervention. Réessayez.")
    } finally {
      setIsSavingDate(false)
    }
  }

  // ── Auto-save silent des stops (debounced) — pour que le KM live se base sur la DB à jour ──
  const stopsHydrated = useRef(false)
  useEffect(() => {
    if (!stopsHydrated.current) { stopsHydrated.current = true; return }
    const timer = setTimeout(() => {
      silentPatch({ extra_addresses: stops.length > 0 ? stops : null })
      setKmRefresh(k => k + 1)
    }, 600)
    return () => clearTimeout(timer)
  }, [stops])

  // ── Helpers stops ────────────────────────────────────────────────────────────
  const addStop = () => {
    setStops(prev => [
      ...prev,
      { id: crypto.randomUUID(), type: 'custom', label: '', address: '', lat: null, lng: null, arrived_at: null, sort_order: prev.length },
    ])
  }
  const removeStop = (id: string) => {
    setStops(prev => prev.filter(s => s.id !== id).map((s, i) => ({ ...s, sort_order: i })))
  }
  const updateStop = (id: string, patch: Partial<Stop>) => {
    setStops(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }
  const moveStop = (id: string, dir: -1 | 1) => {
    setStops(prev => {
      const idx = prev.findIndex(s => s.id === id)
      if (idx === -1) return prev
      const target = idx + dir
      if (target < 0 || target >= prev.length) return prev
      const arr = [...prev]
      ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
      return arr.map((s, i) => ({ ...s, sort_order: i }))
    })
  }

  // ── Recherche/lien client Odoo (facturé) ────────────────────────────────────
  const [billedPartnerId, setBilledPartnerId] = useState<number | null>(initialMission.billed_to_id || null)
  const [showCreateClientModal, setShowCreateClientModal] = useState(false)
  const [showRestituerModal, setShowRestituerModal] = useState(false)
  const [showSncDepotModal, setShowSncDepotModal] = useState(false)
  const [clientQuery,     setClientQuery]     = useState('')
  const [clientResults,   setClientResults]   = useState<Array<{id:number;name:string;phone?:string;mobile?:string;city?:string}>>([])
  const [showClientDrop,  setShowClientDrop]  = useState(false)
  const clientTimer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    if (clientQuery.length < 3) { setClientResults([]); return }
    clearTimeout(clientTimer.current)
    clientTimer.current = setTimeout(async () => {
      try {
        const data = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(clientQuery)}`).then(r => r.json())
        setClientResults(data.clients || [])
      } catch {}
    }, 300)
  }, [clientQuery])

  const selectBilledClient = (c: {id:number;name:string}) => {
    setBilledPartnerId(c.id)
    setForm(prev => ({ ...prev, billed_to_name: c.name }))
    setClientQuery('')
    setClientResults([])
    setShowClientDrop(false)
    // Persistance immediate (Olivier 2026-05-25) : sinon la fiche reste avec
    // billed_to_id=null en BDD tant qu on n a pas clique "Sauvegarder", et
    // le modal Facturer affiche "Client : —".
    silentPatch({ billed_to_id: c.id, billed_to_name: c.name })
  }
  const clearBilledClient = () => {
    setBilledPartnerId(null)
    setForm(prev => ({ ...prev, billed_to_name: '' }))
    silentPatch({ billed_to_id: null, billed_to_name: null })
  }

  // ── Recherche/lien véhicule Odoo (par plaque ou VIN) ────────────────────────
  // Si la mission a déjà un odoo_vehicle_id persisté, on initialise l'état avec
  // pour skipper la recherche de suggestions au chargement.
  const [odooVehicleId,    setOdooVehicleId]    = useState<number | null>(initialMission.odoo_vehicle_id || null)
  const [vehicleResults,   setVehicleResults]   = useState<Array<{id:number;plate:string;vin:string;brand:string;model:string;fuel:string;gearbox:string}>>([])
  const [showVehicleDrop,  setShowVehicleDrop]  = useState(false)
  const [vehicleSearched,  setVehicleSearched]  = useState(false)
  const vehicleTimer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    const q = (form.vehicle_plate || '').trim()
    if (q.length < 3) { setVehicleResults([]); setVehicleSearched(false); return }
    if (odooVehicleId) return  // déjà lié (état session ou persisté DB) → on n'écrase pas
    clearTimeout(vehicleTimer.current)
    vehicleTimer.current = setTimeout(async () => {
      try {
        const data = await fetch(`/api/odoo/search-vehicle?q=${encodeURIComponent(q)}`).then(r => r.json())
        setVehicleResults(data.vehicles || [])
        setVehicleSearched(true)
        if ((data.vehicles || []).length > 0) setShowVehicleDrop(true)
      } catch {}
    }, 400)
  }, [form.vehicle_plate, odooVehicleId])

  const selectOdooVehicle = async (v: {id:number;plate:string;vin:string;brand:string;model:string;fuel:string;gearbox:string}) => {
    setOdooVehicleId(v.id)
    // Préserve les valeurs Odoo (source de vérité) sauf si vides → fallback sur le form
    setForm(prev => ({
      ...prev,
      vehicle_plate:   v.plate || prev.vehicle_plate,
      vehicle_brand:   v.brand || prev.vehicle_brand,
      vehicle_model:   v.model || prev.vehicle_model,
      vehicle_vin:     v.vin   || prev.vehicle_vin,
      vehicle_fuel:    v.fuel  || prev.vehicle_fuel,
      vehicle_gearbox: v.gearbox || prev.vehicle_gearbox,
    }))
    setVehicleResults([])
    setShowVehicleDrop(false)

    // Persistance immédiate du lien — le dispatcher n'aura plus à reconfirmer à chaque ouverture
    fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ odoo_vehicle_id: v.id }),
    }).catch(() => {})

    // Charger la liste des modèles pour la marque liée, sinon le <select> Modèle
    // n'a pas l'option correspondante et le champ apparaît vide.
    if (v.brand) {
      const allBrands = brands.length > 0 ? brands : await loadBrands()
      const matched = allBrands.find(b => b.name === v.brand)
                   ?? allBrands.find(b => normalizeBrand(b.name) === normalizeBrand(v.brand))
      if (matched) await loadModels(matched.id)
    }

    // Si le form a un VIN/fuel/boîte que le véhicule Odoo n'a pas → on complète Odoo
    const needsUpdate =
      (form.vehicle_vin     && !v.vin) ||
      (form.vehicle_fuel    && !v.fuel) ||
      (form.vehicle_gearbox && !v.gearbox)
    if (needsUpdate) {
      try {
        await fetch('/api/odoo/update-vehicle', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicle_id: v.id,
            vin:        !v.vin     ? form.vehicle_vin     : undefined,
            fuel:       !v.fuel    ? form.vehicle_fuel    : undefined,
            gearbox:    !v.gearbox ? form.vehicle_gearbox : undefined,
          }),
        })
      } catch {}
    }
  }
  const clearOdooVehicle = () => {
    setOdooVehicleId(null)
    setVehicleSearched(false)
    fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ odoo_vehicle_id: null }),
    }).catch(() => {})
  }

  // Le dispatcher doit choisir explicitement entre un véhicule existant ou créer
  // un nouveau dès lors qu'il y a des matches potentiels en attente.
  // Évite de créer des doublons par inadvertance dans Odoo.
  const vehicleDecisionPending = !odooVehicleId
    && vehicleResults.length > 0
    && (form.vehicle_plate || '').trim().length >= 3

  // Comparaison fuzzy brand/model d'un véhicule Odoo vs ce qui est saisi dans le form
  const vehicleSimilarity = (v: {brand:string;model:string}): 'match' | 'mismatch' | 'unknown' => {
    if (!form.vehicle_brand && !form.vehicle_model) return 'unknown'
    const norm = (s: string) => (s || '').toLowerCase().replace(/[-.\s]/g, '').trim()
    const fuzzy = (a: string, b: string) => {
      const na = norm(a), nb = norm(b)
      if (!na || !nb) return false
      return na.includes(nb) || nb.includes(na)
    }
    const brandOk = !form.vehicle_brand || fuzzy(v.brand, form.vehicle_brand)
    const modelOk = !form.vehicle_model || fuzzy(v.model, form.vehicle_model)
    return brandOk && modelOk ? 'match' : 'mismatch'
  }

  // Auto-lien : si un seul resultat avec plaque exacte + marque/modele coherents
  // (ou vides cote form), on lie sans clic. Couvre le cas nominal (VAB qui prefill
  // brand/model identiques au vehicule Odoo). Le dispatcher peut toujours delier.
  useEffect(() => {
    if (odooVehicleId) return
    if (vehicleResults.length !== 1) return
    const v = vehicleResults[0]
    const norm = (s: string) => (s || '').toLowerCase().replace(/[-.\s]/g, '')
    if (norm(v.plate) !== norm(form.vehicle_plate)) return
    const fuzzy = (a: string, b: string) => {
      const na = norm(a), nb = norm(b)
      if (!na || !nb) return false
      return na.includes(nb) || nb.includes(na)
    }
    const brandOk = !form.vehicle_brand || fuzzy(v.brand, form.vehicle_brand)
    const modelOk = !form.vehicle_model || fuzzy(v.model, form.vehicle_model)
    if (!brandOk || !modelOk) return
    selectOdooVehicle(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleResults, odooVehicleId])

  const [M, setM] = useState<Mission>(initialMission)
  const [saveOk, setSaveOk] = useState(false)
  const [kmRefresh, setKmRefresh] = useState(0)  // incrémenté à chaque save → force le re-calcul des KM

  // Realtime — mise à jour automatique depuis le chauffeur
  useEffect(() => {
    const ch = sb.channel(`dispatch-mission-${initialMission.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'incoming_missions',
        filter: `id=eq.${initialMission.id}`,
      }, payload => {
        const updated = payload.new as any
        setM(prev => ({ ...prev, ...updated }))
        if (updated.status) setStatus(updated.status)
        // Mettre à jour uniquement les champs chauffeur (pas les champs du formulaire dispatch)
        const driverFields = ['driver_photos', 'discharge_data', 'client_signature',
          'closing_notes', 'on_way_at', 'on_site_at', 'completed_at',
          'accepted_at', 'assigned_at', 'parked_at', 'extra_addresses']
        const formUpdates: Partial<typeof form> = {}
        if (updated.vehicle_plate && updated.vehicle_plate !== form.vehicle_plate) formUpdates.vehicle_plate = updated.vehicle_plate
        if (updated.vehicle_brand && updated.vehicle_brand !== form.vehicle_brand) formUpdates.vehicle_brand = updated.vehicle_brand
        if (updated.vehicle_model && updated.vehicle_model !== form.vehicle_model) formUpdates.vehicle_model = updated.vehicle_model
        if (Object.keys(formUpdates).length > 0) setForm(prev => ({ ...prev, ...formUpdates }))
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [initialMission.id])

  // ── Dérogation paiement (workflow validation dispatcher) ───────────────────
  type PendingDerog = { id: string; motive: string; requested_at: string; requester?: { id: string; name: string } | null } | null
  const [pendingDerog, setPendingDerog] = useState<PendingDerog>(null)
  const [derogDecision, setDerogDecision] = useState<'cancelled_amount' | 'adjusted' | 'refused' | null>(null)
  const [derogNewAmount, setDerogNewAmount] = useState('')
  const [derogNote, setDerogNote] = useState('')
  const [derogSubmitting, setDerogSubmitting] = useState(false)
  const [derogError, setDerogError] = useState('')
  const fetchPendingDerog = async () => {
    try {
      const r = await fetch(`/api/missions/${initialMission.id}/payment-derogation`)
      const j = await r.json()
      setPendingDerog(j.derogation || null)
    } catch {}
  }
  useEffect(() => { fetchPendingDerog() }, [initialMission.id])
  // Realtime : si un autre dispatcheur decide, l encart disparait pour les autres
  useEffect(() => {
    const ch = sb.channel(`derogations-${initialMission.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'payment_derogations',
        filter: `mission_id=eq.${initialMission.id}`,
      }, () => { fetchPendingDerog() })
      .subscribe()
    return () => { sb.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMission.id])
  const submitDerogDecision = async () => {
    if (!pendingDerog || !derogDecision) return
    if (derogDecision === 'adjusted') {
      const n = parseFloat(derogNewAmount)
      if (Number.isNaN(n) || n < 0) { setDerogError('Montant invalide'); return }
    }
    setDerogSubmitting(true); setDerogError('')
    try {
      const r = await fetch(`/api/missions/${initialMission.id}/payment-derogation/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          derogation_id: pendingDerog.id,
          decision:      derogDecision,
          new_amount:    derogDecision === 'adjusted' ? parseFloat(derogNewAmount) : undefined,
          note:          derogNote.trim() || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        // 409 = un autre dispatcheur a deja decide → on hide direct
        if (j.already_decided) {
          setPendingDerog(null)
          setDerogDecision(null)
          setDerogError('Déjà traitée par un autre dispatcheur')
          return
        }
        throw new Error(j.error || 'Erreur')
      }
      setPendingDerog(null)
      setDerogDecision(null)
      setDerogNewAmount('')
      setDerogNote('')
      router.refresh()
    } catch (e: any) {
      setDerogError(e.message || 'Erreur')
    } finally {
      setDerogSubmitting(false)
    }
  }

  const f = (k: keyof typeof form) => (v: string) => setForm(prev => ({ ...prev, [k]: v }))

  // Détecter lien IMA dans raw_content
  const imaLink = initialMission.raw_content?.match(/https:\/\/imamobile\.ima\.eu\/[^\s"<>]+/)?.[0] || null

  // Enrichir depuis le portail IMA
  const handleFetchIMA = async () => {
    setLoadingIMA(true)
    setImaSuccess(false)
    try {
      const res  = await fetch('/api/missions/fetch-ima', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: initialMission.id })
      })
      const data = await res.json()
      if (data.ok) {
        setImaSuccess(true)
        setTimeout(() => window.location.reload(), 1500)
      }
    } finally {
      setLoadingIMA(false)
    }
  }

  // Normalisation pour fuzzy match marque/modèle (case + tirets/espaces ignorés)
  const normalizeBrand = (s: string) => (s || '').toLowerCase().replace(/[-.\s]/g, '').trim()

  // Charger les marques depuis l'API véhicules + auto-match insensible à la casse
  const loadBrands = async () => {
    if (brands.length > 0) return brands
    setLoadingBrands(true)
    try {
      const res  = await fetch('/api/vehicles?type=brands')
      const data: {id:number;name:string}[] = await res.json()
      setBrands(data || [])
      return data || []
    } finally { setLoadingBrands(false) }
  }

  const loadModels = async (brandId: number) => {
    const res  = await fetch(`/api/vehicles?type=models&brandId=${brandId}`)
    const data = await res.json()
    setModels(data || [])
    return data || []
  }

  useEffect(() => {
    (async () => {
      if (!form.vehicle_brand || brands.length > 0) return
      const list = await loadBrands()
      // Si le parser a retourné une marque qui matche un brand Odoo (insensible à la casse),
      // on réécrit la valeur du form avec la casse exacte d'Odoo pour que le <select> match.
      const target = normalizeBrand(form.vehicle_brand)
      const matched = list.find(b => normalizeBrand(b.name) === target)
                   ?? list.find(b => normalizeBrand(b.name).includes(target) || target.includes(normalizeBrand(b.name)))
      if (matched) {
        if (matched.name !== form.vehicle_brand) f('vehicle_brand')(matched.name)
        const modelList = await loadModels(matched.id)
        if (form.vehicle_model) {
          const targetModel = normalizeBrand(form.vehicle_model)
          const matchedModel = modelList.find((m: any) => normalizeBrand(m.name) === targetModel)
                            ?? modelList.find((m: any) => normalizeBrand(m.name).includes(targetModel) || targetModel.includes(normalizeBrand(m.name)))
          if (matchedModel && matchedModel.name !== form.vehicle_model) f('vehicle_model')(matchedModel.name)
        }
      }
    })()
  }, [])

  // Sauvegarder les modifications du formulaire
  const handleSave = async () => {
    setLoadingSave(true)
    setSaveOk(false)
    const payload = { ...form, billed_to_id: billedPartnerId, depot_depart_id: depotId || null, extra_addresses: stops.length > 0 ? stops : null, _notify_driver: true }
    const res = await fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    })
    if (res.ok) {
      setSaveOk(true)
      setKmRefresh(k => k + 1)  // force le recalcul des KM avec les nouvelles données DB
      setTimeout(() => setSaveOk(false), 3000)
    }
    setLoadingSave(false)
  }

  // Confirmer la mission
  // driverIdOverride : utilise par DriverPickerModal pour declencher
  // handleConfirm sans dependre du state selectedDriver (qui n est pas
  // encore commit a ce moment)
  const handleConfirm = async (driverIdOverride?: string) => {
    // Validation : client requis avant de confirmer la mission (necessaire
    // pour la facturation future)
    if (!billedPartnerId && !(form.billed_to_name || '').trim()) {
      alert('Client facturé requis. Recherche un client ou tape son nom dans le champ "Client facturé".')
      return
    }
    setLoadingConfirm(true)
    const payload = { ...form, billed_to_id: billedPartnerId, odoo_vehicle_id: odooVehicleId, depot_depart_id: depotId || null, extra_addresses: stops.length > 0 ? stops : null }
    await fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    })

    // Si un véhicule Odoo est lié, propage les champs saisis (VIN/carburant/boîte)
    // qui auraient pu être ajoutés après le clic initial sur la suggestion.
    if (odooVehicleId) {
      fetch('/api/odoo/update-vehicle', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: odooVehicleId,
          vin:        form.vehicle_vin || undefined,
          fuel:       form.vehicle_fuel || undefined,
          gearbox:    form.vehicle_gearbox || undefined,
        }),
      }).catch(() => {})
    }
    const driverToAssign = driverIdOverride ?? selectedDriver
    if (driverToAssign) {
      await fetch('/api/missions/assign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: initialMission.id, driver_id: driverToAssign })
      })
    }
    await fetch('/api/missions/confirm', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mission_id: initialMission.id, action: 'confirm' })
    })
    setStatus('dispatching')
    setLoadingConfirm(false)
    // Créer le dossier dans Odoo FSM (en arrière-plan, sans bloquer)
    createOdooFsmDossier().catch(console.error)
    // On reste sur la fiche — reload pour avoir les boutons/champs adaptes
    // au nouveau statut (badge Odoo task_id, etc.). UX request Olivier 11/05.
    router.refresh()
  }

  // Créer Helpdesk ticket + FSM Task dans Odoo
  const createOdooFsmDossier = async () => {
    setLoadingOdoo(true)
    setOdooError(null)
    try {
      const res = await fetch('/api/fsm/create-mission', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mission_id:          initialMission.id,
          supabase_id:         initialMission.id,
          dossier_number:      initialMission.dossier_number || initialMission.external_id || '',
          source:              initialMission.source?.toUpperCase() || 'PRIVÉ',
          client_name:         form.client_name || 'Client inconnu',
          client_phone:        form.client_phone || '',
          vehicle_plate:       form.vehicle_plate || '',
          vehicle_brand:       form.vehicle_brand || '',
          vehicle_model:       form.vehicle_model || '',
          incident_address:    form.incident_address || '',
          incident_city:       form.incident_city || '',
          destination_address: form.destination_address || '',
          destination_name:    form.destination_name || '',
          description:         form.incident_description || '',
          chauffeur_id:        selectedDriver || '',
        })
      })
      const data = await res.json()
      if (data.ticketUrl) setOdooTicketUrl(data.ticketUrl)
      if (data.taskUrl)   setOdooTaskUrl(data.taskUrl)
    } catch (e: any) {
      setOdooError(e.message)
    } finally {
      setLoadingOdoo(false)
    }
  }

  // Refuser la mission
  const handleRefuse = async () => {
    if (!confirm('Confirmer le refus de cette mission ?')) return
    setLoadingRefuse(true)
    await fetch('/api/missions/confirm', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mission_id: initialMission.id, action: 'refuse' })
    })
    setStatus('ignored')
    setLoadingRefuse(false)
    // On reste sur la fiche pour voir le statut "ignored". UX Olivier 11/05.
    router.refresh()
  }


  const srcInfo    = { label: getSourceLabel(initialMission.source, sources), color: getSourceColor(initialMission.source, sources) }
  const statusInfo = STATUS_LABELS[status] || { label: status, color: 'text-ink-muted' }
  const canEdit    = ['new', 'dispatching'].includes(status)

  return (
    <AppShell
      title={`Mission ${initialMission.external_id}`}
      userName={userName}
      userEmail={userEmail}
      userId={userId}
      userRole={userRole}
      userModules={userModules}
    >
      <style>{`
        @keyframes md-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .md-card-enter { animation: md-fade-up 320ms ease-out both; }
      `}</style>

      {/* Top-bar : badges contextuels + ← retour. backdrop-blur pour fondre avec le bg ambient */}
      <div className="bg-surface/85 backdrop-blur-md border-b px-3 lg:px-8 py-3 lg:py-4 sticky top-0 z-20">
        <div className="flex items-center gap-2 lg:gap-4 flex-wrap min-w-0">
          <Link href="/dispatch" className="text-ink-secondary hover:text-ink transition text-lg flex items-center gap-1.5 flex-shrink-0" title="Retour à la liste dispatch">
            ← <span className="hidden sm:inline text-sm">Dispatch</span>
          </Link>
          <div className="flex items-center gap-2 flex-1 flex-wrap min-w-0">
            <span className={`px-2 py-0.5 rounded-lg text-[10px] lg:text-xs font-bold text-white ${srcInfo.color}`}>
              {srcInfo.label}
            </span>
            {initialMission.dossier_number && (
              <span className="text-ink-muted text-xs lg:text-sm font-mono truncate max-w-[140px]">{initialMission.dossier_number}</span>
            )}
            <span className={`text-xs lg:text-sm font-medium ${statusInfo.color}`}>• {statusInfo.label}</span>
          </div>
          <div className="flex items-center gap-1.5 lg:gap-2 flex-wrap">
            <span className="text-ink-muted text-[10px] lg:text-xs">
              <span className="hidden sm:inline">Reçu le </span>
              {new Date(initialMission.received_at).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
            {initialMission.parse_confidence !== null && (
              <span className={`text-[10px] lg:text-xs px-1.5 py-0.5 rounded-full ${
                initialMission.parse_confidence >= 0.8 ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'
              }`}>
                IA {Math.round(initialMission.parse_confidence * 100)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Ambient gradient blobs — purement decoratif, derriere tout le contenu */}
      <div className="relative overflow-x-hidden">
        <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-50 -z-0">
          <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-gradient-to-br from-brand/15 to-purple-500/10 blur-3xl" />
          <div className="absolute top-1/3 -right-32 w-[480px] h-[480px] rounded-full bg-gradient-to-br from-info/15 to-success/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 w-[380px] h-[380px] rounded-full bg-gradient-to-br from-warning/10 to-brand/5 blur-3xl" />
        </div>
        <div className="relative z-10">

        {/* Dérogation paiement en attente — encart prioritaire pour le dispatcher */}
        {pendingDerog && (
          <div className="px-4 lg:px-8 pt-6">
            <div className="bg-amber-600/15 border-2 border-amber-600/40 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <span className="text-2xl">🆘</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-amber-400 font-semibold text-sm">Dérogation paiement demandée</p>
                    <p className="text-ink-secondary text-xs mt-0.5">
                      Par {pendingDerog.requester?.name || '?'} · {new Date(pendingDerog.requested_at).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-surface/50 rounded-lg p-3 mb-3">
                <p className="text-ink-muted text-xs uppercase tracking-wide mb-1">Motif chauffeur</p>
                <p className="text-ink text-sm whitespace-pre-wrap">{pendingDerog.motive}</p>
              </div>
              {derogDecision == null && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    onClick={() => setDerogDecision('cancelled_amount')}
                    className="px-3 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition"
                  >
                    Annuler le montant
                  </button>
                  <button
                    onClick={() => { setDerogDecision('adjusted'); setDerogNewAmount(String(M.amount_to_collect ?? '')) }}
                    className="px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition"
                  >
                    Ajuster le montant
                  </button>
                  <button
                    onClick={() => setDerogDecision('refused')}
                    className="px-3 py-2.5 bg-critical hover:bg-critical-hover text-white rounded-lg text-sm font-semibold transition"
                  >
                    Refuser
                  </button>
                </div>
              )}
              {derogDecision != null && (
                <div className="space-y-2">
                  {derogDecision === 'adjusted' && (
                    <div>
                      <p className="text-ink-muted text-xs mb-1">Nouveau montant (€)</p>
                      <input
                        type="number" step="0.01" min={0}
                        value={derogNewAmount}
                        onChange={e => setDerogNewAmount(e.target.value)}
                        className="w-full bg-surface border rounded-lg px-3 py-2 text-ink text-sm outline-none focus:border-brand"
                      />
                    </div>
                  )}
                  <div>
                    <p className="text-ink-muted text-xs mb-1">Note (optionnel, envoyée au chauffeur)</p>
                    <input
                      type="text"
                      value={derogNote}
                      onChange={e => setDerogNote(e.target.value)}
                      placeholder="Ex : OK suite vérification téléphonique"
                      className="w-full bg-surface border rounded-lg px-3 py-2 text-ink text-sm outline-none focus:border-brand"
                    />
                  </div>
                  {derogError && <p className="text-red-400 text-xs">⚠️ {derogError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setDerogDecision(null); setDerogNewAmount(''); setDerogNote(''); setDerogError('') }}
                      disabled={derogSubmitting}
                      className="flex-1 px-3 py-2.5 bg-surface-hover text-ink-secondary rounded-lg text-sm transition"
                    >
                      Retour
                    </button>
                    <button
                      onClick={submitDerogDecision}
                      disabled={derogSubmitting}
                      className="flex-1 px-3 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition"
                    >
                      {derogSubmitting ? '⏳…' : 'Confirmer'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Auto-dispatch en cours — affiche l'etape courante (assignation/appel) */}
        {autoDispatchStatus && (
          <div className="px-4 lg:px-8 pt-6">
            <div className="flex items-center gap-2 px-3 py-2 bg-brand/10 border border-brand/30 rounded-xl">
              <span className="text-brand text-sm animate-pulse">⚡</span>
              <span className="text-brand text-sm font-medium flex-1">{autoDispatchStatus}</span>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm('Stopper la procedure auto-dispatch en cours ?')) return
                  try {
                    const r = await fetch('/api/auto-dispatch/cancel', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ mission_id: initialMission.id }),
                    })
                    if (!r.ok) {
                      const j = await r.json().catch(() => ({}))
                      alert(`Erreur : ${j.error || r.status}`)
                      return
                    }
                    router.refresh()
                  } catch (e: any) {
                    alert(`Erreur reseau : ${e.message || e}`)
                  }
                }}
                title="Stopper la procedure auto-dispatch (sans assigner de chauffeur)"
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-critical hover:bg-critical-hover text-white rounded-lg text-xs font-bold transition"
              >
                🛑 Stop
              </button>
            </div>
          </div>
        )}

        {/* ── Barre Date d'intervention ─────────────────────────── */}
        <div className="px-4 lg:px-8 pt-6">
          <div
            onClick={() => {
              const el = dateInputRef.current
              if (!el) return
              if (typeof (el as any).showPicker === 'function') (el as any).showPicker()
              else { el.focus(); el.click() }
            }}
            className="relative bg-brand-soft border-2 border-brand rounded-xl p-4 flex items-center gap-4 cursor-pointer transition-all duration-150 hover:bg-brand hover:-translate-y-0.5 hover:shadow-lg group"
          >
            <div className="w-11 h-11 rounded-lg bg-brand/15 flex items-center justify-center flex-shrink-0 group-hover:bg-white/20 transition-colors">
              <span className="text-2xl">📅</span>
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wide text-brand group-hover:text-white transition-colors">
                Date d'intervention
              </span>
              <span className="text-lg font-bold text-brand group-hover:text-white transition-colors tabular-nums truncate">
                {formatInterventionDate(interventionDate)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-3.5 py-2 bg-brand/10 group-hover:bg-white/20 rounded-lg text-brand group-hover:text-white text-xs font-semibold transition-all flex-shrink-0">
              <Pencil className="w-3.5 h-3.5" />
              <span>{isSavingDate ? 'Enregistrement…' : 'Modifier'}</span>
            </div>
            <input
              ref={dateInputRef}
              type="datetime-local"
              value={interventionDate}
              onChange={handleInterventionDateChange}
              className="absolute opacity-0 pointer-events-none w-0 h-0"
              aria-label="Modifier la date et l'heure d'intervention"
            />
          </div>
        </div>

        {/* ⚠ Particularites/warnings dispatch — bandeau ROUGE bien visible
            (Olivier 2026-05-25 : "info importante" pour chauffeur + bureau). */}
        {Array.isArray(initialMission.warnings) && initialMission.warnings.length > 0 && (
          <div className="px-4 lg:px-8 pt-4">
            <div className="bg-red-500/10 border-2 border-red-500/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">⚠️</span>
                <p className="text-red-500 text-sm font-bold uppercase tracking-wide">
                  Particularités à connaître
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {initialMission.warnings.map((w, i) => (
                  <span key={i} className="inline-flex items-center px-3 py-1.5 bg-red-500/15 border border-red-500/40 rounded-lg text-red-500 text-sm font-medium">
                    {w}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Bandeau Position parc (visible si mission parked avec zone) ── */}
        {status === 'parked' && initialMission.parc_zone_key && (
          <div className="px-4 lg:px-8 pt-4">
            <div className="bg-amber-500/10 border-2 border-amber-500/40 rounded-xl p-4 flex items-center gap-4">
              <div className="w-11 h-11 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <span className="text-2xl">🅿️</span>
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[11px] font-bold uppercase tracking-wide text-amber-500">
                  Position parc
                </span>
                <span className="text-lg font-bold text-ink truncate">
                  Zone <span className="font-mono">{initialMission.parc_zone_key}</span>
                  {initialMission.parc_row_number != null && (
                    <> · Rang <span className="font-mono">{initialMission.parc_row_number}</span></>
                  )}
                  {initialMission.parc_slot_index != null && (
                    <> · Slot <span className="font-mono">{initialMission.parc_slot_index}</span></>
                  )}
                  {initialMission.park_stage_name && (
                    <span className="text-ink-muted font-normal text-sm"> — {initialMission.park_stage_name}</span>
                  )}
                </span>
              </div>
              <a href="/fourriere/plan"
                className="px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 rounded-lg text-amber-600 text-xs font-semibold flex-shrink-0 transition">
                Voir le plan parc →
              </a>
            </div>
          </div>
        )}

        <div className="flex-1 px-8 py-6">
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_288px] gap-6">

            {/* ── Colonne main : formulaire ──────────────────────────
                Sub-phase C : 2 lignes en 2-cols (Clients / Véhicule+Intervention)
                + 1 ligne pleine largeur (Adresses), puis sections en-dessous
                inchangées (Montants / Compte rendu / Contenu brut). */}
            <div className="space-y-5 min-w-0">

              {/* Ligne 1 : Client facturé + Client assisté */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">

                {/* Client facturé */}
                <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter flex flex-col h-full">
                  <h2 className="text-ink font-semibold text-sm mb-4 flex items-center gap-2">
                    <span>🧾</span> Client facturé
                  </h2>

                  {/* Recherche Odoo */}
                  <div className="relative mb-3">
                    <label className="block text-ink-muted text-xs mb-1.5">Rechercher un client</label>
                    <input
                      value={clientQuery}
                      onChange={e => { setClientQuery(e.target.value); setShowClientDrop(true) }}
                      onFocus={() => setShowClientDrop(true)}
                      onBlur={() => setTimeout(() => setShowClientDrop(false), 150)}
                      placeholder="Min. 3 caractères — nom ou téléphone..."
                      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint"
                    />
                    {showClientDrop && clientResults.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border rounded-xl shadow-xl overflow-hidden max-h-64 overflow-y-auto">
                        {clientResults.map(c => (
                          <button key={c.id} type="button" onMouseDown={() => selectBilledClient(c)}
                            className="w-full text-left px-4 py-3 hover:bg-surface-hover transition border-b border last:border-0">
                            <p className="text-ink text-sm font-medium">{c.name}</p>
                            <p className="text-ink-muted text-xs">{[c.phone || c.mobile, c.city].filter(Boolean).join(' · ')}</p>
                          </button>
                        ))}
                        <button
                          type="button"
                          onMouseDown={() => { setShowClientDrop(false); setShowCreateClientModal(true) }}
                          className="w-full text-left px-4 py-3 bg-brand/5 hover:bg-brand/10 transition border-t border-brand/30"
                        >
                          <p className="text-brand text-sm font-semibold">＋ Créer un nouveau client</p>
                          <p className="text-ink-muted text-xs">Aucun de ces résultats ne convient ? Ouvre le formulaire de création.</p>
                        </button>
                      </div>
                    )}
                    {showClientDrop && clientQuery.trim().length >= 3 && clientResults.length === 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border rounded-xl shadow-xl overflow-hidden">
                        <div className="px-4 py-3 text-ink-muted text-xs">
                          Aucun client trouvé pour <span className="font-mono">{clientQuery}</span>.
                        </div>
                        <button
                          type="button"
                          onMouseDown={() => { setShowClientDrop(false); setShowCreateClientModal(true) }}
                          className="w-full text-left px-4 py-3 bg-brand/5 hover:bg-brand/10 transition border-t border-brand/30"
                        >
                          <p className="text-brand text-sm font-semibold">＋ Créer ce client</p>
                          <p className="text-ink-muted text-xs">Formulaire pré-rempli avec "{clientQuery}"</p>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Badge lien Odoo */}
                  {billedPartnerId && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-success-soft border border-success rounded-xl mb-3">
                      <span className="text-success text-xs">✓ Client lié</span>
                      <span className="text-success text-xs font-medium">{form.billed_to_name}</span>
                      <button type="button" onClick={clearBilledClient}
                        className="ml-auto text-ink-muted hover:text-critical text-xs">✕</button>
                    </div>
                  )}

                  <Field label="Nom / Raison sociale">
                    <Input
                      value={form.billed_to_name}
                      onChange={f('billed_to_name')}
                      placeholder="Rempli automatiquement via la recherche ci-dessus"
                      readOnly
                      title="Champ en lecture seule — passe par la recherche ou clique sur '＋ Créer un nouveau client' si introuvable"
                    />
                  </Field>
                  {!billedPartnerId && form.billed_to_name && (
                    <p className="text-warning text-xs mt-1.5">⚠ Pas de client lié — un nouveau sera créé à la confirmation.</p>
                  )}
                </div>

                {/* Client assisté */}
                <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter flex flex-col h-full">
                  <h2 className="text-ink font-semibold text-sm mb-4 flex items-center gap-2">
                    <span>👤</span> Client assisté (personne en panne)
                  </h2>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Nom complet">
                      <Input value={form.client_name} onChange={f('client_name')} placeholder="Prénom Nom" />
                    </Field>
                    <Field label="Téléphone">
                      <Input value={form.client_phone} onChange={f('client_phone')} placeholder="+32..." />
                    </Field>
                    <div className="col-span-2">
                      <AddressField
                        label="Adresse domicile"
                        value={form.client_address}
                        onChange={f('client_address')}
                        gmKey={googleMapsKey}
                        placeholder="Rue, numéro, ville..."
                      />
                    </div>
                  </div>
                </div>

              </div>

              {/* Ligne 2 : Véhicule + Intervention */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">

                {/* Véhicule */}
                <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter flex flex-col h-full">
                  <h2 className="text-ink font-semibold text-sm mb-4 flex items-center gap-2">
                    <span>🚗</span> Véhicule
                  </h2>

                  {/* Badge lien véhicule Odoo + lookup automatique par plaque */}
                  {odooVehicleId && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-success-soft border border-success rounded-xl mb-4">
                      <span className="text-success text-xs">✓ Lié Odoo véhicule #{odooVehicleId}</span>
                      <button type="button" onClick={clearOdooVehicle}
                        className="ml-auto text-ink-muted hover:text-critical text-xs">Délier ✕</button>
                    </div>
                  )}
                  {!odooVehicleId && vehicleSearched && vehicleResults.length === 0 && form.vehicle_plate.trim().length >= 3 && (
                    <p className="text-warning text-xs mb-3">⚠ Aucun véhicule connu avec cette plaque — un nouveau sera créé à la confirmation.</p>
                  )}
                  {!odooVehicleId && vehicleResults.length > 0 && (
                    <div className="mb-4 bg-surface border border-brand/30 rounded-xl p-3">
                      <p className="text-ink-secondary text-xs mb-2">{vehicleResults.length} véhicule(s) trouvé(s) — clique pour lier (évite le doublon) :</p>
                      <div className="space-y-1">
                        {vehicleResults.map(v => {
                          const sim = vehicleSimilarity(v)
                          return (
                            <button key={v.id} type="button" onClick={() => selectOdooVehicle(v)}
                              className={`w-full text-left px-3 py-2 border rounded-lg transition ${
                                sim === 'match'    ? 'bg-success-soft hover:bg-success-soft border-success'    :
                                sim === 'mismatch' ? 'bg-warning-soft hover:bg-warning-soft border-warning'    :
                                                      'bg-surface hover:bg-surface-2 border'
                              }`}>
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-ink text-sm">
                                  <span className="font-mono font-semibold">{v.plate}</span>
                                  <span className="text-ink-secondary ml-2">{[v.brand, v.model].filter(Boolean).join(' ')}</span>
                                </p>
                                {sim === 'match'    && <span className="text-success text-xs">✓ correspond</span>}
                                {sim === 'mismatch' && <span className="text-warning text-xs">⚠ marque/modèle ≠</span>}
                              </div>
                              {v.vin && <p className="text-ink-muted text-xs">VIN: {v.vin}</p>}
                            </button>
                          )
                        })}
                      </div>
                      {/* Forcer la création d'un nouveau si l'utilisateur juge qu'aucun résultat ne correspond */}
                      {form.vehicle_plate.trim().length >= 3 && (
                        <button type="button" onClick={() => { setVehicleResults([]); setVehicleSearched(true) }}
                          className="mt-2 w-full text-center px-3 py-2 bg-surface hover:bg-surface-2 border border-dashed rounded-lg text-ink-secondary hover:text-ink text-xs transition">
                          ➕ Aucun ne correspond — créer un nouveau véhicule
                        </button>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-4">
                    <Field label="Plaque">
                      <div className="flex gap-1.5">
                        <Input value={form.vehicle_plate} onChange={f('vehicle_plate')} placeholder="1ABC234" />
                        <ScanButton mode="plate" value={form.vehicle_plate || ''} onScan={f('vehicle_plate')}
                          className="px-2.5 bg-brand/10 text-brand rounded-xl text-sm flex items-center" label="📷" />
                      </div>
                    </Field>
                    <Field label="Marque">
                      <select
                        value={form.vehicle_brand}
                        onFocus={loadBrands}
                        onChange={e => {
                          const b = brands.find(b => b.name === e.target.value)
                          f('vehicle_brand')(e.target.value)
                          f('vehicle_model')('')
                          setModels([])
                          if (b) loadModels(b.id)
                        }}
                        className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand"
                      >
                        <option value="">{loadingBrands ? 'Chargement...' : '— Sélectionner —'}</option>
                        {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Modèle">
                      {models.length > 0 ? (
                        <select value={form.vehicle_model} onChange={e => f('vehicle_model')(e.target.value)}
                          className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand">
                          <option value="">— Sélectionner —</option>
                          {models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                          <option value="_custom">Autre (saisie libre)</option>
                        </select>
                      ) : (
                        <Input value={form.vehicle_model} onChange={f('vehicle_model')} placeholder={form.vehicle_brand ? 'Saisie libre...' : "Choisir une marque d'abord"} />
                      )}
                    </Field>
                    <Field label="Carburant">
                      <Select value={form.vehicle_fuel} onChange={f('vehicle_fuel')} options={FUEL_TYPES} />
                    </Field>
                    <Field label="Boîte de vitesses">
                      <Select value={form.vehicle_gearbox} onChange={f('vehicle_gearbox')} options={GEARBOX_TYPES} />
                    </Field>
                    <Field label="N° Châssis (VIN)">
                      <div className="flex gap-1.5">
                        <Input value={form.vehicle_vin} onChange={f('vehicle_vin')} placeholder="VIN..." />
                        <ScanButton mode="vin" value={form.vehicle_vin || ''} onScan={f('vehicle_vin')}
                          className="px-2.5 bg-brand/10 text-brand rounded-xl text-sm flex items-center" label="📷" />
                      </div>
                    </Field>
                  </div>
                </div>

                {/* Intervention */}
                <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter flex flex-col h-full">
                  <h2 className="text-ink font-semibold text-sm mb-4 flex items-center gap-2">
                    <span>📋</span> Intervention
                  </h2>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Source (apporteur)">
                      <DynamicSourceSelect value={form.source} onChange={f('source')} />
                    </Field>
                    <Field label="Type de mission">
                      <Select value={form.mission_type} onChange={f('mission_type')} options={MISSION_TYPES} />
                    </Field>
                    <Field label="Type d'incident">
                      <Input value={form.incident_type} onChange={f('incident_type')} placeholder="Ex: pneu crevé, batterie..." />
                    </Field>
                    <div className="col-span-2">
                      <Field label="Description de l'incident">
                        <textarea
                          value={form.incident_description}
                          onChange={e => f('incident_description')(e.target.value)}
                          rows={3}
                          className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand resize-none placeholder:text-ink-faint"
                          placeholder="Description complète..."
                        />
                      </Field>
                    </div>
                  </div>
                </div>

              </div>

              {/* Lieu d'intervention / Destination */}
              {(() => {
                // Pas de destination pour :
                //  - DSP / Réparation sur place : pas de remorquage
                //  - Trajet vide / DPR (déplacement) : la destination est le prochain point
                //    d'intervention, géré séparément
                const noDestination = ['depannage', 'dsp', 'reparation_place', 'trajet_vide'].includes((form.mission_type || '').toLowerCase().trim())
                return (
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                <h2 className="text-ink font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>📍</span> {noDestination ? 'Lieu d\'intervention' : 'Lieu d\'intervention / Destination'}
                </h2>
                <div className={noDestination ? '' : 'grid grid-cols-2 gap-6'}>
                  <div className="space-y-3">
                    {!noDestination && <p className="text-ink-muted text-xs font-medium uppercase tracking-wide">Lieu d'incident</p>}
                    <AddressField
                      label="Adresse complète"
                      value={form.incident_address}
                      onChange={v => { f('incident_address')(v); setIncidentGeo({ state: 'idle' }) }}
                      onSelect={(addr, lat, lng, city) => {
                        setForm(prev => ({
                          ...prev,
                          incident_address: addr,
                          incident_lat:     String(lat),
                          incident_lng:     String(lng),
                          ...(city ? { incident_city: city } : {}),
                        }))
                        setIncidentGeo({ state: 'confirmed', suggestion: { addr, lat, lng } })
                        silentPatch({ incident_address: addr, incident_lat: lat, incident_lng: lng, ...(city ? { incident_city: city } : {}) })
                      }}
                      gmKey={googleMapsKey}
                      placeholder="Tapez et choisissez une suggestion Google..."
                    />
                    <GeoStatusBanner status={incidentGeo} onReview={() => reopenReview('incident')} />
                    {initialMission.incident_address && initialMission.incident_address !== form.incident_address && (
                      <p className="text-ink-faint text-xs">📥 Reçu : <span className="text-ink-muted">{initialMission.incident_address}</span></p>
                    )}
                    {isHighway(form.incident_address) && (
                      <div className="grid grid-cols-2 gap-3 p-3 bg-warning-soft border border-warning rounded-xl">
                        <div className="col-span-2 flex items-center gap-2 text-warning text-xs font-medium">
                          🛣️ Autoroute détectée
                        </div>
                        <Field label="Borne kilométrique">
                          <Input value={form.incident_borne_km} onChange={f('incident_borne_km')} placeholder="Ex: 132.5 ou 132+200" />
                        </Field>
                        <Field label="Sens de circulation">
                          <Input value={form.incident_sens} onChange={f('incident_sens')} placeholder="Ex: vers Liège" />
                        </Field>
                      </div>
                    )}
                  </div>
                  {!noDestination && (
                  <div className="space-y-3">
                    <p className="text-ink-muted text-xs font-medium uppercase tracking-wide">Destination</p>
                    <AddressField
                      label="Adresse complète (nom de lieu inclus si garage, hôtel…)"
                      value={form.destination_address}
                      onChange={v => { f('destination_address')(v); setDestinationGeo({ state: 'idle' }) }}
                      onSelect={(addr, lat, lng, _city, name) => {
                        setForm(prev => ({
                          ...prev,
                          destination_address: addr,
                          destination_lat:     String(lat),
                          destination_lng:     String(lng),
                          ...(name ? { destination_name: name } : {}),
                        }))
                        setDestinationGeo({ state: 'confirmed', suggestion: { addr, lat, lng } })
                        silentPatch({ destination_address: addr, destination_lat: lat, destination_lng: lng, ...(name ? { destination_name: name } : {}) })
                      }}
                      gmKey={googleMapsKey}
                      placeholder="Ex: Garage Citroën Verviers, Rue..."
                    />
                    <GeoStatusBanner status={destinationGeo} onReview={() => reopenReview('destination')} />
                    {isHighway(form.destination_address) && (
                      <div className="grid grid-cols-2 gap-3 p-3 bg-warning-soft border border-warning rounded-xl">
                        <div className="col-span-2 flex items-center gap-2 text-warning text-xs font-medium">
                          🛣️ Autoroute détectée
                        </div>
                        <Field label="Borne kilométrique">
                          <Input value={form.destination_borne_km} onChange={f('destination_borne_km')} placeholder="Ex: 132.5" />
                        </Field>
                        <Field label="Sens de circulation">
                          <Input value={form.destination_sens} onChange={f('destination_sens')} placeholder="Ex: vers Bruxelles" />
                        </Field>
                      </div>
                    )}
                  </div>
                  )}
                </div>
              </div>
                )
              })()}

              {/* Stops intermédiaires (REM uniquement) */}
              {!['depannage', 'dsp', 'reparation_place', 'trajet_vide'].includes((form.mission_type || '').toLowerCase().trim()) && (
                <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-ink font-semibold text-sm flex items-center gap-2">
                      <span>🛣️</span> Stops intermédiaires
                    </h2>
                    <button type="button" onClick={addStop}
                      className="px-3 py-1.5 bg-surface border hover:border-brand text-ink text-xs rounded-lg transition">
                      + Ajouter un stop
                    </button>
                  </div>

                  {stops.length === 0 ? (
                    <p className="text-ink-faint text-xs">Aucun stop. La destination ci-dessus est l'arrivée finale.</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-ink-muted text-xs">
                        Le dernier stop est l'arrivée finale (la destination renseignée plus haut sera ignorée si des stops existent).
                      </p>
                      {stops.map((s, idx) => (
                        <div key={s.id} className="flex items-start gap-2 p-3 bg-surface border rounded-xl">
                          <div className="flex flex-col gap-1 pt-1.5">
                            <button type="button" disabled={idx === 0} onClick={() => moveStop(s.id, -1)}
                              className="w-6 h-6 flex items-center justify-center rounded bg-surface-hover text-ink-secondary disabled:opacity-20 hover:bg-surface-2 text-xs">▲</button>
                            <button type="button" disabled={idx === stops.length - 1} onClick={() => moveStop(s.id, 1)}
                              className="w-6 h-6 flex items-center justify-center rounded bg-surface-hover text-ink-secondary disabled:opacity-20 hover:bg-surface-2 text-xs">▼</button>
                          </div>
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold ${idx === stops.length - 1 ? 'text-info' : 'text-ink-muted'}`}>
                                {idx === stops.length - 1 ? '🏁 Arrivée' : `Stop ${idx + 1}`}
                              </span>
                              <input value={s.label}
                                onChange={e => updateStop(s.id, { label: e.target.value })}
                                placeholder="Label (optionnel)"
                                className="flex-1 bg-surface border rounded-lg px-2 py-1 text-ink text-xs focus:outline-none focus:border-brand placeholder:text-ink-faint" />
                            </div>
                            <AddressField
                              value={s.address}
                              onChange={v => updateStop(s.id, { address: v })}
                              onSelect={(addr, lat, lng) => updateStop(s.id, { address: addr, lat, lng })}
                              gmKey={googleMapsKey}
                              placeholder="Adresse — tape et choisis Google..." />
                          </div>
                          <button type="button" onClick={() => removeStop(s.id)}
                            className="w-7 h-7 flex items-center justify-center rounded bg-critical-soft hover:bg-critical-soft text-critical text-sm">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Montant garanti + Paiement client */}
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                <h2 className="text-ink font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>💶</span> Montants
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Montant garanti (EUR HTVA)">
                    <Input value={form.amount_guaranteed} onChange={f('amount_guaranteed')} placeholder="0.00" />
                  </Field>
                  <Field label="Paiement à réclamer au client (€)">
                    <Input value={form.amount_to_collect} onChange={f('amount_to_collect')} placeholder="0.00" />
                  </Field>
                </div>
              </div>

              {/* Compte rendu cloture — visible des que le chauffeur a fini (to_invoice) */}
              {(initialMission.status === 'completed' || initialMission.status === 'to_invoice') && (
                <div className="bg-surface border border-success rounded-2xl p-5">
                  <h2 className="text-ink font-semibold text-sm mb-4 flex items-center gap-2">
                    <span>🏁</span> Compte rendu de mission
                  </h2>
                  <div className="space-y-3">
                    {initialMission.vehicle_mileage && (
                      <div><p className="text-ink-muted text-xs">Kilométrage</p>
                        <p className="text-ink text-sm font-semibold">{initialMission.vehicle_mileage.toLocaleString()} km</p></div>
                    )}
                    {initialMission.closing_notes && (
                      <div><p className="text-ink-muted text-xs">Notes</p>
                        <p className="text-ink text-sm whitespace-pre-wrap">{initialMission.closing_notes}</p></div>
                    )}
                    {initialMission.amount_collected && (
                      <div className="bg-success-soft border border-success rounded-xl p-3">
                        <p className="text-ink-muted text-xs">Encaissement</p>
                        <p className="text-success font-bold text-lg">{initialMission.amount_collected} €</p>
                        {initialMission.payment_method && <p className="text-ink-secondary text-xs capitalize">{initialMission.payment_method}</p>}
                      </div>
                    )}
                    {initialMission.client_signature && (
                      <div>
                        <p className="text-ink-muted text-xs mb-1">Signature — {initialMission.client_signature_name}</p>
                        <div className="border rounded-xl overflow-hidden bg-surface">
                          <img src={initialMission.client_signature} alt="Signature" className="w-full max-h-24 object-contain" />
                        </div>
                      </div>
                    )}
                    {initialMission.driver_photos && initialMission.driver_photos.length > 0 && (
                      <div>
                        <p className="text-ink-muted text-xs mb-2">Photos ({initialMission.driver_photos.length})</p>
                        <div className="grid grid-cols-3 gap-2">
                          {initialMission.driver_photos.map((url: string, i: number) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt={`Photo ${i+1}`} className="w-full aspect-square object-cover rounded-xl" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Décharges */}
                    {(() => {
                      const discharges = initialMission.discharge_data?.length
                        ? initialMission.discharge_data
                        : initialMission.discharge_motif
                          ? [{ motif: initialMission.discharge_motif, name: initialMission.discharge_name || '', sig: initialMission.discharge_sig || '' }]
                          : []
                      if (!discharges.length) return null
                      return (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-ink-muted text-xs">Décharge{discharges.length > 1 ? 's' : ''} ({discharges.length})</p>
                            <a
                              href={`/api/missions/${initialMission.id}/discharge-pdf`}
                              target="_blank" rel="noreferrer"
                              className="text-xs px-3 py-1 bg-info-soft border border-info text-info rounded-lg hover:bg-info-soft transition"
                            >
                              📄 Télécharger PDF
                            </a>
                          </div>
                          <div className="space-y-2">
                            {discharges.map((d, i) => (
                              <div key={i} className="bg-surface border border-warning rounded-xl p-3 space-y-2">
                                <p className="text-warning text-xs font-medium">Décharge {discharges.length > 1 ? i + 1 : ''}</p>
                                <p className="text-ink-secondary text-xs whitespace-pre-wrap">{d.motif}</p>
                                {d.name && <p className="text-ink-muted text-xs">Signataire : <span className="text-ink-secondary">{d.name}</span></p>}
                                {d.sig && (
                                  <div className="border rounded-lg overflow-hidden bg-surface">
                                    <img src={d.sig} alt="Signature" className="w-full max-h-16 object-contain" />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* Encart facturation — visible des to_invoice ou completed */}
              {(initialMission.status === 'to_invoice' || initialMission.status === 'completed') && (
                <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                  <h2 className="text-ink font-semibold text-sm mb-3 flex items-center gap-2">
                    <span>🧾</span> Facturation
                  </h2>
                  {initialMission.status === 'to_invoice' ? (
                    <div className="bg-warning-soft border border-warning rounded-xl p-3">
                      <p className="text-warning text-sm font-semibold">⏳ En attente de validation facturation</p>
                      <p className="text-warning text-xs mt-1">À traiter depuis la page <a href="/facturation" className="underline">Facturation</a>.</p>
                    </div>
                  ) : initialMission.invoice_method === 'auto' ? (
                    <div className="bg-success-soft border border-success rounded-xl p-3">
                      <p className="text-success text-sm font-semibold">⚡ Auto-facturée</p>
                      <p className="text-ink-muted text-xs mt-1">Validation directe dans le système assisteur.</p>
                    </div>
                  ) : initialMission.invoice_number ? (
                    <div className="bg-success-soft border border-success rounded-xl p-3 space-y-2">
                      <p className="text-success text-sm font-semibold">✓ Facturée</p>
                      <p className="text-ink-secondary text-sm">
                        N° : <span className="font-mono text-ink">{initialMission.invoice_number}</span>
                      </p>
                      {initialMission.invoice_url ? (
                        <a href={initialMission.invoice_url} target="_blank" rel="noreferrer"
                           className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-info hover:bg-info-hover text-white rounded-lg text-xs font-semibold transition">
                          📄 Voir la facture
                        </a>
                      ) : (
                        <p className="text-ink-muted text-xs italic">Lien Odoo en cours de résolution (cron)…</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-ink-muted text-sm">Statut terminé sans données facturation.</p>
                  )}
                </div>
              )}

              {/* Contenu brut */}
              <div className="bg-surface border rounded-2xl overflow-hidden">
                <button
                  onClick={() => setShowRawContent(!showRawContent)}
                  className="w-full flex items-center justify-between px-5 py-3 text-ink-secondary hover:text-ink text-sm transition"
                >
                  <span className="flex items-center gap-2">
                    <span>📄</span>
                    Contenu brut ({initialMission.source_format?.toUpperCase()})
                  </span>
                  <span>{showRawContent ? '▲' : '▼'}</span>
                </button>
                {showRawContent && initialMission.raw_content && (
                  <pre className="px-5 pb-4 text-xs text-ink-secondary font-mono overflow-x-auto whitespace-pre-wrap border-t border pt-3 max-h-96 overflow-y-auto">
                    {initialMission.raw_content}
                  </pre>
                )}
              </div>

              {/* Remarques dispatcher (notes + pièces jointes) */}
              <MissionRemarks missionId={initialMission.id} />
            </div>

            {/* ── Colonne droite : actions + chauffeur + logs ───────── */}
            <div className="space-y-5">

              {/* Actions */}
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter space-y-3">

                {/* Avertissement véhicule en attente de décision — bloque save/confirm */}
                {vehicleDecisionPending && (
                  <div className="bg-warning-soft border border-warning rounded-xl px-3 py-2.5">
                    <p className="text-warning text-xs font-semibold mb-1">⚠ Véhicule à valider</p>
                    <p className="text-warning text-xs">
                      Choisis « Lier » sur un véhicule existant ou clique « Aucun ne correspond — créer un nouveau véhicule » pour pouvoir sauvegarder.
                    </p>
                  </div>
                )}

                {/* Statut new → Confirmer / Refuser */}
                {status === 'new' && (
                  <>
                    <button
                      onClick={() => handleConfirm()}
                      disabled={loadingConfirm || vehicleDecisionPending}
                      className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-sm transition disabled:opacity-50"
                    >
                      {loadingConfirm ? 'Confirmation...' : '✅ Confirmer la mission'}
                    </button>
                    <button
                      onClick={handleRefuse}
                      disabled={loadingRefuse}
                      className="w-full py-3 bg-surface hover:bg-critical-soft border hover:border-critical text-ink-secondary hover:text-critical rounded-xl font-medium text-sm transition disabled:opacity-50"
                    >
                      {loadingRefuse ? 'Refus...' : '❌ Refuser'}
                    </button>
                    <div className="border-t border pt-3">
                      <button
                        onClick={handleSave}
                        disabled={loadingSave || vehicleDecisionPending}
                        className="w-full py-2.5 bg-surface hover:bg-surface-hover border text-ink-secondary hover:text-ink rounded-xl text-sm transition disabled:opacity-50"
                      >
                        {loadingSave ? 'Sauvegarde...' : saveOk ? '✅ Sauvegardé !' : '💾 Sauvegarder'}
                      </button>
                    </div>
                  </>
                )}

                {/* Statut dispatching → save (modif possible) + indication + Annuler */}
                {status === 'dispatching' && (
                  <>
                    <div className="text-center py-2">
                      <span className="text-info font-semibold text-sm">📡 En attente d'assignation</span>
                      <p className="text-ink-muted text-xs mt-1">Clique « Choisir un chauffeur » plus haut pour assigner</p>
                    </div>
                    <button
                      onClick={handleSave}
                      disabled={loadingSave || vehicleDecisionPending}
                      className="w-full py-3 bg-brand hover:bg-brand/80 text-white rounded-xl font-semibold text-sm transition disabled:opacity-50"
                    >
                      {loadingSave ? 'Sauvegarde...' : saveOk ? '✅ Sauvegardé !' : '💾 Sauvegarder les modifications'}
                    </button>
                    <button
                      onClick={handleRefuse}
                      disabled={loadingRefuse}
                      className="w-full py-2.5 bg-surface hover:bg-critical-soft border hover:border-critical text-ink-secondary hover:text-critical rounded-xl font-medium text-sm transition disabled:opacity-50"
                    >
                      {loadingRefuse ? 'Annulation...' : '🚫 Annuler la mission'}
                    </button>
                  </>
                )}

                {/* Autres statuts — statut + sauvegarder (sauf 'ignored' qui est figé) */}
                {!['new', 'dispatching'].includes(status) && (
                  <>
                    <div className={`text-center py-2 font-semibold text-sm ${statusInfo.color}`}>
                      {statusInfo.label}
                    </div>
                    {status !== 'ignored' && (
                      <button
                        onClick={handleSave}
                        disabled={loadingSave || vehicleDecisionPending}
                        className="w-full py-3 bg-brand hover:bg-brand/80 text-white rounded-xl font-semibold text-sm transition disabled:opacity-50"
                      >
                        {loadingSave ? 'Sauvegarde...' : saveOk
                          ? (status === 'completed' ? '✅ Sauvegardé' : '✅ Sauvegardé — chauffeur notifié')
                          : '💾 Sauvegarder les modifications'}
                      </button>
                    )}
                  </>
                )}

                {/* Dépôt de départ — sert au calcul KM aller/retour */}
                <div className="border-t border pt-4">
                  <label className="block text-ink-muted text-xs mb-2">Dépôt de départ</label>
                  <select value={depotId} onChange={e => {
                    const newId = e.target.value
                    setDepotId(newId)
                    silentPatch({ depot_depart_id: newId || null })
                    setKmRefresh(k => k + 1)
                  }}
                    className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand">
                    <option value="">— Choisir —</option>
                    {depots.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.is_default ? '(défaut)' : ''} — {d.address}
                      </option>
                    ))}
                  </select>
                  {depots.length === 0 && (
                    <p className="text-ink-faint text-xs mt-1.5">Aucun dépôt configuré — <Link href="/admin/depots" className="text-brand underline">configurer dans /admin/depots</Link></p>
                  )}
                </div>

                {/* Assignation chauffeur */}
                <div className="border-t border pt-4">
                  <p className="text-ink-muted text-xs mb-2">Assigner à un chauffeur</p>
                  {['completed', 'ignored', 'cancelled'].includes(status) ? (
                    <div className="bg-surface border rounded-xl px-3 py-2.5 text-ink-secondary text-sm">
                      {initialMission.assigned_user?.name || '— Non assigné —'}
                    </div>
                  ) : (
                    <>
                      {/* Chauffeur déjà sélectionné */}
                      {selectedDriver ? (
                        <div className="flex items-center justify-between gap-2 bg-surface border rounded-xl px-3 py-2.5 mb-2">
                          <span className="text-ink text-sm">
                            {drivers.find(d => d.id === selectedDriver)?.name || '— inconnu —'}
                          </span>
                          <button type="button" onClick={async () => {
                            // Délier = unassign immediat en DB (driver_id: null)
                            // Sans ca, le state local change mais la DB garde l'ancien
                            // chauffeur et le bouton 'Confirmer' n'envoie pas la disassign.
                            if (!confirm('Délier le chauffeur de cette mission ?')) return
                            try {
                              await fetch('/api/missions/assign', {
                                method:  'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body:    JSON.stringify({ mission_id: initialMission.id, driver_id: null }),
                              })
                              setSelectedDriver('')
                              setStatus('dispatching')
                              setM(prev => ({ ...prev, assigned_to: null, assigned_user: null, status: 'dispatching' } as any))
                            } catch (e: any) {
                              alert('Erreur : ' + (e.message || 'reseau'))
                            }
                          }}
                            className="text-ink-muted hover:text-critical text-xs">Délier ✕</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setShowDriverModal(true)}
                          className="w-full px-4 py-2.5 bg-brand hover:bg-brand/80 text-white text-sm font-semibold rounded-xl transition mb-2">
                          🚛 Choisir un chauffeur (avec ETA temps réel)
                        </button>
                      )}
                    </>
                  )}
                  {initialMission.assigned_user && (
                    <p className="text-xs text-ink-muted mt-1">
                      Assigné à <span className="text-success font-medium">{initialMission.assigned_user.name}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* ── Actions admin (dispatcher peut forcer le statut sans pointage chauffeur) ── */}
              {['admin', 'superadmin', 'dispatcher'].includes(userRole) && (
                <div className="bg-surface border border-amber-500/30 rounded-2xl p-5 md-card-enter">
                  <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-3">
                    🛠 Actions dispatcher
                  </h3>
                  <p className="text-ink-faint text-xs mb-4">
                    Force le statut de la mission sans passer par le pointage chauffeur (utile pour débloquer ou clôturer sans photos).
                  </p>
                  <div className="space-y-2">
                    <button type="button"
                      onClick={async () => {
                        if (!confirm('Réinitialiser la mission en "En attente" et désassigner le chauffeur ?')) return
                        try {
                          // Auto-save du form avant la transition pour ne pas
                          // perdre les modifs non encore sauvegardees (Olivier
                          // 2026-05-25).
                          await handleSave()
                          await fetch(`/api/missions/${initialMission.id}/force-status`, {
                            method:  'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body:    JSON.stringify({ status: 'dispatching' }),
                          })
                          setStatus('dispatching')
                          setSelectedDriver('')
                          setM(prev => ({ ...prev, status: 'dispatching', assigned_to: null, assigned_user: null } as any))
                          router.refresh()
                        } catch (e: any) { alert('Erreur : ' + e.message) }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-surface-2 hover:bg-surface-hover border rounded-xl text-left transition">
                      <span className="text-xl flex-shrink-0">🔄</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-ink text-sm font-semibold">Réinitialiser</p>
                        <p className="text-ink-muted text-xs">Repasse en "En attente" et désassigne le chauffeur</p>
                      </div>
                    </button>

                    <button type="button"
                      onClick={async () => {
                        if (!confirm('Forcer la clôture (passe en "À facturer") sans pointage ni photo ?')) return
                        try {
                          await fetch(`/api/missions/${initialMission.id}/force-status`, {
                            method:  'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body:    JSON.stringify({ status: 'to_invoice' }),
                          })
                          setStatus('to_invoice')
                          setM(prev => ({ ...prev, status: 'to_invoice', completed_at: new Date().toISOString() } as any))
                          router.refresh()
                        } catch (e: any) { alert('Erreur : ' + e.message) }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-success/10 hover:bg-success/20 border border-success/30 rounded-xl text-left transition">
                      <span className="text-xl flex-shrink-0">✅</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-success text-sm font-semibold">Forcer la clôture</p>
                        <p className="text-ink-muted text-xs">Passe en "À facturer" sans pointage ni photos</p>
                      </div>
                    </button>

                    <button type="button"
                      onClick={async () => {
                        if (!confirm('Forcer en "Mise en parc" ?')) return
                        try {
                          await fetch(`/api/missions/${initialMission.id}/force-status`, {
                            method:  'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body:    JSON.stringify({ status: 'parked' }),
                          })
                          setStatus('parked')
                          setM(prev => ({ ...prev, status: 'parked', parked_at: new Date().toISOString() } as any))
                          router.refresh()
                        } catch (e: any) { alert('Erreur : ' + e.message) }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl text-left transition">
                      <span className="text-xl flex-shrink-0">🅿️</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-amber-400 text-sm font-semibold">Forcer en parc</p>
                        <p className="text-ink-muted text-xs">Passe en "Mise en parc" sans pointage chauffeur</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* ── Suivi chauffeur (P6) ─────────────────────────────── */}
              {['assigned', 'accepted', 'in_progress', 'completed'].includes(status) && (
                <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                  <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-4">
                    🚗 Suivi chauffeur
                  </h3>
                  <DriverTimeline mission={{
                    status,
                    assigned_at:     M.assigned_at,
                    accepted_at:     M.accepted_at,
                    on_way_at:       M.on_way_at,
                    on_site_at:      M.on_site_at,
                    completed_at:    M.completed_at,
                    parked_at:       (M as any).parked_at,
                    delivering_at:   (M as any).delivering_at,
                    extra_addresses: (M as any).extra_addresses,
                    assigned_user:   M.assigned_user || initialMission.assigned_user,
                  }} />
                </div>
              )}

              {/* Photos chauffeur */}
              {M.driver_photos && M.driver_photos.length > 0 && (
                <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                  <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-3">
                    📷 Photos chauffeur ({M.driver_photos.length})
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {M.driver_photos.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="aspect-square rounded-xl overflow-hidden block">
                        <img src={url} className="w-full h-full object-cover hover:opacity-80 transition" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Kilométrage estimé (Google Directions, recalculé sur chaque modif d'adresse/stop/dépôt) */}
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                <MissionKmInfo missionId={initialMission.id} refreshKey={String(kmRefresh)} />
              </div>

              {/* Récap numéros */}
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-3">Référence</h3>
                <div className="space-y-2">
                  <div>
                    <p className="text-ink-muted text-xs">N° Mission</p>
                    <p className="text-ink font-mono text-sm">{initialMission.external_id}</p>
                  </div>
                  {initialMission.dossier_number && (
                    <div>
                      <p className="text-ink-muted text-xs">N° Dossier</p>
                      <p className="text-ink font-mono text-sm">{initialMission.dossier_number}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-ink-muted text-xs">Source</p>
                    <span className={`inline-block mt-0.5 px-2 py-0.5 rounded text-xs font-bold text-white ${srcInfo.color}`}>
                      {srcInfo.label}
                    </span>
                  </div>
                  <div>
                    <p className="text-ink-muted text-xs">Reçu</p>
                    <p className="text-ink-secondary text-xs">{new Date(initialMission.received_at).toLocaleString('fr-BE')}</p>
                  </div>
                  {initialMission.incident_at && (
                    <div>
                      <p className="text-ink-muted text-xs">Incident</p>
                      <p className="text-ink-secondary text-xs">{new Date(initialMission.incident_at).toLocaleString('fr-BE')}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Bouton Relivrer — visible uniquement quand mission en parc et pas encore de REL.
                  Mais pas pour les missions fourriere police (Mal Garee, Rodeo, etc.) qui ont
                  leur propre flow de sortie (restitution au proprietaire). */}
              {status === 'parked' && !linkedChild && !['police_mg', 'police_rodeo'].includes(initialMission.source) && (
                <RelivrerButton
                  missionId={initialMission.id}
                  initialRedeliveryAddress={(initialMission as any).redelivery_address}
                  originalDestination={initialMission.destination_address || ''}
                  parentSource={initialMission.source}
                />
              )}

              {/* Bouton "Gérer SNC dépôt" : visible pour les SNC en zone Transit (scenario rem_depot).
                  Ouvre un modal avec 3 actions : créer REL / abandonné / repris par assistance. */}
              {status === 'parked'
                && initialMission.source === 'police_snc'
                && (initialMission as any).snc_scenario === 'rem_depot' && (
                <button
                  onClick={() => setShowSncDepotModal(true)}
                  className="w-full py-3 bg-info hover:bg-info/90 text-white rounded-2xl text-sm font-semibold transition flex items-center justify-center gap-2">
                  🛣️ Gérer la mise en dépôt SNC
                </button>
              )}

              {/* Bouton Restituer — visible pour Mal Garee et Rodeo au parc.
                  Branche vers RestituerMalGareeModal (devenu generique) qui gere :
                  - blocage police (Mal Garee, optionnel)
                  - levee de saisie (Rodeo, obligatoire)
                  - minimum 3 jours gardiennage pour Rodeo
                  - recherche/creation Partner Odoo, multi-paiements, branchement Odoo. */}
              {status === 'parked' && ['police_mg', 'police_rodeo'].includes(initialMission.source) && (
                <>
                  {initialMission.police_blocked && (
                    <div className="bg-warning/10 border border-warning/40 rounded-2xl p-3 flex items-start gap-2">
                      <span className="text-warning">🚓</span>
                      <p className="text-warning text-sm font-medium">
                        Bloquée par la police — vérif obligatoire à la restitution
                      </p>
                    </div>
                  )}
                  {initialMission.source === 'police_rodeo' && !(initialMission as any).police_levee_saisie_ok && (
                    <div className="bg-rose-500/10 border border-rose-500/40 rounded-2xl p-3 flex items-start gap-2">
                      <span className="text-rose-500">📋</span>
                      <p className="text-rose-500 text-sm font-medium">
                        Rodéo — levée de saisie non confirmée. Sera demandée à la restitution.
                      </p>
                    </div>
                  )}
                  <button
                    onClick={() => setShowRestituerModal(true)}
                    className="w-full py-3 bg-brand hover:bg-brand-hover text-white rounded-2xl text-sm font-semibold transition flex items-center justify-center gap-2">
                    🔑 Restituer le véhicule
                  </button>
                </>
              )}

              {/* Encart REL existante — si une mission REL a deja ete creee pour ce parc */}
              {linkedChild && (
                <div className="bg-purple-500/10 border border-purple-500/30 rounded-2xl p-4">
                  <p className="text-purple-400 text-xs font-bold uppercase tracking-wide mb-2">🚛 Relivraison liée</p>
                  <p className="text-ink text-sm font-medium">{linkedChild.external_id || linkedChild.dossier_number || linkedChild.id.slice(0, 8)}</p>
                  <p className="text-ink-muted text-xs mb-3">Statut : {linkedChild.status}</p>
                  <Link href={`/dispatch/${linkedChild.id}`}
                    className="block w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium text-center transition">
                    Ouvrir la fiche REL →
                  </Link>
                </div>
              )}

              {/* Encart REM parente — si cette mission est elle-meme une REL */}
              {linkedParent && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                  <p className="text-amber-400 text-xs font-bold uppercase tracking-wide mb-2">🚗 Mission parente (REM)</p>
                  <p className="text-ink text-sm font-medium">{linkedParent.external_id || linkedParent.dossier_number || linkedParent.id.slice(0, 8)}</p>
                  <p className="text-ink-muted text-xs mb-3">Issue du remorquage initial</p>
                  <Link href={`/dispatch/${linkedParent.id}`}
                    className="block w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium text-center transition">
                    Ouvrir la fiche REM →
                  </Link>
                </div>
              )}

              {/* Bouton dossier Odoo FSM */}
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-3">Dossier Odoo</h3>
                {odooTicketUrl ? (
                  <a href={odooTicketUrl} target="_blank" rel="noopener noreferrer"
                    className="block w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium text-center transition">
                    🔗 Ouvrir le dossier Odoo ↗
                  </a>
                ) : loadingOdoo ? (
                  <div className="text-ink-muted text-sm text-center py-2">⏳ Création dossier Odoo...</div>
                ) : odooError ? (
                  <div className="space-y-2">
                    <p className="text-critical text-xs">{odooError}</p>
                    <button onClick={createOdooFsmDossier}
                      className="w-full py-2 bg-purple-soft border border-purple text-purple rounded-xl text-xs">
                      🔄 Réessayer
                    </button>
                  </div>
                ) : (
                  <button onClick={createOdooFsmDossier}
                    className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium transition">
                    📋 Créer dossier Odoo
                  </button>
                )}
              </div>

              {/* Bouton enrichissement IMA */}
              {imaLink && (
                <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                  <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-3">Portail IMA</h3>
                  {imaSuccess ? (
                    <div className="text-success text-sm text-center py-2">✅ Données enrichies !</div>
                  ) : (
                    <>
                      <button
                        onClick={handleFetchIMA}
                        disabled={loadingIMA}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition disabled:opacity-50 mb-2"
                      >
                        {loadingIMA ? 'Récupération...' : '🔗 Enrichir depuis IMA'}
                      </button>
                      <a href={imaLink} target="_blank" rel="noopener noreferrer"
                        className="block w-full py-2 bg-surface border text-ink-secondary hover:text-ink rounded-xl text-xs text-center transition">
                        Ouvrir le portail IMA ↗
                      </a>
                    </>
                  )}
                </div>
              )}

              {/* Historique */}
              {logs.length > 0 && (
                <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                  <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-3">Historique</h3>
                  <div className="space-y-3">
                    {logs.slice(0, 8).map(log => (
                      <div key={log.id} className="flex gap-2">
                        <span className="text-base leading-none mt-0.5">{LOG_ICONS[log.action] || '•'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-ink-secondary text-xs">{log.notes || log.action}</p>
                          <p className="text-ink-faint text-xs">
                            {log.actor?.name && `${log.actor.name} · `}
                            {new Date(log.created_at).toLocaleString('fr-BE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Estimation tarif — tout en bas (non prioritaire) */}
        <div className="px-4 lg:px-8 pt-4 pb-8">
          <PriceEstimateCard missionId={initialMission.id} />
        </div>
        </div>
      </div>

      {/* Modal de sélection chauffeur avec ETA temps réel + cap 90 km/h camion */}
      {showDriverModal && (
        <DriverPickerModal
          missionId={initialMission.id}
          incidentLat={form.incident_lat ? Number(form.incident_lat) : null}
          incidentLng={form.incident_lng ? Number(form.incident_lng) : null}
          onPick={async (driverId) => {
            setSelectedDriver(driverId)
            setShowDriverModal(false)
            // Si la mission est déjà confirmée, on assigne directement (pas besoin de cliquer "Assigner")
            if (status === 'dispatching') {
              await fetch('/api/missions/assign', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ mission_id: initialMission.id, driver_id: driverId }),
              })
              setStatus('assigned')
              // On reste sur la fiche pour voir le chauffeur assigne. UX Olivier 11/05.
              router.refresh()
            } else if (status === 'new') {
              // Mission encore en "En commande" : le pick d un chauffeur vaut
              // confirmation (assigner = confirmer). Declenche handleConfirm
              // qui PATCH le form + assign + confirm + creation Odoo en cascade.
              // Si client facture manquant, l alert s affichera et le pick reste
              // memorise dans selectedDriver pour re-tenter.
              await handleConfirm(driverId)
            }
          }}
          onClose={() => setShowDriverModal(false)}
        />
      )}

      {/* Modal de vérification d'adresse — bloque tant que le dispatcher n'a pas choisi */}
      {activeReview && (
        <AddressReviewModal
          which={activeReview}
          parsedAddress={
            activeReview === 'incident'
              ? (initialMission.incident_address || form.incident_address)
              : (initialMission.destination_address || form.destination_address)
          }
          currentAddress={
            activeReview === 'incident' ? form.incident_address : form.destination_address
          }
          googleSuggestion={
            activeReview === 'incident' ? incidentGeo.suggestion : destinationGeo.suggestion
          }
          gmKey={googleMapsKey}
          onPick={(addr, lat, lng) => {
            if (activeReview === 'incident') {
              setForm(prev => ({
                ...prev,
                incident_address: addr,
                incident_lat:     lat != null ? String(lat) : prev.incident_lat,
                incident_lng:     lng != null ? String(lng) : prev.incident_lng,
              }))
              setIncidentGeo(lat != null
                ? { state: 'confirmed', suggestion: { addr, lat, lng: lng! } }
                : { state: 'not_found' })
              silentPatch({ incident_address: addr, ...(lat != null ? { incident_lat: lat, incident_lng: lng } : {}) })
            } else {
              setForm(prev => ({
                ...prev,
                destination_address: addr,
                destination_lat:     lat != null ? String(lat) : prev.destination_lat,
                destination_lng:     lng != null ? String(lng) : prev.destination_lng,
              }))
              setDestinationGeo(lat != null
                ? { state: 'confirmed', suggestion: { addr, lat, lng: lng! } }
                : { state: 'not_found' })
              silentPatch({ destination_address: addr, ...(lat != null ? { destination_lat: lat, destination_lng: lng } : {}) })
            }
            closeReview()
          }}
          onSkip={closeReview}
        />
      )}

      {showCreateClientModal && (
        <CreateClientModal
          initialName={clientQuery || form.billed_to_name || ''}
          onClose={() => setShowCreateClientModal(false)}
          onCreated={(client) => {
            selectBilledClient({ id: client.id, name: client.name })
            setShowCreateClientModal(false)
          }}
        />
      )}
      {showSncDepotModal && initialMission.source === 'police_snc' && (
        <GererSncDepotModal
          mission={{
            id:             initialMission.id,
            external_id:    initialMission.external_id,
            dossier_number: initialMission.dossier_number,
            vehicle_plate:  initialMission.vehicle_plate,
            vehicle_brand:  initialMission.vehicle_brand,
            vehicle_model:  initialMission.vehicle_model,
            client_name:    initialMission.client_name,
          }}
          onClose={() => setShowSncDepotModal(false)}
          onSuccess={(action, result) => {
            setShowSncDepotModal(false)
            if (action === 'rel' && result.rel_mission?.id) {
              router.push(`/dispatch/${result.rel_mission.id}`)
            } else {
              router.push('/dispatch')
            }
          }}
        />
      )}
      {showRestituerModal && ['police_mg', 'police_rodeo'].includes(initialMission.source) && (
        <RestituerMalGareeModal
          mission={{
            id:                     initialMission.id,
            source:                 initialMission.source,
            external_id:            initialMission.external_id,
            dossier_number:         initialMission.dossier_number,
            vehicle_plate:          initialMission.vehicle_plate,
            vehicle_brand:          initialMission.vehicle_brand,
            vehicle_model:          initialMission.vehicle_model,
            client_name:            initialMission.client_name,
            client_phone:           (initialMission as any).client_phone || null,
            billed_to_id:           initialMission.billed_to_id || null,
            billed_to_name:         initialMission.billed_to_name || null,
            parked_at:              initialMission.parked_at || null,
            received_at:            initialMission.received_at || null,
            intervention_date:      (initialMission as any).intervention_date || null,
            police_blocked:         Boolean(initialMission.police_blocked),
            police_levee_saisie_ok: Boolean((initialMission as any).police_levee_saisie_ok),
          }}
          userHasOdooAccess={userHasOdooAccess}
          onClose={() => setShowRestituerModal(false)}
          onSuccess={(result) => {
            setShowRestituerModal(false)
            if (result.redirect_to) {
              router.push(result.redirect_to)
            } else if (result.quote?.url) {
              window.open(result.quote.url, '_blank')
              router.push('/dispatch')
            } else {
              router.push('/dispatch')
            }
          }}
        />
      )}
    </AppShell>
  )
}
