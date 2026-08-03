'use client'

import { useState, useEffect, useRef }    from 'react'
import { useRouter }   from 'next/navigation'
import Link            from 'next/link'
import { buildEncaissementUrl } from '@/lib/missions/encaissement-url'
import { createClient } from '@supabase/supabase-js'
import { Pencil } from 'lucide-react'
import { DriverTimeline } from '@/components/missions/DriverTimeline'
import PriceEstimateCard from '@/components/missions/PriceEstimateCard'
import MissionRemarks from '@/components/missions/MissionRemarks'
import BillingRemarks from '@/components/missions/BillingRemarks'
import DriverInstructions from '@/components/missions/DriverInstructions'
import FicheContactsPanel from '@/components/reception/FicheContactsPanel'
import RemarksAddModal from '@/components/missions/RemarksAddModal'
import MissionInvoicesBanner from '@/components/missions/MissionInvoicesBanner'
import { KeyTag, KeyControls, isSaisieSource } from '@/components/missions/KeyInfoCard'
import { PhotoGrid } from '@/components/ui/PhotoLightbox'
import DriverRouteCard from '@/components/dispatch/DriverRouteCard'
import MergeMissionButton from '@/components/dispatch/MergeMissionButton'
import CancelMissionButton from '@/components/missions/CancelMissionButton'
import RelivraisonModalButton from '@/components/missions/RelivraisonModalButton'
import AllianzCompleteButton from '@/components/missions/AllianzCompleteButton'
import PartialInvoiceModal from '@/components/facturation/PartialInvoiceModal'
import SaisiePanel from '@/components/missions/SaisiePanel'
import FicheFacturerButton from '@/components/facturation/FicheFacturerButton'
import OfficerAutocomplete from '@/components/missions/OfficerAutocomplete'
import AddressField, { verifyAddressViaPlaces, reverseGeocodeCity } from '@/components/AddressField'
import { parseHighwayAddress } from '@/lib/highways/parse'
import { HighwaySiabisModal, shouldOfferSiabis } from '../HighwaySiabisModal'
import DriverPickerModal from '@/components/DriverPickerModal'
import ScanButton from '@/components/ScanButton'
import CreateClientModal from '@/components/CreateClientModal'
import RestituerMalGareeModal from '@/components/restitution/RestituerMalGareeModal'
import RestituerEtFacturerModal from '@/components/fourriere/RestituerEtFacturerModal'
import GererSncDepotModal from '@/components/restitution/GererSncDepotModal'
import AppShell from '@/components/layout/AppShell'
import { getSourceLabel, getSourceColor, type SourceDisplay as CatalogSource } from '@/lib/missions/source-display'
import { getMissionTypeLabel } from '@/lib/missions/mission-types'
import { parcZoneLabel } from '@/lib/parc/zone-label'
import { useGarageClosure } from '@/lib/useGarageClosures'
import { interpretVr } from '@/lib/touring/vr'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mission {
  id: string
  mission_number: number | null
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
  depot_depart_locked?: boolean | null
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
  delivering_at?:  string | null
  // Position dans le parc (mission parked). Cf migration 202605182100.
  parc_zone_key?:    string | null
  parc_row_number?:  number | null
  parc_slot_index?:  number | null
  park_stage_name?:  string | null  // nom du depot/stage (ex: "Pepinster")
  // Particularites/warnings saisies par le dispatcher a la creation
  warnings?:         string[] | null
  // Infos additionnelles affichees sur la fiche (Olivier 2026-05-26).
  vehicle_class?:        'car' | 'moto' | string | null
  distance_km?:          number | null
  duration_min?:         number | null
  snc_scenario?:         'dsp' | 'rem_client' | 'rem_depot' | 'rem_direct' | string | null
  snc_requires_balisage?: boolean | null
  remarks_billing?:      string | null
  special_tarif_htva?:   number | null
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
  delivering:  { label: 'Livraison',    color: 'text-alert'     },
  parked:      { label: 'En parc',      color: 'text-info'      },
  unlocated:   { label: 'Non localisé', color: 'text-warning'   },
  awaiting_payment: { label: 'Attente paiement', color: 'text-warning' },
  to_invoice:  { label: 'À facturer',   color: 'text-success'   },
  completed:   { label: 'Terminée',     color: 'text-ink-muted' },
  cancelled:   { label: 'Annulée',      color: 'text-critical'  },
  ignored:     { label: 'Refusée',      color: 'text-critical'  },
  parse_error: { label: 'Erreur',       color: 'text-critical'  },
}

// Olivier 2026-06-05 : 'relivraison' RE-ajoutee aux choix manuels. Quand
// le dispatcher ouvre une mission REL, le Select doit afficher la valeur,
// sinon le champ est vide et un re-save efface le type (= tarif faux).
// Bug rapporte : "ca ne sélectionne rien dans la liste type de mission".
// Picto « roulant » (voiture) / « non roulant » (voiture barrée) / « non défini »
// (voiture grisée) — à côté de l'étiquette porte-clé dans le bandeau parc.
// Cliquable côté dispatch pour cycler Non défini → Roulant → Non roulant.
// Demande Axel 2026-07-05.
function RollableTag({ rollable, onClick }: { rollable: boolean | null | undefined; onClick?: () => void }) {
  const spec = rollable == null
    ? { box: 'bg-ink/5 border', text: 'text-ink-muted',   label: 'Non défini',  car: 'opacity-40 grayscale', barred: false }
    : rollable
      ? { box: 'bg-green-500/15 border-green-500/40', text: 'text-green-600', label: 'Roulant',     car: '',            barred: false }
      : { box: 'bg-red-500/15 border-red-500/40',     text: 'text-red-600',   label: 'Non roulant', car: 'opacity-70',  barred: true }
  const content = (
    <div className="flex flex-col items-center gap-0.5 flex-shrink-0"
      title={onClick ? 'Cliquer pour changer (Non défini → Roulant → Non roulant)' : spec.label}>
      <div className={`relative w-11 h-11 rounded-lg border flex items-center justify-center text-2xl ${spec.box}`}>
        <span className={spec.car}>🚗</span>
        {spec.barred && (
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="block w-9 h-[2px] bg-red-600 rotate-45 rounded" />
          </span>
        )}
      </div>
      <span className={`text-[10px] font-semibold ${spec.text}`}>{spec.label}</span>
    </div>
  )
  return onClick
    ? <button type="button" onClick={onClick} className="active:scale-95 transition">{content}</button>
    : content
}

const MISSION_TYPES = ['remorquage', 'depannage', 'transport', 'trajet_vide', 'reparation_place', 'relivraison', 'autre']
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
  key_location: '🔑',
  key_hook:     '🔑',
  update_vehicle: '🚗',
  merge_in:     '🔗',
  merged:       '🔗',
  partial_invoice: '🧾',
  kaze_synced:     '🟦',
  kaze_sync_error: '🟥',
  odoo_synced:     '🟣',
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

// Olivier 2026-06-02 PM : helpers ISO ↔ datetime-local input.
// L input <type="datetime-local"> attend "YYYY-MM-DDTHH:MM" en heure LOCALE
// du navigateur. On convertit dans les 2 sens pour les champs parked_at / delivering_at.
function isoToLocalDt(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!isFinite(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localDtToIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)  // navigateur interprete comme heure locale
  return isFinite(d.getTime()) ? d.toISOString() : null
}

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

// Olivier 2026-06-18 : re-parse manuel d'une fiche depuis son contenu brut
// (ex: corriger une adresse Touring mal extraite) SANS changer son statut ni
// son assignation. Réservé dispatch/admin/fourrière (cf /api/missions/reprocess).
function ReparseButton({ missionId }: { missionId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState<string | null>(null)
  const run = async () => {
    if (!confirm('Re-parser cette fiche depuis le contenu brut ?\nLes champs extraits (adresse, véhicule…) sont recalculés. Le statut et l\'assignation ne changent pas.')) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/missions/reprocess', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: missionId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      if ((j.reparsed || 0) < 1 && (j.refetched || 0) < 1) {
        setMsg(j.errors?.[0] || 'Aucun changement (pas de contenu brut exploitable ?)')
        setBusy(false); return
      }
      // Succès : on affiche l'adresse re-parsée puis on RECHARGE complètement la
      // page. router.refresh() ne suffit pas : les champs éditables (adresse, etc.)
      // sont initialisés une seule fois au montage et gardent l'ancienne valeur
      // à l'écran (ex: "Kan" reste affiché alors que la base a "Rue Mitoyenne").
      const s = j.sample
      if (s) setMsg(`✅ Re-parsé — intervention : ${[s.incident_address, s.incident_city].filter(Boolean).join(', ') || '—'}. Rechargement…`)
      else   setMsg('✅ Re-parsé. Rechargement…')
      setTimeout(() => window.location.reload(), 1400)
    } catch (e: any) { setMsg(e.message); setBusy(false) }
  }
  return (
    <div className="px-5 pb-4 border-t pt-3">
      <button onClick={run} disabled={busy}
        className="text-xs px-3 py-1.5 bg-brand/10 hover:bg-brand/20 border border-brand/30 rounded-lg text-brand font-semibold disabled:opacity-50 transition">
        {busy ? '⏳ Re-parsing… (≈10s)' : '🔄 Re-parser depuis le contenu brut'}
      </button>
      {msg && <p className={`text-xs mt-2 ${msg.startsWith('✅') ? 'text-green-700' : 'text-amber-700'}`}>{msg}</p>}
    </div>
  )
}

function RelivrerButton({
  missionId, initialRedeliveryAddress, originalDestination, parentSource, gmKey,
}: {
  missionId: string
  initialRedeliveryAddress?: string | null
  originalDestination?: string | null
  parentSource: string | null
  gmKey: string
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  // Redirection immediate apres creation (Olivier 2026-05-26) — plus de bouton
  // intermediaire "Ouvrir la mission de relivraison".
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
  const [savingAddr, setSavingAddr] = useState(false)
  const [savedMsg,   setSavedMsg]   = useState<string | null>(null)
  // Etat de l auto-save inline : idle | saving | saved | error
  const [autoSave,   setAutoSave]   = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSavedRef = useRef((initialRedeliveryAddress || '').trim())

  // Olivier 2026-06-12 : persiste l adresse de relivraison SANS creer la REL.
  // Avant : l adresse restait en memoire locale (disparaissait au refresh) et
  // l etiquette parc K affichait "En attente d info adresse de relivraison".
  // persistAddress = ecriture BDD seule (pas d impression : utilise par l auto-save).
  const persistAddress = async (v: string): Promise<boolean> => {
    setAutoSave('saving')
    try {
      const res = await fetch(`/api/missions/${missionId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ redelivery_address: v }),
      })
      if (!res.ok) throw new Error()
      lastSavedRef.current = v
      setAutoSave('saved')
      return true
    } catch {
      setAutoSave('error')
      return false
    }
  }

  // Auto-save debounce : des que le champ est complete/modifie, on enregistre
  // (800ms apres la derniere frappe). Pas d impression ici pour ne pas spammer
  // la Zebra a chaque frappe — la reimpression se fait via le bouton dedie.
  useEffect(() => {
    const v = address.trim()
    if (!v || v === lastSavedRef.current) return
    const t = setTimeout(() => { persistAddress(v) }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  // Bouton explicite : enregistre (si pas deja fait) PUIS reimprime l etiquette.
  const saveAndReprint = async () => {
    const finalAddr = address.trim()
    if (!finalAddr) { setError('Saisis une adresse de relivraison'); return }
    setSavingAddr(true); setError(null); setSavedMsg(null)
    try {
      if (finalAddr !== lastSavedRef.current) {
        const ok = await persistAddress(finalAddr)
        if (!ok) throw new Error('Échec de l\'enregistrement')
      }
      let reprinted = false
      try {
        const pr = await fetch(`/api/missions/${missionId}/reprint-label`, { method: 'POST' })
        reprinted = pr.ok
      } catch { /* reseau imprimante : non bloquant */ }
      setSavedMsg(reprinted
        ? 'Adresse enregistrée — étiquette réimprimée.'
        : 'Adresse enregistrée. (Réimpression indisponible : module fourrière requis.)')
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally { setSavingAddr(false) }
  }

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
      // Redirection immediate vers la mission REL creee (Olivier 2026-05-26).
      // Loading reste a true pour eviter double clic pendant la navigation.
      router.push(`/dispatch/${data.mission_id}`)
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
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
          Adresse de relivraison
          {autoSave === 'saving' && <span className="text-ink-muted"> · enregistrement…</span>}
          {autoSave === 'saved'  && <span className="text-success"> · enregistrée ✓</span>}
          {autoSave === 'error'  && <span className="text-critical"> · échec — réessaie</span>}
          {autoSave === 'idle' && hasAddress && <span className="text-success"> · enregistrée</span>}
        </label>
        <AddressField
          value={address}
          onChange={setAddress}
          onSelect={(addr) => { setAddress(addr); persistAddress(addr.trim()) }}
          gmKey={gmKey}
          placeholder="Rue, n°, code postal, ville…"
        />
        <p className="text-ink-muted text-xs mt-1">
          {!hasAddress && originalDestination
            ? '💡 Pré-remplie depuis l\'adresse client originale. Enregistrement automatique dès modification.'
            : '💾 Enregistrement automatique dès que tu complètes ou modifies l\'adresse.'}
        </p>
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

      <button onClick={saveAndReprint} disabled={savingAddr || !address.trim()}
        className="w-full py-2.5 bg-surface-2 hover:bg-surface-hover border disabled:opacity-50 text-ink rounded-xl text-sm font-semibold transition">
        {savingAddr ? '⏳ …' : '🖨 Enregistrer + réimprimer l\'étiquette'}
      </button>
      <button onClick={handle} disabled={loading || !address.trim()}
        className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
        {loading ? '⏳ Création…' : '🚛 Créer la mission de relivraison'}
      </button>
      {savedMsg && <p className="text-success text-xs">✓ {savedMsg}</p>}
      {error && <p className="text-critical text-xs">⚠ {error}</p>}
    </div>
  )
}

/**
 * Modal "Forcer en parc" — choix du depot et de la zone parc avant de
 * passer la mission en parked. Olivier 2026-05-28 : forcer la mise en parc
 * exige de selectionner le depot ET le parc.
 */
function ForceParkModal({ missionId, currentDepotId, currentZone, onClose, onDone }: {
  missionId:      string
  currentDepotId: string | null
  currentZone:    string | null
  onClose:        () => void
  onDone:         () => void
}) {
  const [zones,   setZones]   = useState<Array<{ key: string; label: string }>>([])
  const [depots,  setDepots]  = useState<Array<{ id: string; name: string; address?: string; is_default?: boolean }>>([])
  const [depotId, setDepotId] = useState<string>(currentDepotId || '')
  const [zoneKey, setZoneKey] = useState<string>(currentZone || '')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/parc/zones-and-depots')
      .then(r => r.json())
      .then(j => {
        setZones(j.zones || [])
        setDepots(j.depots || [])
        // Pre-selection : depot par defaut si pas encore choisi
        if (!depotId) {
          const def = (j.depots || []).find((d: any) => d.is_default)
          if (def) setDepotId(def.id)
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit() {
    if (!depotId) { setError('Sélectionne un dépôt'); return }
    setSubmitting(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/force-status`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          status:          'parked',
          depot_depart_id: depotId,
          // Zone optionnelle : null si dépôt sans zones (uniquement Pepinster
          // a des zones aujourd hui ; les autres entrepots deposent sans zone).
          parc_zone_key:   zoneKey || null,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      onDone()
    } catch (e: any) {
      setError(e.message)
    } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border rounded-2xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-ink font-bold text-base mb-1">🅿️ Mettre en Parc</h3>
        <p className="text-ink-muted text-xs mb-4">
          Choisis le dépôt de départ et la zone du parc pour cette mission.
        </p>

        {loading ? (
          <p className="text-ink-faint text-sm py-6 text-center">Chargement…</p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-ink-secondary text-xs font-semibold mb-1.5">Dépôt</label>
              <select
                value={depotId}
                onChange={e => setDepotId(e.target.value)}
                className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm"
              >
                <option value="">— Choisir un dépôt —</option>
                {depots.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}{d.address ? ` — ${d.address}` : ''}{d.is_default ? ' · défaut' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-ink-secondary text-xs font-semibold">Zone du parc <span className="text-ink-muted font-normal">(optionnel)</span></label>
                {zoneKey && (
                  <button type="button" onClick={() => setZoneKey('')}
                    className="text-xs text-ink-muted hover:text-ink underline">
                    Effacer
                  </button>
                )}
              </div>
              <p className="text-ink-muted text-[11px] mb-2">
                Seul Pepinster a des zones. Pour les autres dépôts, laisse vide.
              </p>
              <div className="grid grid-cols-4 gap-2">
                {zones.map(z => (
                  <button key={z.key}
                    type="button"
                    onClick={() => setZoneKey(z.key)}
                    className={`p-2 rounded-xl border text-center transition ${
                      zoneKey === z.key
                        ? 'bg-brand text-white border-brand shadow'
                        : 'bg-surface-2 hover:bg-surface-hover border-surface-hover text-ink'
                    }`}>
                    <div className="font-display font-bold text-sm">{z.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-critical text-xs">⚠ {error}</p>}

            <div className="flex gap-2 pt-2">
              <button onClick={onClose} disabled={submitting}
                className="flex-1 py-2.5 bg-surface-2 border text-ink-secondary rounded-xl text-sm font-medium">
                Annuler
              </button>
              <button onClick={submit} disabled={submitting || !depotId}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-bold">
                {submitting ? '⏳ ...' : 'Mettre en Parc'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Bouton "Gérer la mise en parc" — saisie de l'adresse de relivraison +
 * conversion REM -> REM+REL.
 * Olivier 2026-05-28 : la conversion se déclenche dès qu'une adresse de
 * relivraison est connue (paiement reçu / reprise assistance → on a une
 * adresse). Ce bouton permet de saisir/modifier cette adresse depuis la
 * fiche dispatch et de convertir en un clic.
 */
function ManageParkButton({ missionId, source, currentAddress, gmKey, onConverted }: {
  missionId:      string
  source:         string
  currentAddress: string
  gmKey:          string
  onConverted:    () => void
}) {
  const [open,    setOpen]    = useState(false)
  const [reason,  setReason]  = useState<'paye' | 'assistance_reprise' | 'autre'>('paye')
  const [notes,   setNotes]   = useState('')
  const [addr,    setAddr]    = useState(currentAddress || '')
  const [lat,     setLat]     = useState<number | null>(null)
  const [lng,     setLng]     = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function doConvert() {
    if (!addr.trim()) {
      setError('Adresse de relivraison requise')
      return
    }
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/convert-to-rem-rel`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          reason,
          notes:              notes.trim() || undefined,
          redelivery_address: addr.trim(),
          redelivery_lat:     lat,
          redelivery_lng:     lng,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur conversion')
      setOpen(false)
      setNotes('')
      onConverted()
    } catch (e: any) {
      setError(e.message)
    } finally { setLoading(false) }
  }

  return (
    <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 md-card-enter">
      <div className="flex items-start gap-2 mb-2">
        <span className="text-xl">🅿️</span>
        <div className="flex-1">
          <p className="text-amber-900 text-sm font-bold uppercase tracking-wide">Véhicule en parc — REM</p>
          <p className="text-amber-800 text-xs mt-0.5">
            {currentAddress
              ? 'Confirme l\'adresse de relivraison pour passer en REM+REL.'
              : 'En attente d\'un paiement client ou d\'une reprise par une assistance. Saisis l\'adresse de relivraison ci-dessous pour convertir.'}
          </p>
        </div>
      </div>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold transition mt-2"
        >
          Gérer la mise en parc →
        </button>
      )}
      {open && (
        <div className="space-y-3 mt-3">
          <div>
            <label className="block text-amber-900 text-xs font-semibold mb-1.5">Adresse de relivraison *</label>
            <AddressField
              value={addr}
              onChange={setAddr}
              onSelect={(a, la, ln) => { setAddr(a); setLat(la); setLng(ln) }}
              gmKey={gmKey}
              placeholder="Adresse où livrer le véhicule"
              className="bg-white border border-amber-200 text-amber-900"
            />
          </div>
          <div>
            <label className="block text-amber-900 text-xs font-semibold mb-1.5">Motif</label>
            <div className="grid grid-cols-1 gap-1.5">
              <label className="flex items-center gap-2 px-3 py-2 bg-white border border-amber-200 rounded-lg cursor-pointer hover:border-amber-400 transition">
                <input type="radio" name="conv-reason" checked={reason === 'paye'} onChange={() => setReason('paye')} />
                <span className="text-sm text-amber-900">💳 Facture payée par le client</span>
              </label>
              <label className="flex items-center gap-2 px-3 py-2 bg-white border border-amber-200 rounded-lg cursor-pointer hover:border-amber-400 transition">
                <input type="radio" name="conv-reason" checked={reason === 'assistance_reprise'} onChange={() => setReason('assistance_reprise')} />
                <span className="text-sm text-amber-900">🛡️ Repris par une assistance</span>
              </label>
              <label className="flex items-center gap-2 px-3 py-2 bg-white border border-amber-200 rounded-lg cursor-pointer hover:border-amber-400 transition">
                <input type="radio" name="conv-reason" checked={reason === 'autre'} onChange={() => setReason('autre')} />
                <span className="text-sm text-amber-900">📝 Autre</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-amber-900 text-xs font-semibold mb-1.5">Note (optionnelle)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={reason === 'assistance_reprise' ? "Ex: Touring, dossier #..." : 'Détails...'}
              className="w-full bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-900 focus:outline-none focus:border-amber-500"
            />
          </div>
          {error && <p className="text-critical text-xs">⚠ {error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setOpen(false); setError(null) }} disabled={loading}
              className="flex-1 py-2 bg-white border border-amber-300 text-amber-900 rounded-xl text-sm font-medium">
              Annuler
            </button>
            <button onClick={doConvert} disabled={loading || !addr.trim()}
              className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold">
              {loading ? '⏳ Conversion...' : 'Passer en REM+REL'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Olivier 2026-06-14 : sur une fiche HORS zone K, indiquer que le véhicule
// nécessite une relivraison. Encode l'adresse + bascule en zone K (file
// d'attente, impression étiquette REL). NE crée PAS encore la fiche REL.
function NeedsRelivraisonButton({ missionId, currentAddress, gmKey, onDone, saisieWarning = false }: {
  missionId:      string
  currentAddress: string
  gmKey:          string
  onDone:         () => void
  /** Véhicule saisi sans levée de saisie confirmée → avertissement à l'encodage. */
  saisieWarning?: boolean
}) {
  const [open,    setOpen]    = useState(false)
  const [addr,    setAddr]    = useState(currentAddress || '')
  const [lat,     setLat]     = useState<number | null>(null)
  const [lng,     setLng]     = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function submit() {
    if (!addr.trim()) { setError('Adresse de relivraison requise'); return }
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/request-relivraison`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ redelivery_address: addr.trim(), redelivery_lat: lat, redelivery_lng: lng }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      onDone()
    } catch (e: any) { setError(e.message); setLoading(false) }
  }

  return (
    <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-4 md-card-enter">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition flex items-center justify-center gap-2">
          🚚 Ce véhicule nécessite une relivraison ?
        </button>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-blue-900 text-sm font-bold uppercase tracking-wide">Préparer la relivraison</p>
            <p className="text-blue-800 text-xs mt-0.5">
              Le véhicule passe en zone K (file d'attente relivraison) avec l'adresse ci-dessous. La fiche de relivraison sera créée plus tard, depuis la zone K.
            </p>
          </div>
          {saisieWarning && (
            <div className="bg-amber-100 border-2 border-amber-400 rounded-xl px-3 py-2.5">
              <p className="text-amber-900 text-sm font-bold">⚠ Véhicule saisi</p>
              <p className="text-amber-800 text-xs mt-0.5">
                A-t-on bien une <strong>levée de saisie</strong> (documents Parquet/Police) ? Ne pas relivrer sans levée confirmée.
              </p>
            </div>
          )}
          <div>
            <label className="block text-blue-900 text-xs font-semibold mb-1.5">Adresse de relivraison *</label>
            <AddressField
              value={addr}
              onChange={setAddr}
              onSelect={(a, la, ln) => { setAddr(a); setLat(la); setLng(ln) }}
              gmKey={gmKey}
              placeholder="Adresse où livrer le véhicule"
              className="bg-white border border-blue-200 text-blue-900"
            />
          </div>
          {error && <p className="text-critical text-xs">⚠ {error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setOpen(false); setError(null) }} disabled={loading}
              className="flex-1 py-2 bg-white border border-blue-300 text-blue-900 rounded-xl text-sm font-medium">
              Annuler
            </button>
            <button onClick={submit} disabled={loading || !addr.trim()}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold">
              {loading ? '⏳ Transfert…' : 'Placer en zone K →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PrintLabelButton({ missionId }: { missionId: string }) {
  const [loading, setLoading] = useState(false)
  const [status,  setStatus]  = useState<'idle' | 'ok' | 'error'>('idle')
  const [error,   setError]   = useState<string | null>(null)

  async function doPrint() {
    setLoading(true); setStatus('idle'); setError(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/reprint-label`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur impression')
      setStatus('ok')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (e: any) {
      setStatus('error'); setError(e.message || 'Erreur')
      setTimeout(() => setStatus('idle'), 5000)
    } finally { setLoading(false) }
  }

  return (
    <div className="bg-surface border rounded-2xl p-4 hover:border-brand/30 transition md-card-enter">
      <button
        type="button"
        onClick={doPrint}
        disabled={loading}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2"
      >
        {loading ? '⏳ Impression...' : '🖨️ Imprimer l\'étiquette parc'}
      </button>
      {status === 'ok'    && <p className="text-success text-xs mt-2 text-center">✅ Étiquette envoyée à l&apos;imprimante</p>}
      {status === 'error' && <p className="text-critical text-xs mt-2 text-center">⚠ {error}</p>}
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
  status:   { state: 'idle'|'checking'|'confirmed'|'different'|'not_found'; suggestion?: { addr: string; lat: number; lng: number }; via?: 'google'|'spw' }
  onReview: () => void
}) {
  if (status.state === 'idle')      return null
  if (status.state === 'checking')  return <p className="text-ink-muted text-xs">⏳ Vérification Google…</p>
  // Borne d'autoroute localisée via le SPW (Google ne géocode pas ce type d'adresse).
  if (status.via === 'spw') return (
    <div className="px-3 py-2 bg-success-soft border border-success rounded-xl flex items-center justify-between gap-2">
      <p className="text-success text-xs">📍 Borne autoroute localisée{status.suggestion ? ` : ${status.suggestion.addr}` : ''} (source SPW)</p>
      <button type="button" onClick={onReview}
        className="flex-shrink-0 px-2.5 py-1 bg-surface-hover hover:bg-surface-2 text-ink-secondary rounded-lg text-xs transition">
        Pas la bonne ?
      </button>
    </div>
  )
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

function Field({ label, children }: { label: string | React.ReactNode; children: React.ReactNode }) {
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
      autoCorrect="off"
      spellCheck={false}
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
  mission_number?: number | null
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
  parcZoneType = null,
  embed = false,
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
  parcZoneType?: string | null
  embed?: boolean
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
    // Bloc police (zone + agent) — Olivier 2026-06-14
    police_zone:          (initialMission as any).police_zone        || '',
    officer_name:         (initialMission as any).officer_name       || '',
    officer_partner_id:   (initialMission as any).officer_partner_id ?? null,
    amount_guaranteed:    initialMission.amount_guaranteed != null ? String(initialMission.amount_guaranteed) : '',
    amount_to_collect:    initialMission.amount_to_collect != null  ? String(initialMission.amount_to_collect)  : '',
    // Olivier 2026-06-02 : modifiable quand source = police_snc/sia_couvert
    snc_scenario:         initialMission.snc_scenario               || '',
    snc_requires_balisage: Boolean(initialMission.snc_requires_balisage),
    // Olivier 2026-06-02 PM : tarif special HTVA (ecrase calcul automatique)
    special_tarif_htva:   initialMission.special_tarif_htva != null ? String(initialMission.special_tarif_htva) : '',
    // Olivier 2026-06-02 PM : dates parc modifiables (correction gardiennage)
    // Olivier 2026-06-03 : defaults explicites si non setes par le chauffeur :
    //   - parked_at vide  -> date de creation de la mission (par defaut historique)
    //   - delivering_at vide -> maintenant (le vehicule est toujours en parc, le tarif court)
    // Ces defaults sont affiches dans l UI mais NON sauves auto ; ils sont
    // ecrases au save uniquement si l user clique "Enregistrer".
    parked_at:            isoToLocalDt(initialMission.parked_at || (initialMission as any).created_at || initialMission.received_at || null),
    delivering_at:        isoToLocalDt(
      (initialMission as any).delivering_at
      || (['parked', 'delivering', 'unlocated', 'awaiting_payment'].includes(initialMission.status) ? new Date().toISOString() : null)
    ),
  })

  // Nombre de remarques de facturation (pour l'alerte en haut de fiche).
  const [billingRemarkCount, setBillingRemarkCount] = useState(0)
  // Remarques unifiées : compteurs par type + modal d'ajout typé. Olivier 2026-07-10.
  const [generalRemarkCount, setGeneralRemarkCount] = useState(0)
  const [driverInstrCount,   setDriverInstrCount]   = useState(0)
  const [remarksModalOpen,   setRemarksModalOpen]   = useState(false)
  const [remarksModalType,   setRemarksModalType]   = useState<'general' | 'billing' | 'driver'>('general')
  const [remarksRefreshKey,  setRemarksRefreshKey]  = useState(0)

  // Détection autoroute belge/française : "A" suivi de 1-3 chiffres en début d'adresse,
  // ou mot-clé "autoroute" / "highway".
  const isHighway = (addr: string) =>
    /(^|[\s,])A\d{1,3}\b/.test(addr) || /\b(autoroute|highway)\b/i.test(addr)

  // ── Auto-vérification Google sur chargement ─────────────────────────────────
  // État par adresse : 'idle' | 'checking' | 'confirmed' | 'different' | 'not_found'
  type GeoStatus = { state: 'idle'|'checking'|'confirmed'|'different'|'not_found'; suggestion?: { addr: string; lat: number; lng: number }; via?: 'google'|'spw' }
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

  // Résolution d'une adresse d'autoroute ("A27 BK22.3 direction Luxembourg") que
  // Google ne sait pas géocoder : borne kilométrique → coordonnées (bornes SPW)
  // → ville (reverse-geocode Google) → adresse lisible "A27 <Ville>". Débloque le
  // calcul du montant (qui n'a besoin que de lat/lng).
  const resolveHighwayBk = async (addr: string): Promise<{
    addr: string; lat: number; lng: number; borneLabel: string | null; direction: string | null
  } | null> => {
    const p = parseHighwayAddress(addr)
    if (!p.ok || !p.highwayRef || p.km == null) return null
    try {
      const res = await fetch(`/api/highways/resolve-bk?address=${encodeURIComponent(addr)}`)
      const j = await res.json()
      if (!j.ok || typeof j.lat !== 'number') return null
      let city: string | null = null
      try { city = (await reverseGeocodeCity(j.lat, j.lng, googleMapsKey))?.city || null } catch { /* noop */ }
      const label = city ? `${p.highwayRef} ${city}` : `${p.highwayRef} (BK ${p.borneLabel})`
      return { addr: label, lat: j.lat, lng: j.lng, borneLabel: p.borneLabel, direction: p.direction }
    } catch { return null }
  }

  // Résout + applique une adresse autoroute pour l'INCIDENT (coords, BK, sens,
  // adresse lisible), et met la bannière en "borne SPW". Réutilisé au montage et
  // au onBlur du champ. Retourne true si résolu.
  const applyIncidentHighway = async (addr: string): Promise<boolean> => {
    if (!parseHighwayAddress(addr).ok) return false
    setIncidentGeo({ state: 'checking' })
    const hb = await resolveHighwayBk(addr)
    if (!hb) return false
    setIncidentGeo({ state: 'confirmed', via: 'spw', suggestion: { addr: hb.addr, lat: hb.lat, lng: hb.lng } })
    setForm(prev => ({
      ...prev,
      incident_address:  hb.addr,
      incident_lat:      String(hb.lat),
      incident_lng:      String(hb.lng),
      incident_borne_km: hb.borneLabel || prev.incident_borne_km,
      incident_sens:     hb.direction  || prev.incident_sens,
    }))
    silentPatch({
      incident_address:  hb.addr,
      incident_lat:      hb.lat,
      incident_lng:      hb.lng,
      ...(hb.borneLabel ? { incident_borne_km: hb.borneLabel } : {}),
      ...(hb.direction  ? { incident_sens:     hb.direction }  : {}),
    })
    return true
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

  // ── Autosave : toute modification du formulaire est persistée automatiquement
  //    (silencieux, débouncé). On EXCLUT parked_at / delivering_at : ce sont des
  //    valeurs par défaut affichées qui ne doivent être sauvées que sur clic
  //    explicite (sinon on figerait le gardiennage). Le bouton « Sauvegarder &
  //    notifier » reste utile pour pousser les changements au chauffeur. ──
  const autosaveHydrated = useRef(false)
  // Olivier 2026-06-19 : référence du dernier état SAUVÉ. L'autosave ne pousse
  // QUE les champs réellement modifiés depuis — sinon il re-poussait tout le
  // formulaire (y compris les champs vides), écrasant en null des données
  // remplies côté serveur (ex. enrichissement Allianz) sur une fiche ouverte.
  const savedFormRef = useRef<any>(form)
  useEffect(() => {
    if (!autosaveHydrated.current) {
      autosaveHydrated.current = true
      savedFormRef.current = form
      return
    }
    const t = setTimeout(() => {
      const prev = savedFormRef.current || {}
      const changed: Record<string, any> = {}
      for (const [k, v] of Object.entries(form as any)) {
        if (k === 'parked_at' || k === 'delivering_at') continue   // sauve explicite uniquement
        if (JSON.stringify(v) !== JSON.stringify(prev[k])) changed[k] = v
      }
      if (Object.keys(changed).length === 0) return   // rien d'édité → ne rien écraser
      savedFormRef.current = { ...form }
      silentPatch(changed)
    }, 900)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  // Au chargement : vérifier les 2 adresses et appliquer silencieusement la version
  // canonique Google (confirmed OU different — on fait confiance à Places, comme si
  // le dispatcher avait tapé l'adresse et choisi la 1re suggestion). La bannière
  // signale le statut. Le dispatcher peut toujours rouvrir le modal pour corriger.
  useEffect(() => {
    (async () => {
      if (form.incident_address && !initialMission.incident_lat) {
        setIncidentGeo({ state: 'checking' })
        const r = await verifyAddress(form.incident_address)
        if (r.suggestion && (r.state === 'confirmed' || r.state === 'different')) {
          setIncidentGeo(r)
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
        } else if (r.state === 'not_found' && isHighway(form.incident_address)) {
          // Google échoue mais c'est une autoroute → tenter la borne km (SPW).
          const ok = await applyIncidentHighway(form.incident_address)
          if (!ok) setIncidentGeo(r)
        } else {
          setIncidentGeo(r)
        }
      } else if (form.incident_address && initialMission.incident_lat != null && initialMission.incident_lng != null) {
        // Olivier 2026-06-19 : adresse déjà géolocalisée (filet API Allianz /
        // enrichissement) → on la considère confirmée, pas de validation manuelle.
        setIncidentGeo({ state: 'confirmed', suggestion: { addr: form.incident_address, lat: Number(initialMission.incident_lat), lng: Number(initialMission.incident_lng) } })
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
  const [showForceParkModal, setShowForceParkModal] = useState(false)
  const [depots, setDepots]                   = useState<Array<{id:string;name:string;address:string;is_default:boolean}>>([])
  const [depotId, setDepotId]                 = useState<string>(initialMission.depot_depart_id || '')
  const [depotLocked, setDepotLocked]         = useState<boolean>(!!initialMission.depot_depart_locked)
  const [incidentInfo, setIncidentInfo]       = useState<string>((initialMission as any).incident_info || '')
  const [destinationInfo, setDestinationInfo] = useState<string>((initialMission as any).destination_info || '')
  const [redeliveryInfo, setRedeliveryInfo]   = useState<string>((initialMission as any).redelivery_info || '')
  // Alertes fermeture garage (règles dynamiques depuis /admin/garage-closures).
  const garageNotice = useGarageClosure()
  // Date de réouverture d'un garage fermé (saisie chauffeur ou dispatch).
  const [garageReopen, setGarageReopen]       = useState<string>((initialMission as any).garage_reopen_date || '')
  useEffect(() => { setGarageReopen((initialMission as any).garage_reopen_date || '') }, [(initialMission as any).garage_reopen_date])
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

  // Zones de police + map nom -> société Odoo (autocomplete agent). Olivier 2026-06-14.
  const [policeZoneNames, setPoliceZoneNames] = useState<string[]>([])
  const [zoneCompanyMap,  setZoneCompanyMap]  = useState<Record<string, number | null>>({})
  useEffect(() => {
    fetch('/api/police-zones').then(r => r.json()).then(d => {
      const list = Array.isArray(d?.zones) ? d.zones : []
      setPoliceZoneNames(list.map((z: any) => z.name))
      const m: Record<string, number | null> = {}
      list.forEach((z: any) => { m[z.name] = z.odoo_company_id ?? null })
      setZoneCompanyMap(m)
    }).catch(() => {})
  }, [])

  const [showRawContent, setShowRawContent]   = useState(false)
  const [loadingConfirm, setLoadingConfirm]   = useState(false)
  // Modal « autoroute → Siabis » proposé après validation (Olivier 2026-07-09).
  const [siabisModal, setSiabisModal] = useState<{ highwayRef: string | null } | null>(null)
  // Ouverture AUTOMATIQUE si la mission a été marquée « autoroute — Siabis à trancher »
  // (drapeau posé à la sortie du statut 'new', quel que soit le chemin). Olivier 2026-08-03.
  useEffect(() => {
    if ((initialMission as any)?.needs_siabis_decision) {
      const { highwayRef } = shouldOfferSiabis(initialMission.source, initialMission.incident_address)
      setSiabisModal({ highwayRef })
    }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const [loadingRefuse,  setLoadingRefuse]    = useState(false)
  const [loadingSave,    setLoadingSave]      = useState(false)
  const [brands,         setBrands]           = useState<{id:number;name:string}[]>([])
  const [models,         setModels]           = useState<{id:number;name:string}[]>([])
  const [loadingBrands,  setLoadingBrands]    = useState(false)
  const [loadingIMA,     setLoadingIMA]       = useState(false)
  const [imaSuccess,     setImaSuccess]       = useState(false)
  const [status,         setStatus]           = useState(initialMission.status)

  // Arrivée avec ?assign=1 (ex. « Relivrer maintenant » du module Relivraison) →
  // ouvre directement le sélecteur de chauffeur pour assigner dans la foulée.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('assign') === '1' && ['new', 'dispatching', 'assigned', 'accepted'].includes(initialMission.status)) {
      setShowDriverModal(true)
      const url = new URL(window.location.href)
      url.searchParams.delete('assign')
      window.history.replaceState({}, '', url.toString())   // évite la ré-ouverture au refresh
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [parcZone,       setParcZone]         = useState<string | null>(initialMission.parc_zone_key || null)
  const [parcRow,        setParcRow]          = useState<number | null>(initialMission.parc_row_number ?? null)
  const [parcSlot,       setParcSlot]         = useState<number | null>(initialMission.parc_slot_index ?? null)
  // Sync sur la prop après un router.refresh() (ex. bascule auto K1→K côté serveur
  // après saisie de l'adresse de relivraison) : le state client ne se réinitialise
  // pas seul au refresh → le badge de zone restait figé. Olivier 2026-07-14.
  useEffect(() => { setParcZone(initialMission.parc_zone_key || null) }, [initialMission.parc_zone_key])
  useEffect(() => { setParcRow(initialMission.parc_row_number ?? null) }, [initialMission.parc_row_number])
  useEffect(() => { setParcSlot(initialMission.parc_slot_index ?? null) }, [initialMission.parc_slot_index])
  const [transferModalOpen, setTransferModalOpen] = useState(false)
  // Clés (Olivier 2026-06-18) : état partagé entre le fob (bandeau parc) et les
  // contrôles (bloc au-dessus des Remarques).
  const [keyLoc,         setKeyLoc]           = useState<string>((initialMission as any).key_location || '')
  const [keyHookInput,   setKeyHookInput]     = useState<string>((initialMission as any).saisie_key_hook || '')
  const [keyHookSaved,   setKeyHookSaved]     = useState<string>((initialMission as any).saisie_key_hook || '')
  const pickKeyLocation = (v: string) => { setKeyLoc(v); silentPatch({ key_location: v }) }

  // Roulant / non roulant — modifiable par le dispatch en cliquant le picto
  // (cycle Non défini → Roulant → Non roulant). Olivier 2026-07-05.
  const [rollable, setRollable] = useState<boolean | null>(((initialMission as any).is_rollable ?? null) as boolean | null)
  // Re-synchronise l'état local si le serveur renvoie une nouvelle valeur
  // (après refresh / navigation) — sinon la fiche gardait l'ancienne valeur.
  useEffect(() => {
    setRollable(((initialMission as any).is_rollable ?? null) as boolean | null)
  }, [(initialMission as any).is_rollable])
  const cycleRollable = async () => {
    const next = rollable === null ? true : rollable === true ? false : null
    setRollable(next)
    try {
      await fetch(`/api/missions/${initialMission.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_rollable: next }),
      })
    } catch { /* noop */ }
    router.refresh()   // invalide le cache de route → la valeur tient au reload/nav
  }
  const saveKeyHook = () => {
    const val = keyHookInput.trim()
    if (val === keyHookSaved) return
    setKeyHookSaved(val); silentPatch({ saisie_key_hook: val || null })
  }
  const [policeBlocked,  setPoliceBlocked]    = useState<boolean>(Boolean(initialMission.police_blocked))
  const [togglingPoliceBlock, setTogglingPoliceBlock] = useState(false)
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

  // ── N° de dossier (modifiable / ajoutable) ──
  const [dossierNumber, setDossierNumber] = useState<string>(initialMission.dossier_number || '')
  const [savedDossier,  setSavedDossier]  = useState<string>(initialMission.dossier_number || '')
  const [isSavingDossier, setIsSavingDossier] = useState(false)
  const saveDossierNumber = async () => {
    const val = dossierNumber.trim()
    if (val === savedDossier) return
    setIsSavingDossier(true)
    try {
      const res = await fetch(`/api/missions/${initialMission.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dossier_number: val || null }),
      })
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`)
      setSavedDossier(val)
    } catch (err) {
      console.error('Erreur save dossier_number:', err)
      setDossierNumber(savedDossier)
      alert("Erreur lors de l'enregistrement du n° de dossier. Réessayez.")
    } finally {
      setIsSavingDossier(false)
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
  const [showPartialInvoice, setShowPartialInvoice] = useState(false)
  const [showRestituerModal, setShowRestituerModal] = useState(false)
  const [showRestituerFacturer, setShowRestituerFacturer] = useState(false)
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

  // Olivier 2026-06-17 : « Aucun ne correspond — créer » crée RÉELLEMENT le
  // véhicule dans Odoo dès maintenant (à la fiche, pas seulement à la
  // facturation) puis le lie. Avant, le bouton ne faisait que masquer les
  // suggestions et le véhicule n'était jamais créé.
  const [vehicleCreating, setVehicleCreating] = useState(false)
  const createOdooVehicle = async () => {
    const plate = (form.vehicle_plate || '').trim()
    if (!plate) return
    if (!(form.vehicle_brand || '').trim() || !(form.vehicle_model || '').trim()) {
      alert('Renseigne la marque et le modèle avant de créer le véhicule.')
      return
    }
    setVehicleCreating(true)
    try {
      const res = await fetch('/api/odoo/create-vehicle', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate,
          vin:       form.vehicle_vin     || undefined,
          brand:     form.vehicle_brand,
          model:     form.vehicle_model,
          fuel:      form.vehicle_fuel    || undefined,
          gearbox:   form.vehicle_gearbox || undefined,
          partner_id: billedPartnerId || undefined,
        }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Création échouée')
      setOdooVehicleId(j.vehicle_id)
      setVehicleResults([])
      setShowVehicleDrop(false)
      // Persiste le lien immédiatement
      fetch(`/api/missions/${initialMission.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ odoo_vehicle_id: j.vehicle_id }),
      }).catch(() => {})
    } catch (e: any) {
      alert(e.message || 'Création du véhicule échouée')
    } finally {
      setVehicleCreating(false)
    }
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

  // Contrôle cohérence dossier : même dossier (préfixe avant '/') sur des
  // véhicules différents = probable erreur d'encodage → warning. Toutes sources
  // (Olivier 2026-07-28).
  const [vabConflict, setVabConflict] = useState<{ prefix: string; type: string; others: { mission_number: number | null; plate: string | null }[] } | null>(null)
  useEffect(() => {
    if (!initialMission.dossier_number) { setVabConflict(null); return }
    let alive = true
    fetch('/api/missions/dossier-check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission_ids: [initialMission.id] }),
    }).then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j) setVabConflict(j.conflicts?.[initialMission.id] || null) })
      .catch(() => {})
    return () => { alive = false }
  }, [initialMission.id, initialMission.dossier_number])

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

  // Olivier 2026-06-04 : helper pour les champs numeriques (HTVA, montants).
  // Convertit la virgule en point au moment de la saisie pour que Number()
  // fonctionne (en BE on tape '490,50' alors que JS attend '490.50').
  // A utiliser pour special_tarif_htva, amount_to_collect, amount_guaranteed.
  const fNum = (k: keyof typeof form) => (v: string) => {
    const normalized = v.replace(',', '.')
    setForm(prev => ({ ...prev, [k]: normalized }))
  }

  // Olivier 2026-06-04 : auto-patch silencieux pour les montants
  // (special_tarif_htva, amount_guaranteed, amount_to_collect) afin que
  // l estimation tarif se mette a jour live + que la valeur soit persistee
  // meme sans cliquer "Enregistrer". Debounce 700ms.
  useEffect(() => {
    const v = form.special_tarif_htva
    const norm = v === '' || v == null ? null : Number(v)
    const orig = initialMission.special_tarif_htva != null ? Number(initialMission.special_tarif_htva) : null
    if (norm === orig) return
    const t = setTimeout(() => silentPatch({ special_tarif_htva: norm }), 700)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.special_tarif_htva])

  useEffect(() => {
    const v = form.amount_guaranteed
    const norm = v === '' || v == null ? null : Number(v)
    const orig = (initialMission as any).amount_guaranteed != null ? Number((initialMission as any).amount_guaranteed) : null
    if (norm === orig) return
    const t = setTimeout(() => silentPatch({ amount_guaranteed: norm }), 700)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.amount_guaranteed])

  useEffect(() => {
    const v = form.amount_to_collect
    const norm = v === '' || v == null ? null : Number(v)
    const orig = (initialMission as any).amount_to_collect != null ? Number((initialMission as any).amount_to_collect) : null
    if (norm === orig) return
    // Édition MANUELLE du dispatcher → flag amount_to_collect_manual : gèle
    // l'auto-calcul SNC côté serveur. Olivier 2026-07-14.
    const t = setTimeout(() => silentPatch({ amount_to_collect: norm, amount_to_collect_manual: true }), 700)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.amount_to_collect])

  // Olivier 2026-06-04 : changement de source.
  // - police_snc (SIABIS NON couvert) : l assistance ne paye pas -> on
  //   MEMORISE les valeurs client + billed_to actuelles puis on les RETIRE.
  // - Si on REPASSE depuis police_snc vers autre chose : RESTAURE les
  //   valeurs memorisees (l operateur n a pas a re-saisir si erreur).
  // - sia_couvert (SIABIS COUVERT) : l assistance paye -> conserve.
  const [stashedClientInfo, setStashedClientInfo] = useState<{
    client_name:    string
    client_phone:   string
    client_address: string
    billed_to_name: string
    billed_to_id:   number | null
  } | null>(null)

  const handleSourceChange = (newSource: string) => {
    const oldSource = form.source
    const goingToSnc   = newSource === 'police_snc'
    const leavingSnc   = oldSource === 'police_snc' && newSource !== 'police_snc'

    // Cas 1 : on entre dans police_snc -> stash + reset
    if (goingToSnc && oldSource !== 'police_snc') {
      // Memoriser l etat client actuel (avant reset) pour pouvoir restaurer
      setStashedClientInfo({
        client_name:    form.client_name || '',
        client_phone:   form.client_phone || '',
        client_address: form.client_address || '',
        billed_to_name: form.billed_to_name || '',
        billed_to_id:   billedPartnerId,
      })
      setForm(prev => ({
        ...prev,
        source:         newSource,
        client_name:    '',
        client_phone:   '',
        client_address: '',
        billed_to_name: '',
      }))
      setBilledPartnerId(null)
      silentPatch({ billed_to_id: null, billed_to_name: null, client_name: null, client_phone: null, client_address: null })
      return
    }

    // Cas 2 : on QUITTE police_snc et on a un stash -> restaure
    if (leavingSnc && stashedClientInfo) {
      setForm(prev => ({
        ...prev,
        source:         newSource,
        client_name:    stashedClientInfo.client_name,
        client_phone:   stashedClientInfo.client_phone,
        client_address: stashedClientInfo.client_address,
        billed_to_name: stashedClientInfo.billed_to_name,
      }))
      setBilledPartnerId(stashedClientInfo.billed_to_id)
      silentPatch({
        billed_to_id:   stashedClientInfo.billed_to_id,
        billed_to_name: stashedClientInfo.billed_to_name || null,
        client_name:    stashedClientInfo.client_name || null,
        client_phone:   stashedClientInfo.client_phone || null,
        client_address: stashedClientInfo.client_address || null,
      })
      setStashedClientInfo(null)
      return
    }

    // Cas 3 : changement standard, on garde tout
    setForm(prev => ({ ...prev, source: newSource }))
  }

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
    // Convertit les datetime-local en ISO avant envoi (parked_at / delivering_at)
    const payload = {
      ...form,
      parked_at:        localDtToIso(form.parked_at),
      delivering_at:    localDtToIso(form.delivering_at),
      billed_to_id:     billedPartnerId,
      depot_depart_id:  depotId || null,
      extra_addresses:  stops.length > 0 ? stops : null,
      _notify_driver:   true,
    }
    const res = await fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    })
    if (res.ok) {
      setSaveOk(true)
      setKmRefresh(k => k + 1)  // force le recalcul des KM avec les nouvelles données DB
      setTimeout(() => setSaveOk(false), 3000)
    } else {
      // Olivier 2026-06-02 : afficher l erreur (notamment le 400 "scenario SNC requis"
      // quand on change source vers police_snc sans choisir le scenario).
      try {
        const j = await res.json()
        if (j?.error) alert(`Sauvegarde impossible : ${j.error}`)
      } catch { /* ignore */ }
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
    // Adresse sur autoroute + source non Siabis/police → proposer le
    // basculement Siabis (Olivier 2026-07-09). Le refresh se fait à la
    // fermeture du modal.
    const { offer, highwayRef } = shouldOfferSiabis(initialMission.source, form.incident_address)
    if (offer) { setSiabisModal({ highwayRef }); return }
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
  // Fiche fusionnée : on garde status='cancelled' côté BDD (plomberie inchangée)
  // mais on affiche « Fusionnée » et un lien vers la fiche conservée.
  const mergedInto = (initialMission as any).merged_into_mission_id as string | null | undefined
  const statusInfo = mergedInto
    ? { label: 'Fusionnée', color: 'text-ink-muted' }
    : (STATUS_LABELS[status] || { label: status, color: 'text-ink-muted' })
  const canEdit    = ['new', 'dispatching'].includes(status)

  return (
    <AppShell
      embedded={embed}
      title={`Mission ${initialMission.mission_number != null ? `#${initialMission.mission_number}` : initialMission.external_id}`}
      headerExtra={
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-lg text-xs font-bold text-white ${srcInfo.color}`}>{srcInfo.label}</span>
          {form.mission_type && (
            <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-surface-2 text-ink-secondary border">
              {getMissionTypeLabel(form.mission_type, 'long')}
            </span>
          )}
          <span className={`text-sm font-medium ${statusInfo.color}`}>• {statusInfo.label}</span>
          {/* Bouton CMR (lettre de voiture) — transport / remorquage / relivraison.
              Surimpression sur liasse pré-imprimée. Olivier 2026-07-07. */}
          {(() => {
            const t = (form.mission_type || '').toLowerCase()
            const eligible = /remorqu|reliv|transport/.test(t) || ['rem', 'rel', 'rem+rel'].includes(t)
              || initialMission.incident_type === 'relivraison'
            return eligible ? (
              <a href={`/cmr/${initialMission.id}`} target="_blank" rel="noreferrer"
                className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 transition">
                🚚 CMR
              </a>
            ) : null
          })()}
          {userRole === 'superadmin' && (
            <Link href={`/dispatch/dossier/${initialMission.id}`}
              className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition">
              🧪 Vue dossier
            </Link>
          )}
        </div>
      }
      userName={userName}
      userEmail={userEmail}
      userId={userId}
      userRole={userRole}
      userModules={userModules}
    >
      {vabConflict && (
        vabConflict.type === 'should_link' ? (
          <div className="mb-3 bg-sky-100 border-2 border-sky-500 rounded-xl px-4 py-2.5 text-sky-800 text-sm shadow-sm">
            <span className="font-bold">🔗 Fiches à lier ?</span>{' '}
            même dossier {vabConflict.prefix} + même véhicule que {vabConflict.others.map(o => `#${o.mission_number ?? '?'}`).join(', ')} — vérifier si à lier ou fusionner.
          </div>
        ) : (
          <div className="mb-3 bg-red-100 border-2 border-red-500 rounded-xl px-4 py-2.5 text-red-800 text-sm shadow-sm">
            <span className="font-bold">⚠ Incohérence dossier :</span>{' '}
            même n° de dossier {vabConflict.prefix} que {vabConflict.others.map(o => `#${o.mission_number ?? '?'} (${o.plate || '—'})`).join(', ')} mais véhicule différent — vérifier l'encodage.
          </div>
        )
      )}
      {siabisModal && (
        <HighwaySiabisModal
          missionId={initialMission.id}
          highwayRef={siabisModal.highwayRef}
          onClose={() => { setSiabisModal(null); router.refresh() }}
        />
      )}
      {remarksModalOpen && (
        <RemarksAddModal
          missionId={initialMission.id}
          defaultType={remarksModalType}
          onClose={() => setRemarksModalOpen(false)}
          onAdded={() => setRemarksRefreshKey(k => k + 1)}
        />
      )}
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
          <button
            type="button"
            onClick={() => { if (typeof window !== 'undefined' && window.history.length > 1) router.back(); else router.push('/dispatch') }}
            className="text-ink-secondary hover:text-ink transition text-lg flex items-center gap-1.5 flex-shrink-0"
            title="Retour à l'écran précédent"
          >
            ← <span className="hidden sm:inline text-sm">Retour</span>
          </button>
          <div className="flex-1 min-w-0" />
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

        {/* Factures liées (n° + PDF) — bandeau en tête de fiche. */}
        <MissionInvoicesBanner missionId={initialMission.id} />

        {/* Fiche fusionnée : bandeau + lien vers la fiche conservée. */}
        {mergedInto && (
          <div className="px-4 lg:px-8 pt-6">
            <div className="bg-surface-2 border rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-ink-secondary text-sm">
                🔗 Cette fiche a été <strong>fusionnée</strong> dans une autre fiche (doublon).
              </p>
              <Link href={`/dispatch/${mergedInto}`}
                className="px-3 py-1.5 bg-brand hover:bg-brand/80 text-white rounded-lg text-xs font-semibold whitespace-nowrap">
                Ouvrir la fiche conservée →
              </Link>
            </div>
          </div>
        )}

        {/* Droits VR / taxi / shuttle (Touring) — info dispatch, dispo dès l'acceptation */}
        {(M as any).touring_vr && (() => {
          const raw = (M as any).touring_vr
          const v = interpretVr(raw)
          const yes = !!v?.any
          return (
            <div className="px-4 lg:px-8 pt-6">
              <div className={`rounded-2xl p-4 border-2 ${yes ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-red-500/10 border-red-500/40'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-2xl">{yes ? '🚗' : '🚫'}</span>
                  <p className={`font-bold text-sm uppercase tracking-wide ${yes ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                    Véhicule de remplacement — {yes ? 'DROIT OUVERT' : 'PAS DE DROIT'}
                  </p>
                  {v?.proactive && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">proactif (offert d'office)</span>}
                </div>
                {yes && v?.eligible?.length ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {v.eligible.map(e => (
                      <li key={e.key} className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border border-emerald-500/30">✓ {e.label}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-ink-muted text-[11px] mt-2 font-mono">
                  brut : VR={raw.vr} · VR+taxi={raw.vr_taxi} · shuttle+VR={raw.shuttle_vr} · shuttle={raw.shuttle} · taxi={raw.taxi} · proactif={raw.proactive}
                </p>
              </div>
            </div>
          )
        })()}

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

        {/* ── En-tête 50/50 : Référence (gauche) + Opérationnel (droite) —
            Olivier 2026-06-14. Identité à gauche, contrôles du quotidien
            (chauffeur, dépôt, sauvegarde) à droite. ── */}
        <div className="px-4 lg:px-8 pt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">

            {/* Gauche : Référence */}
            <div className="bg-surface border rounded-xl p-4 flex flex-col gap-3">
              {initialMission.external_id && (
                <div>
                  <p className="text-ink-muted text-[11px] uppercase tracking-wide">Référence externe</p>
                  <p className="text-ink font-mono text-sm mt-0.5">{initialMission.external_id}</p>
                </div>
              )}
              <div>
                <label className="text-ink-muted text-[11px] uppercase tracking-wide flex items-center gap-1.5">
                  N° Dossier {isSavingDossier && <span className="text-brand normal-case">⏳ enregistrement…</span>}
                </label>
                <input
                  type="text"
                  value={dossierNumber}
                  onChange={e => setDossierNumber(e.target.value)}
                  onBlur={saveDossierNumber}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  placeholder="Ajouter un n° de dossier…"
                  className="mt-0.5 w-full bg-surface-2 border border-strong rounded-lg px-2.5 py-1.5 text-ink font-mono text-sm outline-none focus:border-brand"
                />
              </div>
            </div>

            {/* Droite : Opérationnel (chauffeur + dépôt + sauvegarde) */}
            <div className="bg-surface border rounded-xl p-4 space-y-3">
              {/* Dépôt de départ */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-ink-muted text-[11px] uppercase tracking-wide">Dépôt de départ</p>
                  <button type="button"
                    onClick={() => {
                      const next = !depotLocked
                      setDepotLocked(next)
                      silentPatch({ depot_depart_locked: next })
                    }}
                    title={depotLocked
                      ? 'Dépôt verrouillé — choix manuel conservé. Cliquer pour déverrouiller (recalcul auto du plus proche).'
                      : 'Cliquer pour verrouiller ce dépôt et empêcher le recalcul automatique.'}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition ${
                      depotLocked
                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                        : 'bg-surface-2 text-ink-muted border border-transparent hover:border-ink-faint'
                    }`}>
                    {depotLocked ? '🔒 Verrouillé' : '🔓 Auto'}
                  </button>
                </div>
                <select value={depotId} onChange={e => {
                  const newId = e.target.value
                  setDepotId(newId)
                  silentPatch({ depot_depart_id: newId || null })
                  setKmRefresh(k => k + 1)
                }}
                  className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand">
                  <option value="">— Choisir —</option>
                  {depots.map(d => (
                    <option key={d.id} value={d.id}>{d.name} {d.is_default ? '(défaut)' : ''} — {d.address}</option>
                  ))}
                </select>
                {depotLocked
                  ? <p className="text-amber-700 text-[11px] mt-1">Choix verrouillé — non recalculé automatiquement.</p>
                  : <p className="text-ink-faint text-[11px] mt-1">Auto : dépôt le plus proche de l'intervention (Touring).</p>}
                {depots.length === 0 && (
                  <p className="text-ink-faint text-xs mt-1">Aucun dépôt — <Link href="/admin/depots" className="text-brand underline">configurer</Link></p>
                )}
              </div>

              {/* Assignation chauffeur */}
              <div>
                <p className="text-ink-muted text-[11px] uppercase tracking-wide mb-1.5">Assigner à un chauffeur</p>
                {/* ETA live du chauffeur assigné (ORS + GPS, gratuit) — rempli par le cron driver-etas */}
                {(() => {
                  const etaMin = (M as any).driver_eta_minutes ?? (initialMission as any).driver_eta_minutes
                  const etaAt  = (M as any).driver_eta_at ?? (initialMission as any).driver_eta_at
                  const fresh  = etaAt && (Date.now() - new Date(etaAt).getTime() < 4 * 60 * 1000)
                  const enRoute = ['assigned', 'accepted', 'on_way', 'on_site', 'in_progress', 'delivering'].includes(status)
                  if (!fresh || etaMin == null || !enRoute) return null
                  return (
                    <div className="mb-2 flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                      <span className="text-3xl leading-none">🚚</span>
                      <div>
                        <p className="text-emerald-800 font-extrabold text-2xl leading-none">~{etaMin} min</p>
                        <p className="text-emerald-700 text-[11px] mt-0.5">Arrivée estimée du chauffeur (live)</p>
                      </div>
                    </div>
                  )
                })()}
                {['completed', 'ignored', 'cancelled'].includes(status) ? (
                  <div className="bg-surface-2 border rounded-lg px-3 py-2 text-ink-secondary text-sm">
                    {initialMission.assigned_user?.name || '— Non assigné —'}
                  </div>
                ) : selectedDriver ? (
                  <div className="flex items-center justify-between gap-2 bg-surface-2 border rounded-lg px-3 py-2">
                    <span className="text-ink text-sm">{drivers.find(d => d.id === selectedDriver)?.name || '— inconnu —'}</span>
                    <button type="button" onClick={async () => {
                      if (!confirm('Délier le chauffeur de cette mission ?')) return
                      try {
                        await fetch('/api/missions/assign', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ mission_id: initialMission.id, driver_id: null }),
                        })
                        setSelectedDriver('')
                        setStatus('dispatching')
                        setM(prev => ({ ...prev, assigned_to: null, assigned_user: null, status: 'dispatching' } as any))
                      } catch (e: any) { alert('Erreur : ' + (e.message || 'reseau')) }
                    }}
                      className="text-ink-muted hover:text-critical text-xs">Délier ✕</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowDriverModal(true)}
                    className="w-full px-4 py-2 bg-brand hover:bg-brand/80 text-white text-sm font-semibold rounded-lg transition">
                    🚛 Choisir un chauffeur (ETA temps réel)
                  </button>
                )}
              </div>

              {/* Bouton « Sauvegarder & notifier » rendu STICKY (flottant) en bas
                  de page — voir plus bas. Les champs s'enregistrent déjà en auto. */}
            </div>

          </div>
        </div>

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

        {/* ⚠ Particularites/warnings dispatch — bandeau ROUGE lisible
            en theme clair (text-red-700 + bg-red-50). */}
        {Array.isArray(initialMission.warnings) && initialMission.warnings.length > 0 && (
          <div className="px-4 lg:px-8 pt-4">
            <div className="bg-red-50 border-2 border-red-500 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">⚠️</span>
                <p className="text-red-700 text-sm font-bold uppercase tracking-wide">
                  Particularités à connaître
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {initialMission.warnings.map((w, i) => (
                  <span key={i} className="inline-flex items-center px-3 py-1.5 bg-white border border-red-400 rounded-lg text-red-800 text-sm font-semibold shadow-sm">
                    {w}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Bandeau Position parc (visible si mission parked avec zone) ── */}
        {status === 'parked' && parcZone && (
          <div className="px-4 lg:px-8 pt-4">
            <div className="bg-amber-500/10 border-2 border-amber-500/40 rounded-xl p-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="w-11 h-11 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl">🅿️</span>
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-amber-500">
                    Position parc
                  </span>
                  <span className="text-lg font-bold text-ink truncate">
                    Zone <span className={parcZone === 'K' ? '' : 'font-mono'}>{parcZoneLabel(parcZone)}</span>
                    {parcRow != null && (
                      <> · Rang <span className="font-mono">{parcRow}</span></>
                    )}
                    {parcSlot != null && (
                      <> · Slot <span className="font-mono">{parcSlot}</span></>
                    )}
                    {initialMission.park_stage_name && (
                      <span className="text-ink-muted font-normal text-sm"> — {initialMission.park_stage_name}</span>
                    )}
                  </span>
                </div>
                {/* Roulant / non roulant (demande Axel 2026-07-05) — picto voiture /
                    voiture barrée / grisée. Cliquable pour cycler côté dispatch. */}
                <RollableTag rollable={rollable} onClick={cycleRollable} />
                {/* Étiquette porte-clé (dessin) — n° crochet / IN / NO. */}
                <KeyTag keyLocation={keyLoc} hook={keyHookSaved} />
                {/* Olivier 2026-06-04 : bouton transfert (module fourriere uniquement) */}
                {userModules.includes('fourriere') && (
                  <button
                    onClick={() => setTransferModalOpen(true)}
                    className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-amber-600 text-xs font-semibold flex-shrink-0 transition">
                    🔄 Transférer
                  </button>
                )}
                <a href="/fourriere/plan"
                  className="px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 rounded-lg text-amber-600 text-xs font-semibold flex-shrink-0 transition">
                  Voir le plan parc →
                </a>
              </div>
            </div>
          </div>
        )}
        {transferModalOpen && parcZone && (
          <TransferParcModal
            missionId={initialMission.id}
            currentZoneKey={parcZone}
            onClose={() => setTransferModalOpen(false)}
            onSuccess={(newZone) => {
              setParcZone(newZone)
              setParcRow(null)
              setParcSlot(null)
              setTransferModalOpen(false)
            }}
          />
        )}

        {/* Bandeau REMARQUES unifié (compact, cliquable) en haut de fiche.
            Résumé par type + badges ; clic → ouvre le modal d'ajout/gestion.
            Le détail (texte signé/daté) reste dans les encadrés plus bas.
            Remplace l'ancien bandeau billing seul. Olivier 2026-07-10. */}
        {(billingRemarkCount + generalRemarkCount + driverInstrCount) > 0 && (
          <div className="px-4 lg:px-8 pt-4">
            <button
              type="button"
              onClick={() => { setRemarksModalType('general'); setRemarksModalOpen(true) }}
              className="w-full text-left bg-slate-800 hover:bg-slate-700 text-white rounded-xl p-3.5 flex items-center gap-3 shadow-lg ring-1 ring-slate-600 transition"
            >
              <span className="text-2xl">📌</span>
              <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                <span className="text-white text-sm font-bold mr-1">Remarques :</span>
                {billingRemarkCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 border border-amber-500/40 text-xs font-semibold">📝 Facturation · {billingRemarkCount}</span>
                )}
                {driverInstrCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-200 border border-sky-500/40 text-xs font-semibold">📋 Chauffeur · {driverInstrCount}</span>
                )}
                {generalRemarkCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-500/30 text-slate-200 border border-slate-400/40 text-xs font-semibold">💬 Générale · {generalRemarkCount}</span>
                )}
              </div>
              <span className="text-slate-400 text-lg flex-shrink-0">⌄</span>
            </button>
          </div>
        )}

        {/* Bandeau "Bloquee par la police" — visible si police_blocked=true
            (ou si mal_garee et module fourriere, pour pouvoir ajouter la coche
            apres-coup quand la demande police arrive en differé).
            Olivier 2026-05-26, etendu 2026-06-04. */}
        {(policeBlocked || (initialMission.source === 'police_mg' && userModules.includes('fourriere'))) && (
          <div className="px-4 lg:px-8 pt-4">
            <div className={`border-2 rounded-xl p-4 flex items-start gap-3 ${
              policeBlocked
                ? 'bg-amber-50 border-amber-500'
                : 'bg-surface-2 border-dashed border-ink-muted/40'
            }`}>
              <span className="text-2xl">🚓</span>
              <div className="flex-1 min-w-0">
                {policeBlocked ? (
                  <>
                    <p className="text-amber-700 text-sm font-bold uppercase tracking-wide">Bloquée par la police</p>
                    <p className="text-amber-900 text-xs mt-1">Le propriétaire doit être passé au commissariat avant la restitution. Vérification obligatoire à la sortie.</p>
                  </>
                ) : (
                  <>
                    <p className="text-ink-secondary text-sm font-bold uppercase tracking-wide">Pas de blocage police</p>
                    <p className="text-ink-muted text-xs mt-1">Si la police demande un blocage après coup (proprio doit passer commissariat), tu peux l ajouter ici.</p>
                  </>
                )}
              </div>
              {(userModules.includes('fourriere') || ['admin', 'superadmin'].includes(userRole)) && (
                <button
                  disabled={togglingPoliceBlock}
                  onClick={async () => {
                    const willBlock = !policeBlocked
                    const reason = willBlock
                      ? prompt('Motif du blocage (optionnel, sera loggé) :')
                      : prompt('Motif de levée du blocage (optionnel, sera loggé) :')
                    if (reason === null) return  // cancel
                    if (!willBlock && !confirm('Confirmer la levée du blocage police ? Le véhicule pourra être restitué sans vérification commissariat.')) return
                    setTogglingPoliceBlock(true)
                    try {
                      const r = await fetch(`/api/missions/${initialMission.id}/toggle-police-blocked`, {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ blocked: willBlock, reason: reason.trim() || undefined }),
                      })
                      const j = await r.json()
                      if (!r.ok) { alert(`Erreur : ${j.error || r.status}`); return }
                      setPoliceBlocked(willBlock)
                    } catch (e: any) {
                      alert(`Erreur réseau : ${e?.message || e}`)
                    } finally {
                      setTogglingPoliceBlock(false)
                    }
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition flex-shrink-0 disabled:opacity-50 ${
                    policeBlocked
                      ? 'bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300'
                      : 'bg-warning-50 hover:bg-warning-100 text-warning-800 border border-warning-200'
                  }`}
                >
                  {togglingPoliceBlock
                    ? '⏳'
                    : policeBlocked ? 'Retirer le blocage' : '🚓 Ajouter le blocage'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Bandeau "Levée de saisie non confirmée" — Olivier 2026-06-14 : remonté
            en alerte en haut de fiche (était enfoui dans le bloc Restituer). */}
        {status === 'parked' && ['police_saisie', 'police_rodeo'].includes(initialMission.source)
          && !(initialMission as any).police_levee_saisie_ok && (
          <div className="px-4 lg:px-8 pt-4">
            <div className="border-2 rounded-xl p-4 flex items-start gap-3 bg-rose-50 border-rose-500">
              <span className="text-2xl">📋</span>
              <div className="flex-1 min-w-0">
                <p className="text-rose-700 text-sm font-bold uppercase tracking-wide">Levée de saisie non confirmée</p>
                <p className="text-rose-900 text-xs mt-1">
                  Le véhicule reste bloqué tant que la levée n'est pas enregistrée. Utilise « 🔓 Levée de saisie » dans l'encadré Saisie avant toute restitution.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Bandeau infos additionnelles (Olivier 2026-05-26) : agrege les
            infos utiles non editables ailleurs sur la fiche. */}
        {(initialMission.vehicle_class === 'moto' || initialMission.distance_km
          || initialMission.snc_scenario || initialMission.snc_requires_balisage) && (
          <div className="px-4 lg:px-8 pt-4">
            <div className="bg-surface border rounded-xl p-4 space-y-2">
              <p className="text-ink-muted text-xs uppercase tracking-widest font-semibold">Infos mission</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                {initialMission.vehicle_class === 'moto' && (
                  <div className="flex items-center gap-2">
                    <span>🏍️</span><span>Véhicule : <strong>Moto / 2 roues</strong></span>
                  </div>
                )}
                {(initialMission.distance_km != null && initialMission.distance_km > 0) && (
                  <div className="flex items-center gap-2">
                    <span>🛣️</span><span><strong>{initialMission.distance_km} km</strong>{initialMission.duration_min ? ` · ~${initialMission.duration_min} min` : ''}</span>
                  </div>
                )}
                {(initialMission.source === 'police_snc' || initialMission.source === 'sia_couvert') && initialMission.snc_scenario && (
                  <div className="flex items-center gap-2">
                    <span>🛣️</span>
                    <span>Scénario : <strong>{
                      initialMission.snc_scenario === 'dsp'        ? 'DSP — dépannage sur place'
                    : initialMission.snc_scenario === 'rem_client' ? 'REM avec paiement immédiat'
                    : initialMission.snc_scenario === 'rem_direct' ? 'REM directe'
                    : initialMission.snc_scenario === 'rem_depot'  ? 'REM vers dépôt Pepinster'
                    : initialMission.snc_scenario
                    }</strong></span>
                  </div>
                )}
                {initialMission.snc_requires_balisage && (
                  <div className="flex items-center gap-2 text-amber-700">
                    <span>🚧</span><span className="font-semibold">Balisage requis (autoroute / voie rapide)</span>
                  </div>
                )}
              </div>
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

              {/* Bloc Police (zone + agent) — au-dessus de Véhicule/Intervention.
                  Olivier 2026-06-14 : agent en autocomplete des contacts de la
                  société Odoo de la zone. */}
              {(form.source || initialMission.source || '').startsWith('police_') && (
                <div className="relative z-30 bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter space-y-3">
                  <h2 className="text-ink font-semibold text-sm flex items-center gap-2"><span>🚓</span> Police</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-ink-secondary text-xs font-medium mb-1">Zone de police</label>
                      <select
                        value={form.police_zone || ''}
                        onChange={e => { f('police_zone')(e.target.value); setForm(prev => ({ ...prev, officer_partner_id: null })) }}
                        className="w-full bg-surface border border-strong rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-brand">
                        <option value="">— Choisir —</option>
                        {policeZoneNames.map(z => <option key={z} value={z}>{z}</option>)}
                        {form.police_zone && !policeZoneNames.includes(form.police_zone) && (
                          <option value={form.police_zone}>{form.police_zone}</option>
                        )}
                      </select>
                    </div>
                    <OfficerAutocomplete
                      label="Nom du policier"
                      value={form.officer_name || ''}
                      onChange={v => f('officer_name')(v)}
                      onPickPartner={id => setForm(prev => ({ ...prev, officer_partner_id: id }))}
                      companyId={zoneCompanyMap[form.police_zone || ''] ?? null}
                    />
                  </div>
                </div>
              )}

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
                      {/* Crée réellement le véhicule dans Odoo (à la fiche) + le lie */}
                      {form.vehicle_plate.trim().length >= 3 && (
                        <button type="button" onClick={createOdooVehicle} disabled={vehicleCreating}
                          className="mt-2 w-full text-center px-3 py-2 bg-surface hover:bg-surface-2 border border-dashed rounded-lg text-ink-secondary hover:text-ink text-xs transition disabled:opacity-50">
                          {vehicleCreating ? '⏳ Création…' : '➕ Aucun ne correspond — créer un nouveau véhicule'}
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
                      <DynamicSourceSelect value={form.source} onChange={handleSourceChange} />
                    </Field>
                    {/* Olivier 2026-06-02 PM : pour SNC/SC le mission_type est
                        derive automatiquement du scenario (dsp → depannage,
                        rem_* → remorquage). On cache le champ pour eviter
                        l incoherence. Auto-fill se fait dans onClick tuile. */}
                    {!(form.source === 'police_snc' || form.source === 'sia_couvert') && (
                      <Field label="Type de mission">
                        <Select value={form.mission_type} onChange={f('mission_type')} options={MISSION_TYPES} />
                      </Field>
                    )}
                    {(form.source === 'police_snc' || form.source === 'sia_couvert') && (
                      <div className="col-span-2 space-y-2">
                        <Field label="Scénario SNC (optionnel — modifiable par le chauffeur)">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {([
                              { key: '',           label: '🤷 Laisser le chauffeur choisir', desc: 'Aucune pré-indication — le chauffeur décide selon ce qu\'il constate.' },
                              { key: 'dsp',        label: '🔧 DSP — Dépannage sur place',  desc: 'Réparation sur autoroute.' },
                              ...(form.source === 'police_snc' ? [{
                                key: 'rem_client', label: '🚛 REM client',                 desc: 'Remorquage vers destination du client, paiement immédiat.',
                              }] : []),
                              ...(form.source === 'sia_couvert' ? [{
                                key: 'rem_direct', label: '🚛 REM directe',                desc: 'Remorquage direct sans passage dépôt (forfait SC + km livraison).',
                              }] : []),
                              { key: 'rem_depot',  label: '🏢 REM dépôt Pepinster',        desc: 'Mise en zone Transit, relivraison ultérieure.' },
                            ] as Array<{ key: string; label: string; desc: string }>).map(opt => {
                              const isActive = (form.snc_scenario || '') === opt.key
                              // Auto-derive mission_type depuis le scenario
                              // (dsp → depannage, rem_* → remorquage, vide → garde)
                              const derivedType = opt.key === 'dsp'
                                ? 'depannage'
                                : opt.key.startsWith('rem_')
                                  ? 'remorquage'
                                  : form.mission_type
                              return (
                                <button
                                  key={opt.key || 'none'}
                                  type="button"
                                  onClick={() => setForm(prev => ({
                                    ...prev,
                                    snc_scenario: opt.key,
                                    mission_type: derivedType,
                                  }))}
                                  className={`p-3 rounded-xl border-2 text-left transition ${
                                    isActive
                                      ? 'bg-blue-100 border-blue-600 ring-2 ring-blue-300'
                                      : 'bg-surface border hover:border-blue-400'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-ink font-semibold text-sm">{opt.label}</span>
                                    {isActive && <span className="text-blue-700 text-xs font-bold flex-shrink-0">✓ Actif</span>}
                                  </div>
                                  <div className="text-ink-muted text-xs mt-0.5">{opt.desc}</div>
                                </button>
                              )
                            })}
                          </div>
                        </Field>
                        {/* Toggle balisage (impacte le tarif live) */}
                        <label className="flex items-start gap-3 cursor-pointer p-3 bg-surface border rounded-xl hover:border-blue-400">
                          <input
                            type="checkbox"
                            checked={Boolean(form.snc_requires_balisage)}
                            onChange={e => setForm(prev => ({ ...prev, snc_requires_balisage: e.target.checked }))}
                            className="mt-1 w-5 h-5"
                          />
                          <div className="flex-1">
                            <div className="text-ink text-sm font-medium">Intervention avec balisage (véhicule de sécurité)</div>
                            <div className="text-ink-muted text-xs mt-0.5">
                              Coche si un véhicule de sécurité doit être placé (autoroute / voie rapide). Génère un supplément SIABAL.
                            </div>
                          </div>
                        </label>

                        <p className="text-blue-900 text-xs bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5">
                          ℹ️ Tu peux pré-indiquer scénario + balisage pour orienter le chauffeur. Il pourra les modifier depuis sa fiche selon ce qu&apos;il constate sur place.
                        </p>
                      </div>
                    )}
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
                {(() => {
                  const notice = garageNotice(form.destination_address) || garageNotice((initialMission as any).redelivery_address)
                  return notice ? (
                    <div className="vd-blink mb-4 px-3 py-2.5 bg-red-500/20 border border-red-500/60 rounded-xl text-red-700 dark:text-red-300 text-xs font-semibold flex items-start gap-2">
                      <span className="text-base leading-none">🔒</span><span>{notice}</span>
                    </div>
                  ) : null
                })()}
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
                      // Autoroute "A27 BK22.3…" non géocodable par Google : dès qu'on
                      // quitte le champ, on résout la borne (SPW) → coords + ville.
                      onBlur={() => { applyIncidentHighway(form.incident_address) }}
                      gmKey={googleMapsKey}
                      placeholder="Tapez une adresse, ou 'A27 BK22.3 dir. Luxembourg'"
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
                    <textarea value={incidentInfo} onChange={e => setIncidentInfo(e.target.value)}
                      onBlur={() => silentPatch({ incident_info: incidentInfo.trim() || null })}
                      rows={2} placeholder="ℹ️ Info complémentaire intervention (visible chauffeur) — ex : code portail, demander Mr X…"
                      className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand resize-none" />
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
                    <textarea value={destinationInfo} onChange={e => setDestinationInfo(e.target.value)}
                      onBlur={() => silentPatch({ destination_info: destinationInfo.trim() || null })}
                      rows={2} placeholder="ℹ️ Info complémentaire destination (visible chauffeur) — ex : livrer à l'arrière, demander la réception…"
                      className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand resize-none" />
                  </div>
                  )}
                </div>

                {/* Info complémentaire relivraison — visible quand une adresse de
                    relivraison est définie. Olivier 2026-06-30. */}
                {(initialMission as any).redelivery_address && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-1">Relivraison</p>
                    <p className="text-ink-secondary text-xs mb-1.5">📍 {(initialMission as any).redelivery_address}</p>
                    <textarea value={redeliveryInfo} onChange={e => setRedeliveryInfo(e.target.value)}
                      onBlur={() => silentPatch({ redelivery_info: redeliveryInfo.trim() || null })}
                      rows={2} placeholder="ℹ️ Info complémentaire relivraison (visible chauffeur)…"
                      className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand resize-none" />
                  </div>
                )}
                {/* Garage fermé : date de réouverture (info + rappel dispatch le jour J).
                    Visible si un motif garage fermé OU une date déjà saisie OU en parc.
                    Éditable dispatch. Olivier 2026-07-14. */}
                {((initialMission as any).dpr_motif === 'garage_ferme' || garageReopen || status === 'parked') && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-1.5">🔒 Réouverture garage</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input type="date" value={garageReopen}
                        onChange={e => { setGarageReopen(e.target.value); silentPatch({ garage_reopen_date: e.target.value || null }) }}
                        className="bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
                      {garageReopen && (
                        <button type="button" onClick={() => { setGarageReopen(''); silentPatch({ garage_reopen_date: null }) }}
                          className="text-ink-muted hover:text-ink text-xs underline">Effacer</button>
                      )}
                    </div>
                    <p className="text-ink-faint text-xs mt-1">Le dispatch recevra un rappel ce jour-là pour relivrer le véhicule.</p>
                  </div>
                )}
                {/* Kilométrage estimé — intégré au bloc Lieu/Destination (Olivier 2026-06-14) */}
                <div className="mt-4 pt-4 border-t">
                  <MissionKmInfo missionId={initialMission.id} refreshKey={String(kmRefresh)} />
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

              {/* Montant garanti + Paiement client + Tarif special */}
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                <h2 className="text-ink font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>💶</span> Montants
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Montant garanti (EUR HTVA)">
                    <Input value={form.amount_guaranteed} onChange={fNum('amount_guaranteed')} placeholder="0.00" />
                  </Field>
                  <Field label="Paiement à réclamer au client (€)">
                    <Input value={form.amount_to_collect} onChange={fNum('amount_to_collect')} placeholder="0.00" />
                  </Field>
                </div>

                {/* Olivier 2026-06-02 PM : tarif special HTVA pour interventions
                    hors cadre (prix convenu avec client/assistance). Si rempli,
                    ECRASE le calcul automatique → une seule ligne SERV-DIV
                    "Intervention suivant prix convenu" a la facturation.
                    Pas visible cote chauffeur (pas un encaissement client). */}
                <div className={`mt-4 border-2 rounded-xl p-3 ${
                  form.special_tarif_htva && Number(form.special_tarif_htva) > 0
                    ? 'border-amber-500 bg-amber-50'
                    : 'border-dashed border-amber-300 bg-amber-50/30'
                }`}>
                  <Field label={
                    <span className="flex items-center gap-2">
                      <span className="text-amber-700 text-base">⚡</span>
                      <span className="text-amber-900 font-semibold">Tarif spécial HTVA (écrase le calcul)</span>
                    </span>
                  }>
                    <Input
                      value={form.special_tarif_htva}
                      onChange={fNum('special_tarif_htva')}
                      placeholder="Ex: 250.00"
                    />
                  </Field>
                  <p className="text-amber-900 text-xs mt-2">
                    À utiliser uniquement si tu as convenu d&apos;un prix spécifique avec le client / l&apos;assistance.
                  </p>
                  {form.special_tarif_htva && Number(form.special_tarif_htva) > 0 && (
                    <p className="text-amber-900 text-xs mt-1 font-semibold">
                      🔔 Le tarif spécial est ACTIF — {Number(form.special_tarif_htva).toFixed(2)} € HTVA sera facturé.
                    </p>
                  )}
                </div>

                {/* Olivier 2026-06-02 PM : dates parc modifiables (entree / sortie).
                    Le gardiennage est calcule sur cette fenetre uniquement. */}
                <div className="mt-4 pt-4 border-t">
                  <h3 className="text-ink font-semibold text-xs mb-3 flex items-center gap-2">
                    <span>🅿️</span> Gardiennage (dates de passage en parc)
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Entrée parc">
                      <input
                        type="datetime-local"
                        value={form.parked_at}
                        onChange={e => f('parked_at')(e.target.value)}
                        className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand"
                      />
                    </Field>
                    <Field label="Sortie parc">
                      <input
                        type="datetime-local"
                        value={form.delivering_at}
                        onChange={e => f('delivering_at')(e.target.value)}
                        className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand"
                      />
                    </Field>
                  </div>
                  <p className="text-ink-muted text-xs mt-2">
                    Si vide : pas de gardiennage facturé. Sortie vide + entrée définie = encore en parc (facturé jusqu&apos;à aujourd&apos;hui).
                  </p>
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
                        <PhotoGrid photos={initialMission.driver_photos} />
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
                  ) : initialMission.invoice_method === 'auto' ? (
                    <div className="bg-success-soft border border-success rounded-xl p-3">
                      <p className="text-success text-sm font-semibold">⚡ Auto-facturée (assistance)</p>
                      <p className="text-ink-muted text-xs mt-1">Facturée par l'assistance (Clôture Allianz / Touring BKO).</p>
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
                {showRawContent && initialMission.raw_content && (
                  <div className="px-5 pb-3">
                    <a href={`/api/missions/${initialMission.id}/source`} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1.5 text-info hover:underline text-xs font-semibold">
                      🖨️ Version imprimable / PDF ↗
                    </a>
                  </div>
                )}
                {showRawContent && initialMission.raw_content
                  && (['admin', 'superadmin', 'dispatcher'].includes(userRole) || userModules.includes('fourriere')) && (
                  <ReparseButton missionId={initialMission.id} />
                )}
              </div>

              {/* Trajet du chauffeur — carte Google repliable (tracé GPS + lieux
                  de pointage). Olivier 2026-06-16 : placé au-dessus des Remarques. */}
              <DriverRouteCard missionId={initialMission.id} gmKey={googleMapsKey} />

              {/* Clés : emplacement + n° crochet (le dessin reste dans le bandeau
                  Position parc). Affiché pour parked / police / privé. */}
              {(status === 'parked' || isSaisieSource(initialMission.source) || keyLoc) && (
                <KeyControls
                  source={initialMission.source}
                  keyLocation={keyLoc}
                  hookInput={keyHookInput}
                  savedHook={keyHookSaved}
                  onPick={pickKeyLocation}
                  onHookChange={setKeyHookInput}
                  onHookSave={saveKeyHook}
                />
              )}

              {/* Remarques SOURCE (parsées du mail + checklist Touring annexé) —
                  lecture seule. Olivier 2026-06-19 : avant, remarks_general
                  n'était affiché QUE côté chauffeur → le dispatcher ne voyait pas
                  le checklist annexé. */}
              {(initialMission as any).remarks_general && (
                <div className="bg-surface border rounded-2xl p-5">
                  <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide mb-2">📋 Remarques (source)</p>
                  <p className="text-ink text-sm whitespace-pre-wrap">{(initialMission as any).remarks_general}</p>
                </div>
              )}

              {/* Remarques — ajout centralisé via le modal typé (bouton dans la
                  colonne de droite sous Sauvegarder) ; les 3 sections restent
                  affichées ici en lecture (sans champ d'ajout). Olivier 2026-07-10. */}
              <BillingRemarks
                missionId={initialMission.id}
                currentUserId={userId}
                isSuperadmin={userRole === 'superadmin'}
                legacyRemark={initialMission.remarks_billing}
                onCountChange={setBillingRemarkCount}
                hideAdd
                refreshKey={remarksRefreshKey}
              />

              {/* Instructions chauffeur — pop-up à l'acceptation. Olivier 2026-07-10. */}
              <DriverInstructions
                missionId={initialMission.id}
                onCountChange={setDriverInstrCount}
                hideAdd
                refreshKey={remarksRefreshKey}
              />

              {/* Remarques dispatcher (notes + pièces jointes) */}
              <MissionRemarks
                missionId={initialMission.id}
                onCountChange={setGeneralRemarkCount}
                hideAdd
                refreshKey={remarksRefreshKey}
              />

              {/* Contacts & interactions (répertoire + visites/appels/notes) */}
              <FicheContactsPanel missionId={initialMission.id} />

              {/* Historique — Olivier 2026-06-14 : placé sous les Remarques */}
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

            {/* ── Colonne droite : actions + chauffeur + logs ───────── */}
            <div className="space-y-5">

              {/* Bouton « Sauvegarder & notifier » — sticky en tête de colonne, au
                  niveau des boutons de restitution. Reste visible au scroll.
                  Les champs s'enregistrent déjà en auto ; ce bouton notifie le
                  chauffeur + fige les dates parc. Olivier 2026-06-14. */}
              {status !== 'ignored' && (
                <div className="sticky top-[76px] z-10">
                  <button
                    onClick={handleSave}
                    disabled={loadingSave || vehicleDecisionPending}
                    title="Sauvegarder les modifications"
                    className="w-full py-3 bg-brand hover:bg-brand/80 text-white rounded-2xl font-semibold text-sm shadow-lg shadow-brand/20 transition disabled:opacity-50"
                  >
                    {loadingSave ? '⏳ Sauvegarde…' : saveOk ? '✅ Enregistré' : '💾 Sauvegarder les modifications'}
                  </button>
                </div>
              )}

              {/* Ajouter une remarque — sous Sauvegarder (Olivier 2026-07-10).
                  Ouvre le modal typé (générale / facturation / instruction chauffeur). */}
              {status !== 'ignored' && (
                <button
                  type="button"
                  onClick={() => { setRemarksModalType('general'); setRemarksModalOpen(true) }}
                  className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2"
                >
                  ➕ Ajouter une remarque
                </button>
              )}

              {/* Relancer la complétion Hexalite (missions Allianz/Mondial). */}
              {['mondial', 'allianz'].includes(initialMission.source)
                && !['cancelled', 'ignored'].includes(status) && (
                <AllianzCompleteButton missionId={initialMission.id} onDone={() => router.refresh()} />
              )}

              {/* Forcer en parc — Olivier 2026-06-22 : déplacé ici, juste sous
                  Sauvegarder (était dans le bloc Actions dispatcher). Pour les
                  véhicules pas encore en parc. */}
              {['admin', 'superadmin', 'dispatcher'].includes(userRole)
                && !['parked', 'cancelled', 'ignored'].includes(status) && (
                <button
                  type="button"
                  onClick={() => setShowForceParkModal(true)}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl text-sm font-bold shadow-lg shadow-amber-500/20 transition flex items-center justify-center gap-2"
                >
                  🅿️ Mettre en Parc
                </button>
              )}

              {/* Bloc Relivraison — Olivier 2026-06-22 : placé juste sous le
                  bouton Sauvegarder. Bouton unique + modal (adresse pré-remplie)
                  sur toute fiche en parc. */}
              {status === 'parked' && !linkedChild && (
                <RelivraisonModalButton
                  missionId={initialMission.id}
                  currentAddress={(initialMission as any).redelivery_address || ''}
                  currentLat={(initialMission as any).redelivery_lat ?? null}
                  currentLng={(initialMission as any).redelivery_lng ?? null}
                  gmKey={googleMapsKey}
                  parentSource={initialMission.source}
                  onDone={() => router.refresh()}
                  saisieWarning={
                    ['police_saisie', 'police_rodeo'].includes(initialMission.source)
                    && !(initialMission as any).police_levee_saisie_ok
                  }
                />
              )}

              {/* Fusionner une fiche en double (cette fiche est conservée).
                  Olivier 2026-06-17. */}
              {status !== 'cancelled' && status !== 'ignored' && (
                <MergeMissionButton missionId={initialMission.id} />
              )}

              {/* Facture partielle — véhicule en parc : facturer le dépannage /
                  une tranche de gardiennage sans sortir le véhicule du parc. */}
              {status === 'parked' && (
                <button
                  onClick={() => setShowPartialInvoice(true)}
                  className="w-full py-2.5 bg-surface-2 hover:bg-surface border rounded-2xl text-ink-secondary text-sm font-medium transition">
                  🧾 Facture partielle
                </button>
              )}

              {/* Bouton Restituer — Olivier 2026-06-14 : remonté en haut du bloc
                  droit (permuté avec l'impression d'étiquette). Visible pour
                  TOUTES les sources Appel Police (+ sia_couvert) en parc.
                  Warnings conditionnels avant redirection (saisie / bloqué police). */}
              {status === 'parked' && ['police_mg', 'police_rodeo', 'police_accident', 'police_saisie', 'police_avp', 'police_snc', 'sia_couvert'].includes(initialMission.source) && (
                <>
                  {policeBlocked && (
                    <div className="bg-warning/10 border border-warning/40 rounded-2xl p-3 flex items-start gap-2">
                      <span className="text-warning">🚓</span>
                      <p className="text-warning text-sm font-medium">
                        Bloquée par la police — confirmation obligatoire à la restitution (client doit être passé au commissariat)
                      </p>
                    </div>
                  )}
                  {/* Restituer et facturer — réservé à l'équipe facturation.
                      Recherche/création client Odoo, passe la mission à facturer
                      puis bascule sur le module Facturation. Olivier 2026-06-14. */}
                  {(userModules.includes('facturation') || ['admin', 'superadmin'].includes(userRole)) && (
                    <button
                      onClick={() => setShowRestituerFacturer(true)}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-sm font-semibold transition flex items-center justify-center gap-2">
                      🧾 Restituer et facturer
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const src = initialMission.source
                      const isSaisie = ['police_saisie', 'police_rodeo'].includes(src)
                      const leveeManquante = isSaisie && !(initialMission as any).police_levee_saisie_ok
                      // Warning saisie : confirmer la levee
                      if (leveeManquante) {
                        if (!confirm('⚠ SAISIE\n\nLa levée de saisie est-elle bien confirmée (documents reçus du Parquet/Police) ?\n\nSi non, ne PAS restituer le véhicule.')) return
                      }
                      // Warning vehicule bloque police : confirmer passage commissariat
                      if (policeBlocked) {
                        if (!confirm('⚠ VÉHICULE BLOQUÉ PAR LA POLICE\n\nLe propriétaire est-il bien passé au commissariat pour faire lever le blocage ?\n\nSi non, ne PAS restituer.')) return
                      }
                      // Tout OK -> module encaissement chauffeur
                      const url = buildEncaissementUrl(initialMission as any, {
                        returnTo: `/dispatch/${initialMission.id}`,
                      })
                      window.location.href = url
                    }}
                    className="w-full py-3 bg-brand hover:bg-brand-hover text-white rounded-2xl text-sm font-semibold transition flex items-center justify-center gap-2">
                    🔑 Restituer le véhicule (encaissement chauffeur)
                  </button>
                </>
              )}

              {/* Facturer — visible quand la fiche est en facturation (to_invoice)
                  et que l'user a accès facturation (même visibilité que le module
                  Facturation). Ouvre le même modal. Olivier 2026-06-30. */}
              {status === 'to_invoice'
                && (['admin', 'superadmin'].includes(userRole) || userModules.includes('facturation')) && (
                <FicheFacturerButton missionId={initialMission.id} />
              )}

              {/* Panneau Saisie (réquisitoire / levée de saisie / Domaine) —
                  Olivier 2026-06-14 : remonté en haut du bloc droit. */}
              {(['police_saisie', 'police_mg', 'police_rodeo', 'police_avp'].includes(initialMission.source) || parcZoneType === 'saisie') && (
                <SaisiePanel
                  mission={initialMission as any}
                  forceSaisie={parcZoneType === 'saisie' && !['police_saisie', 'police_mg', 'police_rodeo', 'police_avp'].includes(initialMission.source)}
                  onChanged={() => router.refresh()} />
              )}

              {/* Annuler la fiche — entre "Restituer" et "Avance de fonds".
                  Passe en 'cancelled' (invisible dans l'app, conservée en base). */}
              {status !== 'cancelled'
                && (['admin', 'superadmin', 'dispatcher'].includes(userRole)
                    || userModules.includes('facturation')
                    || userModules.includes('fourriere')) && (
                <CancelMissionButton
                  missionId={initialMission.id}
                  className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-sm font-semibold transition"
                  onCancelled={() => {
                    if (typeof window !== 'undefined' && window.history.length > 1) router.back()
                    else router.push('/dispatch')
                  }}
                />
              )}

              {/* Avance de fonds — Olivier 2026-06-01 : permet a un dispatcher
                  (ou admin) d enregistrer une avance liee a cette mission. La
                  facture sera ajoutee au devis Odoo lors de la facturation. */}
              <a
                href={`/avance-fonds?mission_id=${initialMission.id}&plate=${encodeURIComponent(initialMission.vehicle_plate || '')}&brand=${encodeURIComponent(initialMission.vehicle_brand || '')}&model=${encodeURIComponent(initialMission.vehicle_model || '')}&mission_ref=${encodeURIComponent(initialMission.dossier_number || initialMission.external_id || '')}`}
                className="block w-full py-3 bg-indigo-50 border-2 border-indigo-200 hover:border-indigo-400 hover:bg-indigo-100 text-indigo-900 rounded-2xl text-sm font-bold text-center transition md-card-enter"
              >
                💰 Avance de fonds pour cette mission
              </a>


              {linkedChild && (
                <div className="bg-purple-500/10 border border-purple-500/30 rounded-2xl p-4">
                  <p className="text-purple-400 text-xs font-bold uppercase tracking-wide mb-2">🚛 Relivraison liée</p>
                  <p className="text-ink text-sm font-medium">{linkedChild.mission_number != null ? `#${linkedChild.mission_number}` : (linkedChild.external_id || linkedChild.dossier_number || linkedChild.id.slice(0, 8))}</p>
                  <p className="text-ink-muted text-xs mb-3">Statut : {linkedChild.status}</p>
                  <Link href={`/dispatch/${linkedChild.id}`}
                    className="block w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium text-center transition">
                    Ouvrir la fiche REL →
                  </Link>
                </div>
              )}

              {linkedParent && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                  <p className="text-amber-400 text-xs font-bold uppercase tracking-wide mb-2">🚗 Mission parente (REM)</p>
                  <p className="text-ink text-sm font-medium">{linkedParent.mission_number != null ? `#${linkedParent.mission_number}` : (linkedParent.external_id || linkedParent.dossier_number || linkedParent.id.slice(0, 8))}</p>
                  <p className="text-ink-muted text-xs mb-3">Issue du remorquage initial</p>
                  <Link href={`/dispatch/${linkedParent.id}`}
                    className="block w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-medium text-center transition">
                    Ouvrir la fiche REM parente →
                  </Link>
                </div>
              )}

              {/* Actions — affichées seulement si la mission est à confirmer/assigner
                  (sinon le statut est déjà dans l'en-tête). Olivier 2026-06-14. */}
              {(['new', 'dispatching'].includes(status) || vehicleDecisionPending) && (
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
                      onClick={handleRefuse}
                      disabled={loadingRefuse}
                      className="w-full py-2.5 bg-surface hover:bg-critical-soft border hover:border-critical text-ink-secondary hover:text-critical rounded-xl font-medium text-sm transition disabled:opacity-50"
                    >
                      {loadingRefuse ? 'Annulation...' : '🚫 Annuler la mission'}
                    </button>
                  </>
                )}

                {/* Dépôt + Chauffeur + Sauvegarder déplacés dans l'en-tête
                    opérationnel en haut de fiche (Olivier 2026-06-14).
                    Le libellé de statut (ex: « parked ») est déjà dans l'en-tête. */}
              </div>
              )}

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
                    {/* 'Forcer en parc' déplacé sous 'Sauvegarder les modifications'. */}
                  </div>
                </div>
              )}

              {/* ── Dupliquer la mission (superadmin uniquement) ────────────── */}
              {userRole === 'superadmin' && (
                <DuplicateMissionButton missionId={initialMission.id} />
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
                  <PhotoGrid photos={M.driver_photos} />
                  {/* OCR manuel : uniquement si VIN OU plaque manque, ET pas déjà tenté
                      (une seule tentative par fiche — le superadmin peut outrepasser). */}
                  {(!(M.vehicle_plate || '').trim() || !((M as any).vehicle_vin || '').trim())
                    && (!(M as any).vehicle_ocr_attempted_at || userRole === 'superadmin') && (
                    <VehicleOcrFillButton
                      missionId={M.id}
                      canBypass={userRole === 'superadmin'}
                      onFilled={f => setM(prev => ({ ...prev, ...f } as any))}
                    />
                  )}
                </div>
              )}

              {/* Kilométrage intégré au bloc Lieu/Destination (Olivier 2026-06-14). */}

              {/* Bloc Référence déplacé en haut de fiche (Olivier 2026-06-14). */}

              {/* Bouton Relivrer + encarts linkedChild/linkedParent : DEPLACES EN HAUT
                  du bloc droit (Olivier 2026-05-27 Fix I). Ne PAS dupliquer ici. */}

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

              {/* Imprimer étiquette parc — Olivier 2026-06-14 : permuté vers le bas
                  (était en haut du bloc droit, échangé avec le bouton Restituer). */}
              {(status === 'parked' || (initialMission as any).parc_zone_key) &&
                (userModules.includes('fourriere') || ['admin', 'superadmin'].includes(userRole)) && (
                <PrintLabelButton missionId={initialMission.id} />
              )}

              {/* Encarts linkedChild + linkedParent : DEPLACES EN HAUT du bloc droit
                  (Olivier 2026-05-27 Fix I). Ne PAS dupliquer ici. */}

              {/* Bouton fiche TowSoft (origine externe) — Olivier 2026-06-06 */}
              {/* Migration fourriere : permet l acces aux photos sans scrape. */}
              {initialMission.external_id?.startsWith('TS-') && (
                <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition md-card-enter">
                  <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-3">Fiche d origine</h3>
                  <a
                    href={`https://verviers.towsoft.ca/appel.php?num=${initialMission.external_id.replace(/^TS-/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-medium text-center transition"
                  >
                    🔗 Voir la fiche TowSoft (photos) ↗
                  </a>
                  <p className="text-ink-muted text-xs mt-2">
                    Accès direct aux photos d origine. Nécessite d être connecté à TowSoft.
                  </p>
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

            </div>
          </div>
        </div>

        {/* Estimation tarif — tout en bas (non prioritaire)
            Olivier 2026-06-02 : overrides du form pour avoir le tarif live
            quand le dispatcher change mission_type / source / SNC / adresses
            sans avoir a sauvegarder + refresh. Le debounce est dans la card. */}
        <div className="px-4 lg:px-8 pt-4 pb-8">
          <PriceEstimateCard
            missionId={initialMission.id}
            overrides={{
              source:                 form.source,
              mission_type:           form.mission_type,
              snc_scenario:           form.snc_scenario || null,
              snc_requires_balisage:  Boolean(form.snc_requires_balisage),
              incident_lat:           form.incident_lat   ? Number(form.incident_lat)   : null,
              incident_lng:           form.incident_lng   ? Number(form.incident_lng)   : null,
              destination_lat:        form.destination_lat ? Number(form.destination_lat) : null,
              destination_lng:        form.destination_lng ? Number(form.destination_lng) : null,
              billed_to_id:           billedPartnerId,
              billed_to_name:         form.billed_to_name,
              special_tarif_htva:     form.special_tarif_htva ? Number(form.special_tarif_htva) : null,
              parked_at:              localDtToIso(form.parked_at),
              delivering_at:          localDtToIso(form.delivering_at),
            }}
          />
        </div>
        </div>
      </div>

      {/* Modal "Forcer en parc" : sélection dépôt + zone parc */}
      {showForceParkModal && (
        <ForceParkModal
          missionId={initialMission.id}
          currentDepotId={depotId || null}
          currentZone={(initialMission as any).parc_zone_key || null}
          onClose={() => setShowForceParkModal(false)}
          onDone={() => {
            setShowForceParkModal(false)
            setStatus('parked')
            setM(prev => ({ ...prev, status: 'parked', parked_at: new Date().toISOString() } as any))
            router.refresh()
          }}
        />
      )}

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

      {showPartialInvoice && (
        <PartialInvoiceModal
          missionId={initialMission.id}
          parkedSince={(initialMission as any).parked_at || initialMission.intervention_date || null}
          onClose={() => setShowPartialInvoice(false)}
          onDone={() => { setShowPartialInvoice(false); router.refresh() }}
        />
      )}
      {showCreateClientModal && (
        <CreateClientModal
          initialName={clientQuery || form.billed_to_name || ''}
          gmKey={googleMapsKey}
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
      {/* Restituer et facturer (équipe facturation) — Olivier 2026-06-14 */}
      {showRestituerFacturer && (
        <RestituerEtFacturerModal
          mission={{
            id:                     initialMission.id,
            mission_number:         initialMission.mission_number,
            external_id:            initialMission.external_id,
            vehicle_plate:          initialMission.vehicle_plate,
            source:                 initialMission.source,
            police_blocked:         Boolean(initialMission.police_blocked),
            police_levee_saisie_ok: Boolean((initialMission as any).police_levee_saisie_ok),
            client_name:            initialMission.client_name,
            client_phone:           (initialMission as any).client_phone || null,
            client_address:         (initialMission as any).client_address || null,
            billed_to_id:           initialMission.billed_to_id || null,
            billed_to_name:         initialMission.billed_to_name || null,
          }}
          onClose={() => setShowRestituerFacturer(false)}
          onSuccess={(q) => {
            setShowRestituerFacturer(false)
            router.push(`/facturation?q=${encodeURIComponent(q)}`)
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

// ────────────────────────────────────────────────────────────────────
// TransferParcModal : choix depot + zone, update direct + log.
// Module fourriere uniquement (verifie cote API).
// Olivier 2026-06-04.
// ────────────────────────────────────────────────────────────────────

interface DepotWithZones {
  id:               string
  name:             string
  is_default_parc:  boolean
  zones:            Array<{ key: string; label: string }>
}

// Bouton OCR manuel : n'apparaît QUE si VIN ou plaque manque (voir gate à l'appel).
// Complète les champs VIDES depuis les photos chauffeur. AUCUNE action de
// facturation/Odoo — juste remplissage + log. Olivier 2026-07-13.
function VehicleOcrFillButton({ missionId, onFilled, canBypass = false }: {
  missionId: string
  onFilled:  (f: { vehicle_plate?: string; vehicle_vin?: string }) => void
  canBypass?: boolean   // superadmin : peut relancer sans limite (assume le coût)
}) {
  const [busy,  setBusy]  = useState(false)
  const [msg,   setMsg]   = useState<string | null>(null)
  // Anti-gaspillage IA : une tentative « rien trouvé » désactive le bouton pour
  // cette fiche. Le superadmin (canBypass) peut relancer. Le serveur borne aussi
  // à une tentative par fiche (marqueur persistant), sauf superadmin. Olivier 2026-07-13.
  const [tried, setTried] = useState(false)
  const run = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/ocr-vehicle-fill`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) { setMsg(j.error || 'Échec'); if (!canBypass) setTried(true); return }
      if (j.nothing) {
        setMsg('Aucun VIN/plaque lisible sur les photos.')
        if (!canBypass) setTried(true)
      } else {
        onFilled(j.filled)
        const parts: string[] = []
        if (j.filled.vehicle_vin)   parts.push(`VIN ${j.filled.vehicle_vin}`)
        if (j.filled.vehicle_plate) parts.push(`plaque ${j.filled.vehicle_plate}`)
        setMsg(`✅ Complété : ${parts.join(' · ')}`)
      }
    } catch (e: any) { setMsg(e?.message || 'Erreur'); setTried(true) }
    finally { setBusy(false) }
  }
  return (
    <div className="mt-3">
      <button type="button" onClick={run} disabled={busy || (tried && !canBypass)}
        className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border text-ink-secondary hover:text-ink rounded-lg text-xs font-medium transition disabled:opacity-50">
        {busy ? '⏳ Lecture des photos…' : '🔍 Extraire VIN / plaque des photos'}
      </button>
      {msg && <p className="text-ink-muted text-xs mt-1.5">{msg}</p>}
    </div>
  )
}

// Bouton superadmin : duplique la mission (nouvelle fiche, cycle de vie remis à
// zéro) puis ouvre la copie. Olivier 2026-07-14.
function DuplicateMissionButton({ missionId }: { missionId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (busy) return
    if (!confirm('Dupliquer cette mission ? Une nouvelle fiche sera créée (contenu copié, statut/pointages/paiement remis à zéro).')) return
    setBusy(true)
    try {
      const r = await fetch(`/api/missions/${missionId}/duplicate`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) { alert(j.error || 'Duplication impossible'); return }
      router.push(`/dispatch/${j.id}`)
    } catch (e: any) { alert('Erreur : ' + (e?.message || e)) }
    finally { setBusy(false) }
  }
  return (
    <div className="bg-surface border border-purple-500/30 rounded-2xl p-5 md-card-enter">
      <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-3">🧬 Superadmin</h3>
      <button type="button" onClick={run} disabled={busy}
        className="w-full flex items-center gap-3 px-4 py-3 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-xl text-left transition disabled:opacity-50">
        <span className="text-xl flex-shrink-0">🧬</span>
        <div className="flex-1 min-w-0">
          <p className="text-purple-400 text-sm font-semibold">{busy ? 'Duplication…' : 'Dupliquer la mission'}</p>
          <p className="text-ink-muted text-xs">Crée une nouvelle fiche identique (statut/pointages/paiement remis à zéro)</p>
        </div>
      </button>
    </div>
  )
}

function TransferParcModal({
  missionId,
  currentZoneKey,
  onClose,
  onSuccess,
}: {
  missionId:      string
  currentZoneKey: string
  onClose:        () => void
  onSuccess:      (newZone: string) => void
}) {
  const [depots,      setDepots]      = useState<DepotWithZones[]>([])
  const [orphans,     setOrphans]     = useState<Array<{ key: string; label: string }>>([])
  const [loading,     setLoading]     = useState(true)
  const [selectedDepot, setSelectedDepot] = useState<string>('')  // dépôt cible (défaut Pepinster)
  const [selectedZone, setSelectedZone] = useState<string>('')
  const [reason,       setReason]     = useState('')
  const [submitting,   setSubmitting] = useState(false)
  const [error,        setError]      = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/fourriere/zones-by-depot')
      .then(r => r.json())
      .then(j => {
        const deps: DepotWithZones[] = j.depots || []
        setDepots(deps)
        setOrphans(j.orphans || [])
        // Défaut : Pepinster (parc par défaut, ou repli sur le nom). Olivier 2026-07-10.
        const def = deps.find(d => d.is_default_parc)
          || deps.find(d => /pepinster/i.test(d.name))
          || deps[0]
        if (def) setSelectedDepot(def.id)
      })
      .catch(e => setError(`Chargement KO : ${e?.message}`))
      .finally(() => setLoading(false))
  }, [])

  // Zones du dépôt sélectionné (+ orphelines si « Sans dépôt » choisi).
  const depotZones = selectedDepot === '__orphans__'
    ? orphans
    : (depots.find(d => d.id === selectedDepot)?.zones || [])

  async function submit() {
    if (!selectedZone) { setError('Sélectionne une zone'); return }
    if (selectedZone === currentZoneKey) { setError('Déjà dans cette zone'); return }
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/transfer-parc`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ zone_key: selectedZone, reason: reason.trim() || undefined }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || `HTTP ${r.status}`); return }
      onSuccess(selectedZone)
    } catch (e: any) {
      setError(`Erreur réseau : ${e?.message || e}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface border rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            🔄 Transférer de parc
          </h2>
          <p className="text-xs text-ink-muted mt-1">
            Choisis le nouveau dépôt et la zone. Le véhicule sera marqué non-positionné (à replacer ensuite via plan).
          </p>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <p className="text-ink-muted text-sm text-center py-6">Chargement...</p>
          ) : (
            <>
              {/* Dépôt cible — Pepinster par défaut, modifiable. Olivier 2026-07-10. */}
              <div>
                <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2 block">
                  Dépôt
                </label>
                <select
                  value={selectedDepot}
                  onChange={e => { setSelectedDepot(e.target.value); setSelectedZone('') }}
                  className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
                  autoFocus
                >
                  {depots.map(d => (
                    <option key={d.id} value={d.id}>{d.name}{d.is_default_parc ? ' ★' : ''}</option>
                  ))}
                  {orphans.length > 0 && <option value="__orphans__">Sans dépôt</option>}
                </select>
              </div>

              {/* Zone du dépôt sélectionné */}
              <div>
                <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2 block">
                  Nouvelle zone
                </label>
                <select
                  value={selectedZone}
                  onChange={e => setSelectedZone(e.target.value)}
                  className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
                >
                  <option value="">— Choisir une zone —</option>
                  {depotZones.length === 0 ? (
                    <option disabled>(aucune zone dans ce dépôt)</option>
                  ) : depotZones.map(z => (
                    <option key={z.key} value={z.key} disabled={z.key === currentZoneKey}>
                      {z.label}{z.key === currentZoneKey ? ' (zone actuelle)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2 block">
                  Raison (optionnel)
                </label>
                <input
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Ex : réorganisation, manque de place, scellé levé..."
                  className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
                />
              </div>

              {error && (
                <div className="bg-critical/10 border border-critical/40 rounded-lg px-3 py-2 text-critical text-sm">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 text-ink-muted hover:text-ink text-sm font-semibold transition disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={submitting || loading || !selectedZone}
            className="px-4 py-2 bg-brand hover:bg-brand-dark text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
          >
            {submitting ? 'Transfert...' : 'Confirmer le transfert'}
          </button>
        </div>
      </div>
    </div>
  )
}
