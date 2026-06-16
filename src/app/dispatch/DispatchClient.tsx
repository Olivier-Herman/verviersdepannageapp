'use client'
// src/app/dispatch/DispatchClient.tsx
// P6 — toggle liste/carte + panel statut chauffeurs + cartes colorées par urgence

import { useState, useEffect, useCallback } from 'react'
import Link        from 'next/link'
import { useRouter }   from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import DriverPickerModal from '@/components/DriverPickerModal'
import DispatchMap, { type MapMission, type MapDriver } from '@/components/dispatch/DispatchMap'
import AppShell from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'
import MissionStamp from '@/components/missions/MissionStamp'
import VabImportButton from '@/components/dispatch/VabImportButton'
import DispatcherOnDutyBadge from '@/components/dispatch/DispatcherOnDutyBadge'
import { getSourceLabel, getSourceColor, type SourceDisplay as CatalogSource } from '@/lib/missions/source-display'
import AutoDispatchButton from '@/components/dispatch/AutoDispatchButton'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, horizontalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

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
  mission_type: string | null
  incident_type: string | null
  client_name: string | null
  client_phone: string | null
  assisted_name: string | null
  assisted_phone: string | null
  vehicle_plate: string | null
  vehicle_brand: string | null
  vehicle_model: string | null
  incident_address: string | null
  incident_city: string | null
  incident_lat: number | null
  incident_lng: number | null
  destination_name: string | null
  destination_address: string | null
  received_at: string
  intervention_date: string | null
  incident_at: string | null
  status: string
  assigned_to: string | null
  parse_confidence: number | null
  assigned_user: { id: string; name: string } | null
  warnings?: string[] | null
  invoice_method?: 'manual' | 'auto' | null
  auto_dispatch_status?: string | null
  auto_dispatch_attempt_status?: 'pending' | 'push_sent' | 'call_1_sent' | 'call_2_sent' | null
  auto_dispatch_driver_name?: string | null
  has_pending_derogation?: boolean
  invoice_number?: string | null
}

interface Driver {
  id: string
  name: string
  avatar_url: string | null
}

interface DriverStatus {
  id: string
  name: string
  status: 'en_service' | 'en_mission' | 'hors_service'
  mission_id?: string
  client_name?: string
  mission_type?: string
  schedule_day?: boolean
  schedule_night?: boolean
  on_schedule?: boolean
  fresh_ping?: boolean
  lat?: number | null
  lng?: number | null
}

interface Counters {
  new: number
  dispatching: number
  assigned: number
  in_progress: number
  parked: number
  completed: number
  errors: number
}

type ViewMode = 'list' | 'card' | 'map'

// ── Helpers & Constantes ──────────────────────────────────────────────────────

// SOURCE_LABELS / SOURCES retires : tout vient maintenant de
// mission_source_catalog (charge en prop server-side via la page parent).
// Cf src/lib/missions/source-display.ts pour les helpers getSourceLabel /
// getSourceColor (importes en haut du fichier).

const TYPE_LABELS: Record<string, string> = {
  remorquage:       '🚛 REM',
  relivraison:      '🚛 REL',
  depannage:        '🔧 DSP',
  transport:        '🚐 Transport',
  trajet_vide:      '📍 TVD',
  reparation_place: '🔩 RPL',
  DSP:              '🔧 DSP',
  REM:              '🚛 REM',
  REL:              '🚛 REL',
  Transport:        '🚐 Transport',
  DPR:              '📍 DPR',
  VR:               '🚗 VR',
  autre:            '📋 Autre',
}

/**
 * Label du type de mission. Prend en compte `incident_type=relivraison`
 * pour distinguer REL d un REM standard (cas IMA Benelux : la mission
 * principale et sa relivraison sont toutes les deux mission_type=remorquage,
 * et c est incident_type qui les distingue).
 */
function getTypeLabel(m: { mission_type?: string | null; incident_type?: string | null }): string {
  if (m.incident_type === 'relivraison') return '🚛 REL'
  if (m.incident_type === 'dpr')          return '📍 DPR'
  if (!m.mission_type) return '—'
  return TYPE_LABELS[m.mission_type] || m.mission_type
}

const TABS = [
  { key: 'new',         label: 'En commande', countKey: 'new'         as const },
  { key: 'dispatching', label: 'En attente',  countKey: 'dispatching' as const },
  { key: 'assigned',    label: 'Assignées',   countKey: 'assigned'    as const },
  { key: 'in_progress', label: 'En cours',    countKey: 'in_progress' as const },
  { key: 'parked',      label: 'À Relivrer',  countKey: 'parked'      as const },
  { key: 'all',         label: 'Toutes',      countKey: null },
]
// Note : l'onglet "Terminées" est retire — voir page dediee /missions-terminees
// qui offre une vue plus riche (chips de filtre, tampons, toggle archives).

// La liste des sources vient maintenant en prop depuis le catalog BDD.


type SortMode = 'intervention_date' | 'received_at'

type DelaiUrgency = 'muted' | 'future' | 'ok' | 'warn' | 'alert' | 'critical'
type DelaiResult = {
  label:   string
  color:   string  // text-* token
  bgColor: string  // bg-*-soft token
  urgency: DelaiUrgency
  pulse:   boolean
}

const FR_DAYS_LOWER = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi']

function formatPlannedTime(d: Date, now: Date): string {
  const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  const startOfToday    = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTarget   = new Date(d.getFullYear(),   d.getMonth(),   d.getDate())
  const diffDays = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / (24*60*60*1000))
  if (diffDays === 0) return `à ${time}`
  if (diffDays === 1) return `demain à ${time}`
  if (diffDays > 1 && diffDays < 7) return `${FR_DAYS_LOWER[d.getDay()]} à ${time}`
  return `le ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} à ${time}`
}

function formatLateLabel(lateMs: number): string {
  const oneMin  = 60 * 1000
  const oneHour = 60 * oneMin
  const oneDay  = 24 * oneHour
  const lateMin = Math.floor(lateMs / oneMin)
  if (lateMin < 60) return `il y a ${lateMin}min`
  if (lateMs < oneDay) {
    const hours = Math.floor(lateMs / oneHour)
    const remMin = Math.floor((lateMs % oneHour) / oneMin)
    return remMin === 0 ? `il y a ${hours}h` : `il y a ${hours}h${String(remMin).padStart(2,'0')}`
  }
  const days = Math.floor(lateMs / oneDay)
  if (days === 1) return 'hier'
  return `il y a ${days} jours`
}

// Les statuts ou le suivi du delai d'intervention reste pertinent : la mission
// n'a pas encore ete prise en charge par un chauffeur. Une fois assignee/en
// cours/terminee, le delai cesse de clignoter (et passe en neutre) pour ne pas
// polluer l'attention du dispatcher.
const DELAI_ACTIVE_STATUSES = new Set(['new', 'dispatching'])

function getDelai(dateStr: string | null, status?: string): DelaiResult {
  if (!dateStr) {
    return { label: '—', color: 'text-ink-muted', bgColor: 'bg-surface-2', urgency: 'muted', pulse: false }
  }
  // Mission deja prise en main : on affiche le delai en neutre, plus de pulse
  // ni de couleur d'urgence (le dispatcher n'a plus rien a surveiller dessus).
  if (status && !DELAI_ACTIVE_STATUSES.has(status)) {
    return { label: '—', color: 'text-ink-muted', bgColor: 'bg-surface-2', urgency: 'muted', pulse: false }
  }

  const d   = new Date(dateStr)
  const now = new Date()
  const deltaMs = d.getTime() - now.getTime()  // > 0 = futur, < 0 = retard

  if (deltaMs > 0) {
    return {
      label:   `Prévue ${formatPlannedTime(d, now)}`,
      color:   'text-info',
      bgColor: 'bg-info-soft',
      urgency: 'future',
      pulse:   false,
    }
  }

  const lateMs  = -deltaMs
  const lateMin = Math.floor(lateMs / 60000)
  const label   = formatLateLabel(lateMs)

  if (lateMin < 15) return { label, color: 'text-success',  bgColor: 'bg-success-soft',  urgency: 'ok',       pulse: false }
  if (lateMin < 30) return { label, color: 'text-warning',  bgColor: 'bg-warning-soft',  urgency: 'warn',     pulse: false }
  if (lateMin < 45) return { label, color: 'text-alert',    bgColor: 'bg-alert-soft',    urgency: 'alert',    pulse: true  }
  return              { label, color: 'text-critical', bgColor: 'bg-critical-soft', urgency: 'critical', pulse: true  }
}

const URGENCY_BORDER: Record<DelaiUrgency, string> = {
  muted:    'border',
  future:   'border-info',
  ok:       'border-success',
  warn:     'border-warning',
  alert:    'border-alert',
  critical: 'border-critical animate-pulse',
}

// ── Panel statut chauffeurs ───────────────────────────────────────────────────

const styleByStatus = {
  en_mission:   'bg-alert-soft border-alert text-alert',
  en_service:   'bg-success-soft border-success text-success',
  hors_service: 'bg-surface border text-ink-muted',
} as const
const dotByStatus = {
  en_mission:   'bg-alert-fill',
  en_service:   'bg-success-fill',
  hors_service: 'bg-ink-faint',
} as const

function SortableDriverBadge({ d, onClick, canDrag }: {
  d:       DriverStatus
  onClick: () => void
  canDrag: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: d.id, disabled: !canDrag })
  const isHorsService = d.status === 'hors_service'
  const isOnSchedule  = !!(d as any).on_schedule

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : (isHorsService ? 0.55 : 1),
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      onClick={onClick}
      {...attributes}
      {...listeners}
      title={d.status === 'en_mission'
        ? `${d.client_name || '?'} · ${d.mission_type || ''}`
        : isHorsService
          ? 'Cliquer pour activer la garde · glisser pour réordonner'
          : 'Cliquer pour modifier la garde · glisser pour réordonner'}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition ${
        styleByStatus[d.status]
      } ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} ${
        isHorsService ? 'hover:opacity-100' : 'hover:opacity-80'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotByStatus[d.status]}`} />
      {d.name}
      {d.status === 'en_service' && isOnSchedule && (
        <span className="opacity-70">🛡️</span>
      )}
    </button>
  )
}

function DriverStatusPanel({ statuses, onRefresh, userRole }: {
  statuses:  DriverStatus[]
  onRefresh: () => void
  userRole:  string
}) {
  const [editing, setEditing] = useState<DriverStatus | null>(null)

  // Olivier 2026-06-03 : recupere les plages de garde actives (depuis BDD)
  // au lieu de hardcoded "07h → 20h" / "17h → 09h" dans la modal toggle.
  type SchedulePeriod = { hour_start: number; hour_end: number; cross_midnight: boolean }
  const [schedulePeriods, setSchedulePeriods] = useState<{ day: SchedulePeriod[]; night: SchedulePeriod[] }>({ day: [], night: [] })
  useEffect(() => {
    fetch('/api/schedule/active')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSchedulePeriods({ day: d.day || [], night: d.night || [] }) })
      .catch(() => {})
  }, [])
  const fmtPeriod = (p: SchedulePeriod) => {
    const fh = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}h${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`
    return `${fh(p.hour_start)} → ${fh(p.hour_end)}`
  }
  const dayLabel   = schedulePeriods.day.length   > 0 ? schedulePeriods.day.map(fmtPeriod).join(', ')   : '07h → 20h'
  const nightLabel = schedulePeriods.night.length > 0 ? schedulePeriods.night.map(fmtPeriod).join(', ') : '17h → 09h'
  // Etat local optimiste : on re-ordonne immediatement au drop, puis on persiste.
  // Si la prop `statuses` change (poll 20s), on re-sync (cf useEffect ci-dessous).
  const [order, setOrder] = useState<DriverStatus[]>(statuses)
  useEffect(() => { setOrder(statuses) }, [statuses])

  const canDrag = ['admin', 'superadmin', 'dispatcher'].includes(userRole)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),  // <6px = clic, >=6px = drag
  )

  if (order.length === 0) return null

  const toggleSchedule = async (driverId: string, field: 'schedule_day' | 'schedule_night', current: boolean) => {
    // Olivier 2026-06-03 (audit W3) : check res.ok + alert KO. Avant
    // onRefresh() etait appele meme si la PATCH avait foire -> user croyait
    // la garde togglee alors qu en BDD c etait inchange.
    try {
      const res = await fetch('/api/garde', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: driverId, [field]: !current }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(`Echec toggle garde : ${data?.error || `HTTP ${res.status}`}`)
        return
      }
      onRefresh()
    } catch (e: any) {
      console.error('[DispatchClient] toggleSchedule reseau:', e?.message)
      alert(`Erreur reseau : ${e?.message || 'connexion impossible'}`)
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = order.findIndex(d => d.id === active.id)
    const newIndex = order.findIndex(d => d.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(order, oldIndex, newIndex)
    setOrder(reordered)
    try {
      await fetch('/api/admin/driver-priority', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ order: reordered.map(d => d.id) }),
      })
      onRefresh()
    } catch {
      // En cas d'echec, on laisse l'etat local en place — le prochain poll
      // resynchronisera avec la DB.
    }
  }

  return (
    <>
      <div className="px-3 lg:px-8 py-2 lg:py-3 bg-surface border-b border">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order.map(d => d.id)} strategy={horizontalListSortingStrategy}>
            <div className="flex flex-wrap items-center gap-2">
              {order.map(d => (
                <SortableDriverBadge
                  key={d.id}
                  d={d}
                  canDrag={canDrag}
                  onClick={() => setEditing(d)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* Modal d'édition rapide de la garde */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setEditing(null)}>
          <div className="bg-surface border border rounded-2xl max-w-sm w-full p-5"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-bold text-base mb-1">{editing.name}</h3>
            <p className="text-ink-muted text-xs mb-4">Activer/désactiver la garde — le statut sera forcé pendant les heures.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button"
                onClick={() => { toggleSchedule(editing.id, 'schedule_day', !!editing.schedule_day); setEditing(null) }}
                className={`px-4 py-3 rounded-xl border text-left transition ${
                  editing.schedule_day
                    ? 'bg-green-500/10 border-green-500/40'
                    : 'bg-surface border hover:border-zinc-600'
                }`}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-ink text-sm font-semibold">☀️ Jour</span>
                  <span className={`w-2 h-2 rounded-full ${editing.schedule_day ? 'bg-green-400' : 'bg-ink-faint'}`} />
                </div>
                <p className="text-ink-muted text-xs">{dayLabel}</p>
              </button>
              <button type="button"
                onClick={() => { toggleSchedule(editing.id, 'schedule_night', !!editing.schedule_night); setEditing(null) }}
                className={`px-4 py-3 rounded-xl border text-left transition ${
                  editing.schedule_night
                    ? 'bg-indigo-500/10 border-indigo-500/40'
                    : 'bg-surface border hover:border-zinc-600'
                }`}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-ink text-sm font-semibold">🌙 Nuit</span>
                  <span className={`w-2 h-2 rounded-full ${editing.schedule_night ? 'bg-indigo-400' : 'bg-ink-faint'}`} />
                </div>
                <p className="text-ink-muted text-xs">{nightLabel}</p>
              </button>
            </div>
            <button type="button" onClick={() => setEditing(null)}
              className="w-full mt-4 py-2.5 text-ink-muted hover:text-ink text-xs transition">Fermer</button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Assign Dropdown inline ────────────────────────────────────────────────────

function AssignDropdown({ mission, drivers, driverStatuses, onAssigned }: {
  mission:        Mission
  drivers:        Driver[]
  driverStatuses: DriverStatus[]
  onAssigned:     () => void
}) {
  const [loading, setLoading] = useState(false)
  const statusMap = new Map(driverStatuses.map(d => [d.id, d]))

  const assign = async (driverId: string) => {
    setLoading(true)
    try {
      // Olivier 2026-06-03 (audit W3) : check res.ok + try/catch + alert si KO.
      // Avant : si l API retournait 500, onAssigned() ne se faisait pas mais
      // l user n etait jamais averti.
      const res = await fetch('/api/missions/assign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: mission.id, driver_id: driverId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(`Echec assignation : ${data?.error || `HTTP ${res.status}`}`)
        return
      }
      onAssigned()
    } catch (e: any) {
      console.error('[DispatchClient] assign reseau:', e?.message)
      alert(`Erreur reseau : ${e?.message || 'connexion impossible'}`)
    } finally { setLoading(false) }
  }

  return (
    <select
      defaultValue=""
      disabled={loading}
      onChange={e => e.target.value && assign(e.target.value)}
      onClick={e => e.stopPropagation()}
      className="bg-surface border border rounded-lg px-2 py-1.5 text-ink-secondary text-xs focus:outline-none focus:border-brand cursor-pointer disabled:opacity-50"
    >
      <option value="" disabled>
        {loading ? 'Assignation…' : (mission.assigned_user ? mission.assigned_user.name : '— Assigner —')}
      </option>
      {drivers.map(d => {
        const ds = statusMap.get(d.id)
        return (
          <option key={d.id} value={d.id}>
            {d.name}{ds?.status === 'en_mission' ? ' 🟠' : ds?.status === 'hors_service' ? ' ⚫' : ' 🟢'}
          </option>
        )
      })}
    </select>
  )
}

// ── Action d'assignation contextuelle (selon état) ────────────────────────────
// Mission "dispatching" → bouton ⚡ Assigner qui ouvre le modal ETA temps réel.
// Autres états (assigned/in_progress/...) → dropdown classique pour réassigner.
// "new" / "completed" → rien (action contextuelle).
function AssignAction({ mission, drivers, driverStatuses, onRefresh, onModalChange, userRole, userModules }: {
  mission:        Mission
  drivers:        Driver[]
  driverStatuses: DriverStatus[]
  onRefresh:      () => void
  onModalChange?: (open: boolean) => void
  userRole:       string
  userModules:    string[]
}) {
  const [showModal, setShowModal] = useState(false)
  const isAwaitingDispatch = mission.status === 'dispatching'

  const openModal  = () => { setShowModal(true);  onModalChange?.(true) }
  const closeModal = () => { setShowModal(false); onModalChange?.(false) }

  const [assignLoading, setAssignLoading] = useState(false)
  const assign = async (driverId: string) => {
    if (assignLoading) return  // anti double-clic
    setAssignLoading(true)
    try {
      // Olivier 2026-06-03 (audit W3) : check res.ok + alert KO + loading
      // anti double-clic. Avant : double-clic possible + state UI desync si
      // l API foirait silencieusement.
      const res = await fetch('/api/missions/assign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: mission.id, driver_id: driverId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(`Echec assignation : ${data?.error || `HTTP ${res.status}`}`)
        return
      }
      closeModal()
      onRefresh()
    } catch (e: any) {
      console.error('[DispatchClient] assign reseau:', e?.message)
      alert(`Erreur reseau : ${e?.message || 'connexion impossible'}`)
    } finally {
      setAssignLoading(false)
    }
  }

  if (mission.status === 'completed') {
    return <span className="text-green-400 text-xs font-medium">{mission.assigned_user?.name || '—'}</span>
  }
  if (mission.status === 'new') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-ink-faint text-xs">À confirmer</span>
        <AutoDispatchButton
          missionId={mission.id}
          missionType={mission.mission_type}
          userRole={userRole}
          userModules={userModules}
          onTriggered={onRefresh}
        />
      </div>
    )
  }
  if (isAwaitingDispatch) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={openModal}
          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition">
          ⚡ Assigner
        </button>
        <AutoDispatchButton
          missionId={mission.id}
          missionType={mission.mission_type}
          userRole={userRole}
          userModules={userModules}
          isActive={!!mission.auto_dispatch_attempt_status}
          onTriggered={onRefresh}
        />
        {showModal && (
          <DriverPickerModal
            missionId={mission.id}
            onPick={assign}
            onClose={closeModal}
          />
        )}
      </div>
    )
  }
  return <AssignDropdown mission={mission} drivers={drivers} driverStatuses={driverStatuses} onAssigned={onRefresh} />
}

// ── Vue CARTE — MissionCard ───────────────────────────────────────────────────

// Tampon style "DOSSIER CLASSE" affiche en diagonale sur les cards Terminees.
// Distingue visuellement le sous-statut facturation : to_invoice (a faire),
// auto (auto-facturee), ou facturee avec numero.
// Note : l'ancien InvoiceStamp local a ete remplace par le composant partage
// <MissionStamp> de src/components/missions/MissionStamp.tsx qui gere en plus
// les cas "sans frais", "annulee" et "archivee" (utilise aussi dans
// /missions-terminees pour coherence visuelle).

function MissionCard({ mission, drivers, driverStatuses, sources, onRefresh, onModalChange, userRole, userModules }: {
  mission:        Mission
  drivers:        Driver[]
  driverStatuses: DriverStatus[]
  sources:        CatalogSource[]
  onRefresh:      () => void
  onModalChange?: (open: boolean) => void
  userRole:       string
  userModules:    string[]
}) {
  const router  = useRouter()
  const delai   = getDelai(mission.intervention_date, mission.status)
  const srcInfo = { label: getSourceLabel(mission.source, sources), color: getSourceColor(mission.source, sources) }
  const showDelai = delai.urgency !== 'muted'

  return (
    <div
      onClick={() => router.push(`/dispatch/${mission.id}`)}
      className={`relative bg-surface border-2 rounded-2xl p-4 cursor-pointer hover:bg-surface-2 transition-all overflow-hidden min-w-0 ${URGENCY_BORDER[delai.urgency]}`}
    >
      <MissionStamp mission={mission} />
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${srcInfo.color}`}>{srcInfo.label}</span>
          {mission.mission_type && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-surface-hover text-ink-secondary">
              {getTypeLabel(mission)}
            </span>
          )}
        </div>
        {showDelai && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${delai.bgColor} ${delai.color} ${delai.pulse ? 'animate-pulse' : ''}`}>
            {delai.label}
          </span>
        )}
      </div>

      {/* Client : fallback assisté si pas de client (cas VAB pre-acceptation) */}
      <p className="text-ink font-semibold text-sm mb-1 leading-tight">
        {mission.client_name ? (
          mission.client_name
        ) : mission.assisted_name ? (
          <>
            {mission.assisted_name}
            <span className="text-ink-muted text-xs font-normal ml-1.5">(sur place)</span>
          </>
        ) : (
          <span className="text-ink-muted">Client inconnu</span>
        )}
      </p>
      {(mission.client_phone || mission.assisted_phone) && (
        <a href={`tel:${mission.client_phone || mission.assisted_phone}`} onClick={e => e.stopPropagation()}
          className="text-brand text-xs hover:underline block mb-2">
          📞 {mission.client_phone || mission.assisted_phone}
        </a>
      )}

      {/* Véhicule */}
      {(mission.vehicle_plate || mission.vehicle_brand) && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-ink-muted text-xs">🚘</span>
          {mission.vehicle_plate && <span className="text-ink font-bold font-mono text-xs">{mission.vehicle_plate}</span>}
          {(mission.vehicle_brand || mission.vehicle_model) && (
            <span className="text-ink-secondary text-xs">{[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')}</span>
          )}
        </div>
      )}

      {/* Lieu */}
      {(mission.incident_address || mission.incident_city) && (
        <p className="text-ink-secondary text-xs mb-1 truncate">
          📍 {mission.incident_address}{mission.incident_city ? `, ${mission.incident_city}` : ''}
        </p>
      )}

      {/* Destination */}
      {(mission.destination_address || mission.destination_name) && (
        <p className="text-ink-muted text-xs mb-2 truncate">
          🏁 {mission.destination_name || mission.destination_address}
        </p>
      )}

      {/* Warnings */}
      {mission.warnings && mission.warnings.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {mission.warnings.map((w, i) => (
            <span key={i} className="px-2 py-0.5 bg-orange-500/20 border border-orange-500/30 rounded text-orange-300 text-xs">
              ⚠️ {w}
            </span>
          ))}
        </div>
      )}

      {/* Auto-dispatch en cours */}
      {mission.auto_dispatch_status && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-brand/10 border border-brand/30 rounded-lg">
          <span className="text-brand text-xs animate-pulse">⚡</span>
          <span className="text-brand text-xs font-medium truncate">{mission.auto_dispatch_status}</span>
        </div>
      )}

      {/* Dérogation paiement demandée */}
      {mission.has_pending_derogation && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-amber-600/15 border border-amber-600/40 rounded-lg">
          <span className="text-amber-400 text-xs animate-pulse">🆘</span>
          <span className="text-amber-400 text-xs font-medium truncate">Dérogation paiement à valider</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border">
        <div onClick={e => e.stopPropagation()} className="flex items-center gap-2 flex-1 min-w-0">
          <AssignAction mission={mission} drivers={drivers} driverStatuses={driverStatuses} onRefresh={onRefresh} onModalChange={onModalChange} userRole={userRole} userModules={userModules} />
          {mission.assigned_user && mission.status !== 'completed' && (
            <span className="text-green-400 text-xs font-medium">✓ {mission.assigned_user.name}</span>
          )}
        </div>
        <Link href={`/dispatch/${mission.id}`} onClick={e => e.stopPropagation()}
          className="px-3 py-1.5 bg-brand hover:bg-brand-dark text-ink rounded-lg text-xs font-medium transition flex-shrink-0">
          VOIR →
        </Link>
      </div>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function DispatchClient({
  drivers,
  sources,
  userName,
  userRole,
  userEmail,
  userId,
  userModules = [],
}: {
  drivers:      Driver[]
  sources:      CatalogSource[]
  userName:     string
  userRole:     string
  userEmail?:   string
  userId?:      string
  userModules?: string[]
}) {
  const router = useRouter()

  const [activeTab,      setActiveTab]      = useState('new')
  const [sourceFilter,   setSourceFilter]   = useState('')
  const [missions,       setMissions]       = useState<Mission[]>([])
  const [mapMissions,    setMapMissions]    = useState<Mission[]>([])
  // Tick toutes les 60s — force le re-render des cards pour que les delais
  // (vert/jaune/orange/rouge selon l'âge depuis received_at) soient à jour
  // sans attendre un poll/realtime data refresh.
  const [, setNowTick]  = useState(0)
  // Compte les modals ouvertes — quand > 0, on suspend les refreshs auto pour
  // éviter le clignotement du contenu pendant qu'un modal est en interaction.
  const [modalOpenCount, setModalOpenCount] = useState(0)
  const onModalChange = useCallback((open: boolean) => {
    setModalOpenCount(c => Math.max(0, c + (open ? 1 : -1)))
  }, [])
  const [counters,       setCounters]       = useState<Counters>({ new: 0, dispatching: 0, assigned: 0, in_progress: 0, parked: 0, completed: 0, errors: 0 })
  const [loading,        setLoading]        = useState(true)
  // Indicateur subtil "mise a jour temps reel" affiche pendant les
  // refresh silencieux (realtime + polling). Olivier 2026-05-28.
  const [liveSyncing,    setLiveSyncing]    = useState(false)
  const [search,         setSearch]         = useState('')
  const [dispatchMode,   setDispatchMode]   = useState<'manual'|'auto'>('manual')

  // Missions en erreur de parsing (auto-réparées par cron, mais on offre une
  // relance manuelle + visibilité au dispatch). Olivier 2026-06-16.
  const [errorCount, setErrorCount] = useState(0)
  const [reparsing,  setReparsing]  = useState(false)
  const loadErrorCount = useCallback(() => {
    fetch('/api/missions/reprocess').then(r => r.json()).then(d => setErrorCount(d.count || 0)).catch(() => {})
  }, [])
  useEffect(() => {
    loadErrorCount()
    const t = setInterval(loadErrorCount, 60000)
    return () => clearInterval(t)
  }, [loadErrorCount])
  async function relaunchParsing() {
    setReparsing(true)
    try {
      for (let i = 0; i < 15; i++) {
        const res = await fetch('/api/missions/reprocess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        const txt = await res.text()
        let j: any = {}; try { j = JSON.parse(txt) } catch { break }
        if (!res.ok || !j.more) break
      }
    } catch { /* ignore */ }
    finally { setReparsing(false); loadErrorCount(); load() }
  }
  const [modeLoading,    setModeLoading]    = useState(false)
  const [viewMode,       setViewMode]       = useState<ViewMode>('list')
  const [driverStatuses, setDriverStatuses] = useState<DriverStatus[]>([])
  const [sortMode,       setSortMode]       = useState<SortMode>('intervention_date')

  // Charge la préférence de vue + tri sauvegardées
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vd_dispatch_view') as ViewMode | null
      if (saved === 'list' || saved === 'card' || saved === 'map') setViewMode(saved)
      const sortSaved = localStorage.getItem('dispatch-sort-mode')
      if (sortSaved === 'received_at') setSortMode('received_at')
    } catch { /* SSR / private browsing */ }
  }, [])

  const switchView = (v: ViewMode) => {
    setViewMode(v)
    try { localStorage.setItem('vd_dispatch_view', v) } catch { /* ignore */ }
  }

  const handleSortChange = (mode: SortMode) => {
    setSortMode(mode)
    try { localStorage.setItem('dispatch-sort-mode', mode) } catch { /* ignore */ }
  }

  // ── Chargement missions + statuts chauffeurs ──────────────────────────────

  // Olivier 2026-05-28 : load() accepte un flag `silent` pour distinguer le
  // chargement initial (skeleton visible) du rafraichissement de fond
  // (realtime + polling : pas de flash, juste un indicateur "live" subtil).
  // Cela permet la propagation temps reel sur tous les ecrans connectes sans
  // le re-render perceptible (skeleton -> contenu) qui flashait l interface.
  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    const silent = opts.silent === true
    if (silent) setLiveSyncing(true)
    else setLoading(true)
    try {
      const params = new URLSearchParams({ status: activeTab, sort: sortMode })
      if (sourceFilter) params.set('source', sourceFilter)
      if (search)       params.set('q', search)

      const requests: Promise<Response>[] = [
        fetch(`/api/missions/list?${params}`),
        fetch('/api/users/driver-status'),
      ]
      if (viewMode === 'map') {
        const mapParams = new URLSearchParams({ view: 'map', sort: sortMode })
        if (sourceFilter) mapParams.set('source', sourceFilter)
        requests.push(fetch(`/api/missions/list?${mapParams}`))
      }

      const responses = await Promise.all(requests)
      const mData = await responses[0].json()
      const sData = await responses[1].json()
      setMissions(mData.missions  || [])
      setCounters(mData.counters  || { new: 0, dispatching: 0, assigned: 0, in_progress: 0, parked: 0, completed: 0, errors: 0 })
      setDriverStatuses(sData.drivers || [])
      if (responses[2]) {
        const mapData = await responses[2].json()
        setMapMissions(mapData.missions || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      if (silent) setLiveSyncing(false)
      else setLoading(false)
    }
  }, [activeTab, sourceFilter, search, viewMode, sortMode])

  useEffect(() => { load() }, [load])

  // ── Realtime : nouvelle mission ou changement de statut ──────────────────
  // Chaque INSERT/UPDATE/DELETE sur incoming_missions trigger un reload
  // SILENCIEUX (pas de skeleton, pas de flash). Cela propage l action d un
  // dispatcher sur tous les ecrans connectes en quelques centaines de ms.
  // Suspendu si une modal est ouverte (evite reload pendant une edition).
  useEffect(() => {
    const channel = sb.channel('dispatch-missions')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'incoming_missions' },
        () => { if (modalOpenCount === 0) load({ silent: true }) }
      )
      .subscribe()
    return () => { sb.removeChannel(channel) }
  }, [load, modalOpenCount])

  // ── Polling 20s : statuts chauffeurs (positions GPS, gardes) ─────────────
  // Filet de securite si un event realtime est rate. Silencieux egalement.
  useEffect(() => {
    const id = setInterval(() => { if (modalOpenCount === 0) load({ silent: true }) }, 20_000)
    return () => clearInterval(id)
  }, [load, modalOpenCount])

  // ── Tick 60s : recalcule les delais des cards (couleur urgence + label) ──
  // Sans ça, une mission passe de vert à jaune seulement quand le polling
  // refresh — pas idéal car le label "5min" reste affiché jusqu'au prochain poll.
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // Charge le dispatch mode
  useEffect(() => {
    fetch('/api/missions/dispatch-mode')
      .then(r => r.json())
      .then(d => { if (d.mode) setDispatchMode(d.mode) })
      .catch(() => {})
  }, [])

  const toggleMode = async () => {
    const newMode = dispatchMode === 'manual' ? 'auto' : 'manual'
    setModeLoading(true)
    try {
      // Olivier 2026-06-03 (audit W3) : check res.ok. Avant setDispatchMode
      // s executait MEME SI le POST avait foire -> state UI desync avec BDD,
      // user croyait avoir bascule en Auto alors qu on etait toujours Manuel.
      const res = await fetch('/api/missions/dispatch-mode', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(`Echec bascule mode dispatch : ${data?.error || `HTTP ${res.status}`}`)
        return
      }
      setDispatchMode(newMode)
    } catch (e: any) {
      console.error('[DispatchClient] toggleMode reseau:', e?.message)
      alert(`Erreur reseau : ${e?.message || 'connexion impossible'}`)
    } finally { setModeLoading(false) }
  }

  // ── Filtrage client-side ──────────────────────────────────────────────────

  // Olivier 2026-06-03 : recherche elargie marque/modele + plaque normalisee.
  // Plaque comparee SANS tirets/espaces dans les 2 sens pour matcher "1ABC123"
  // qu on tape "1-ABC-123" ou inversement.
  const normPlate = (s: string) => s.replace(/[-.\s]/g, '').toLowerCase()
  const filtered = missions.filter(m => {
    if (!search) return true
    const q     = search.toLowerCase()
    const qPlate = normPlate(search)
    const plate  = m.vehicle_plate ? normPlate(m.vehicle_plate) : ''
    return (
      m.client_name?.toLowerCase().includes(q)        ||
      m.external_id?.toLowerCase().includes(q)        ||
      m.mission_number?.toString().includes(q)        ||
      m.vehicle_brand?.toLowerCase().includes(q)      ||
      m.vehicle_model?.toLowerCase().includes(q)      ||
      m.incident_address?.toLowerCase().includes(q)   ||
      (plate && plate.includes(qPlate))
    )
  })

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell
      title="Dispatch"
      userName={userName}
      userEmail={userEmail}
      userId={userId}
      userRole={userRole}
      userModules={userModules}
    >
      {/* ── Barre de contrôle ──────────────────────────────────────────────
          backdrop-blur pour fondre avec l'ambient background.
          Burger mobile et h1 "Dispatch" gérés par AppShell. */}
      <div className="bg-surface/85 backdrop-blur-md border-b px-3 lg:px-6 py-3 lg:py-4 sticky top-0 z-20">
        <div className="flex items-center gap-2 lg:gap-3 flex-wrap">

            <input
              type="text"
              placeholder="Recherche…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-[120px] lg:min-w-[180px] max-w-xs bg-surface border border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint"
            />
            {/* Note : le badge "Derogation a valider" global vit dans AppShell
                (composant DispatchAlertBadge) → visible depuis n importe quelle
                page, pas seulement /dispatch. */}

            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="hidden sm:block bg-surface border border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
            >
              <option value="">Toutes sources</option>
              {sources.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>

            <button onClick={() => load()}
              className="hidden sm:block p-2 bg-surface border border rounded-xl text-ink-secondary hover:text-ink transition"
              title="Actualiser">
              ↻
            </button>

            {/* Toggle vue liste / cartes / carte géographique — masqué sur mobile (cartes forcées) */}
            <div className="hidden lg:flex items-center bg-surface border border rounded-xl overflow-hidden">
              <button
                onClick={() => switchView('list')}
                className={`px-3 py-2 text-sm font-medium transition ${
                  viewMode === 'list' ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'
                }`}>
                ≡ Liste
              </button>
              <button
                onClick={() => switchView('card')}
                className={`px-3 py-2 text-sm font-medium transition ${
                  viewMode === 'card' ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'
                }`}>
                ⊞ Cartes
              </button>
              <button
                onClick={() => switchView('map')}
                className={`px-3 py-2 text-sm font-medium transition ${
                  viewMode === 'map' ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'
                }`}>
                🗺️ Carte
              </button>
            </div>

            {/* Dispatcher de garde — badge cliquable pour cibler les escalades auto-dispatch */}
            <DispatcherOnDutyBadge userRole={userRole} />

            {/* Indicateur live : pulse subtil quand un event realtime / polling
                refresh les missions en arriere-plan. Donne un feedback visuel
                que l ecran est en sync avec les autres dispatchers. */}
            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] uppercase tracking-wider transition-opacity ${
                liveSyncing
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700 opacity-100'
                  : 'bg-surface border text-ink-faint opacity-70'
              }`}
              title={liveSyncing ? 'Mise à jour en cours…' : 'Synchronisation temps réel active'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${liveSyncing ? 'bg-emerald-500 animate-pulse' : 'bg-emerald-400'}`}></span>
              <span className="hidden sm:inline">{liveSyncing ? 'Sync…' : 'Live'}</span>
            </div>

            {/* Import VAB — bouton dedie (orange ambre pour signal action externe) */}
            <VabImportButton onImportDone={() => load()} />

            {/* Nouvelle mission — icône seule sur mobile, label sur desktop */}
            <Link href="/dispatch/new"
              title="Nouvelle mission"
              className="flex items-center justify-center gap-2 w-10 h-10 lg:w-auto lg:h-auto lg:px-4 lg:py-2 bg-brand hover:bg-brand-dark text-ink rounded-xl text-sm font-medium transition flex-shrink-0">
              <span className="text-lg lg:hidden">+</span>
              <span className="hidden lg:inline">+ Nouvelle mission</span>
            </Link>

            {/* Switch Manuel / Auto — masqué sur mobile */}
            <div className="hidden md:flex items-center gap-2 bg-surface border border rounded-xl px-3 py-2"
              title={dispatchMode === 'auto'
                ? 'Mode Auto activé : le système réceptionne et assigne les missions automatiquement (utile la nuit, selon les chauffeurs en garde).'
                : 'Mode Manuel : toutes les nouvelles missions doivent être confirmées et assignées manuellement par un dispatcher.'}>
              <span className="text-ink-muted text-xs">Dispatch</span>
              <button
                onClick={toggleMode}
                disabled={modeLoading}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                  dispatchMode === 'auto' ? 'bg-brand' : 'bg-surface-hover'
                }`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  dispatchMode === 'auto' ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
              <span className={`text-xs font-medium ${dispatchMode === 'auto' ? 'text-brand' : 'text-ink-secondary'}`}>
                {dispatchMode === 'auto' ? 'Auto' : 'Manuel'}
              </span>
              <span className="text-ink-faint text-xs cursor-help">ⓘ</span>
            </div>
          </div>
          {dispatchMode === 'auto' && (
            <div className="mt-3 px-4 py-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-center gap-2">
              ⚙️ <span><strong>Mode Auto activé</strong> — le système gère réception et assignation. Supervision uniquement.</span>
            </div>
          )}

          {/* Toggle de tri — segmented control discret (paramètre d'affichage,
              à différencier visuellement des KPI tabs statut qui sont des filtres) */}
          <div className="mt-4">
            <div className="bg-surface-2 border rounded-lg p-1 inline-flex gap-1">
              <button
                type="button"
                onClick={() => handleSortChange('intervention_date')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  sortMode === 'intervention_date'
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-hover'
                }`}
              >
                Date intervention
              </button>
              <button
                type="button"
                onClick={() => handleSortChange('received_at')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  sortMode === 'received_at'
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-hover'
                }`}
              >
                Date réception
              </button>
            </div>
          </div>

          {/* Onglets — version mobile (select) + desktop (tabs flex).
              Sur mobile, on remplace les tabs scrollables par un select clair
              qui affiche tous les statuts + leurs compteurs d'un coup. */}
          <div className="mt-3 md:hidden">
            <select
              value={activeTab}
              onChange={e => setActiveTab(e.target.value)}
              className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-sm font-medium focus:outline-none focus:border-brand"
            >
              {TABS.map(tab => {
                const count = tab.countKey ? counters[tab.countKey] : null
                return (
                  <option key={tab.key} value={tab.key}>
                    {tab.label}{count !== null && count > 0 ? ` (${count})` : ''}
                  </option>
                )
              })}
            </select>
          </div>
          <div className="hidden md:flex gap-1 mt-3 overflow-x-auto">
            {TABS.map(tab => {
              const count  = tab.countKey ? counters[tab.countKey] : null
              const active = activeTab === tab.key
              const isUrgent = tab.key === 'new' && count !== null && count > 0
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                    active
                      ? (isUrgent ? 'bg-red-600 text-white shadow-lg shadow-red-600/30' : 'bg-brand text-white')
                      : isUrgent
                        ? 'bg-red-600/15 text-red-300 hover:bg-red-600/25 border border-red-600/40'
                        : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
                  }`}>
                  {isUrgent && !active && <span className="animate-pulse">●</span>}
                  {tab.label}
                  {count !== null && count > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                      active
                        ? 'bg-white/20 text-white'
                        : isUrgent
                          ? 'bg-red-500 text-white'
                          : 'bg-surface-hover text-ink-secondary'
                    }`}>{count}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Bandeau discret : mission(s) récente(s) à vérifier ────────── */}
        {errorCount > 0 && (
          <div className="px-3 lg:px-8 pt-3">
            <div className="flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
              <p className="text-amber-900 text-sm">
                {errorCount === 1
                  ? 'Une mission n’a pas pu être traitée automatiquement.'
                  : `${errorCount} missions n’ont pas pu être traitées automatiquement.`}
                <span className="text-amber-700"> Vérification automatique en cours.</span>
              </p>
              <button
                onClick={relaunchParsing}
                disabled={reparsing}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50 whitespace-nowrap">
                {reparsing ? '⏳ Vérification…' : 'Vérifier maintenant'}
              </button>
            </div>
          </div>
        )}

        {/* ── Panel statut chauffeurs ──────────────────────────────────── */}
        <DriverStatusPanel statuses={driverStatuses} onRefresh={load} userRole={userRole} />

        {/* ── Contenu wrappe d'un ambient background ────────────────── */}
        <AmbientBackground>
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-3 lg:px-6 py-4 lg:py-6 ambient-fade-up">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-ink-muted">Chargement…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-ink-muted">
              <p className="text-4xl mb-4">📋</p>
              <p>Aucune mission dans cette catégorie</p>
            </div>
          ) : viewMode === 'map' ? (

            /* ── VUE CARTE GÉOGRAPHIQUE ─────────────────────────── */
            <div className="h-[calc(100vh-360px)] lg:h-[calc(100vh-280px)] min-h-[400px] lg:min-h-[500px] rounded-2xl overflow-hidden border border relative">
              <DispatchMap
                missions={mapMissions as unknown as MapMission[]}
                drivers={driverStatuses as unknown as MapDriver[]}
                gmKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
                onMissionClick={(m) => router.push(`/dispatch/${m.id}`)}
                onDriverClick={() => { /* hook futur */ }}
              />
              {/* Compteur missions affichées vs sans coords */}
              {(() => {
                const total    = mapMissions.length
                const withCoords = mapMissions.filter(m => m.incident_lat != null && m.incident_lng != null).length
                const withoutCoords = total - withCoords
                return (
                  <div className="absolute top-4 right-4 bg-surface/95 backdrop-blur border border rounded-xl px-3 py-2 text-xs">
                    <p className="text-ink font-semibold">{withCoords} pin{withCoords > 1 ? 's' : ''} · {total} mission{total > 1 ? 's' : ''} active{total > 1 ? 's' : ''}</p>
                    {withoutCoords > 0 && (
                      <p className="text-amber-400 mt-0.5">⚠ {withoutCoords} sans coords GPS (ouvre la fiche pour valider l'adresse)</p>
                    )}
                  </div>
                )
              })()}
            </div>

          ) : viewMode === 'card' ? (

            /* ── VUE CARTES ─────────────────────────────────────── */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {filtered.map(m => (
                <MissionCard
                  key={m.id}
                  mission={m}
                  drivers={drivers}
                  driverStatuses={driverStatuses}
                  sources={sources}
                  onRefresh={load}
                  onModalChange={onModalChange}
                  userRole={userRole}
                  userModules={userModules}
                />
              ))}
            </div>

          ) : (

            /* ── VUE LISTE ──────────────────────────────────────── */
            <>
              {/* Mobile : cards (la table ne tient pas) */}
              <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filtered.map(m => (
                  <MissionCard
                    key={m.id}
                    mission={m}
                    drivers={drivers}
                    driverStatuses={driverStatuses}
                    sources={sources}
                    onRefresh={load}
                    onModalChange={onModalChange}
                    userRole={userRole}
                    userModules={userModules}
                  />
                ))}
              </div>

              {/* Desktop : table */}
              <div className="hidden lg:block bg-surface border border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border text-ink-secondary text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-medium">Source</th>
                    <th className="px-4 py-3 text-left font-medium">Dossier</th>
                    <th className="px-4 py-3 text-left font-medium">Client</th>
                    <th className="px-4 py-3 text-left font-medium">Délai</th>
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Véhicule</th>
                    <th className="px-4 py-3 text-left font-medium">Lieu incident</th>
                    <th className="px-4 py-3 text-left font-medium">Destination</th>
                    <th className="px-4 py-3 text-left font-medium">Chauffeur</th>
                    <th className="px-4 py-3 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222]">
                  {filtered.map(m => {
                    const delai   = getDelai(m.intervention_date, m.status)
                    const srcInfo = { label: getSourceLabel(m.source, sources), color: getSourceColor(m.source, sources) }
                    const showDelai = delai.urgency !== 'muted'
                    return (
                      <tr key={m.id}
                        className={`transition hover:bg-surface-2 cursor-pointer ${
                          delai.urgency === 'critical' ? 'bg-red-500/5' : ''
                        }`}
                        onClick={() => router.push(`/dispatch/${m.id}`)}>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${srcInfo.color}`}>
                            {srcInfo.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-ink font-mono text-xs">{m.mission_number != null ? `#${m.mission_number}` : (m.dossier_number || m.external_id)}</p>
                          {(m.dossier_number || (m.mission_number != null && m.external_id)) && (
                            <p className="text-ink-muted text-xs">{m.dossier_number || m.external_id}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-ink">{m.client_name || '—'}</p>
                          {m.client_phone && (
                            <a href={`tel:${m.client_phone}`} onClick={e => e.stopPropagation()}
                              className="text-ink-secondary text-xs hover:text-brand">{m.client_phone}</a>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {showDelai ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${delai.bgColor} ${delai.color} ${delai.pulse ? 'animate-pulse' : ''}`}>
                              {delai.label}
                            </span>
                          ) : (
                            <span className="text-ink-faint text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-secondary text-xs">
                          {getTypeLabel(m)}
                        </td>
                        <td className="px-4 py-3">
                          {m.vehicle_plate && <p className="text-ink font-bold font-mono text-xs">{m.vehicle_plate}</p>}
                          <p className="text-ink-secondary text-xs">
                            {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-ink text-xs">{m.incident_address || '—'}</p>
                          {m.incident_city && <p className="text-ink-muted text-xs">{m.incident_city}</p>}
                        </td>
                        <td className="px-4 py-3 text-ink-secondary text-xs">
                          {m.destination_name || m.destination_address || '—'}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <AssignAction mission={m} drivers={drivers} driverStatuses={driverStatuses} onRefresh={load} onModalChange={onModalChange} userRole={userRole} userModules={userModules} />
                          {m.auto_dispatch_status && (
                            <p className="mt-1.5 text-brand text-[11px] flex items-center gap-1">
                              <span className="animate-pulse">⚡</span>
                              {m.auto_dispatch_status}
                            </p>
                          )}
                          {m.has_pending_derogation && (
                            <p className="mt-1.5 text-amber-400 text-[11px] flex items-center gap-1">
                              <span className="animate-pulse">🆘</span>
                              Dérogation à valider
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <Link href={`/dispatch/${m.id}`}
                            className="px-3 py-1.5 bg-brand hover:bg-brand-dark text-ink rounded-lg text-xs font-medium transition inline-block">
                            VOIR
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
        </main>
        </AmbientBackground>
    </AppShell>
  )
}
