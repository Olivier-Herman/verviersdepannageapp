// src/app/api/stats/dashboard/route.ts
//
// Endpoint stats dashboard. Agregations en live sur incoming_missions +
// mission_logs + dispatch_attempts_log. Retourne KPI volume + efficacite
// + breakdowns (byType / bySource / byDriver / heatmap / geographicTop)
// + comparaison periode-sur-periode.
//
// Filters (query string) :
//   period     : 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'  (default 'month')
//   dateFrom   : ISO date  (utilise si period='custom')
//   dateTo     : ISO date  (utilise si period='custom')
//   source     : filtrer sur une source (vab, touring, ima, ...)
//   chauffeur  : filtrer sur un user_id
//   type       : filtrer sur un mission_type
//
// Permission : module 'stats' granté sur l user.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Statuts consideres comme "missions reellement traitees" pour les stats
// volume (exclu 'new', 'dispatching', 'parse_error', 'ignored').
const ELIGIBLE_STATUSES = [
  'assigned', 'accepted', 'in_progress', 'delivering',
  'parked', 'completed', 'to_invoice',
]

interface Period {
  from: string
  to:   string
  previousFrom: string
  previousTo:   string
  label: string
}

function startOf(date: Date, unit: 'day' | 'week' | 'month' | 'quarter' | 'year'): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  if (unit === 'day') return d
  if (unit === 'week') {
    const day = d.getDay() // 0=sunday
    const diff = day === 0 ? -6 : 1 - day  // lundi=debut de semaine
    d.setDate(d.getDate() + diff)
    return d
  }
  if (unit === 'month') { d.setDate(1); return d }
  if (unit === 'quarter') {
    d.setDate(1)
    d.setMonth(Math.floor(d.getMonth() / 3) * 3)
    return d
  }
  if (unit === 'year') { d.setDate(1); d.setMonth(0); return d }
  return d
}

function computePeriod(period: string, customFrom?: string, customTo?: string): Period {
  const now = new Date()
  let from: Date, to: Date, label: string

  switch (period) {
    case 'today':
      from = startOf(now, 'day')
      to = new Date(from); to.setDate(to.getDate() + 1)
      label = 'Aujourd\'hui'
      break
    case 'week':
      from = startOf(now, 'week')
      to = new Date(from); to.setDate(to.getDate() + 7)
      label = 'Cette semaine'
      break
    case 'quarter':
      from = startOf(now, 'quarter')
      to = new Date(from); to.setMonth(to.getMonth() + 3)
      label = 'Ce trimestre'
      break
    case 'year':
      from = startOf(now, 'year')
      to = new Date(from); to.setFullYear(to.getFullYear() + 1)
      label = 'Cette annee'
      break
    case 'custom':
      from = new Date(customFrom || now)
      to   = new Date(customTo   || now)
      label = `${from.toLocaleDateString('fr-BE')} - ${to.toLocaleDateString('fr-BE')}`
      break
    case 'month':
    default:
      from = startOf(now, 'month')
      to = new Date(from); to.setMonth(to.getMonth() + 1)
      label = 'Ce mois-ci'
      break
  }

  const durationMs = to.getTime() - from.getTime()
  const previousTo   = new Date(from)
  const previousFrom = new Date(from.getTime() - durationMs)

  return {
    from:         from.toISOString(),
    to:           to.toISOString(),
    previousFrom: previousFrom.toISOString(),
    previousTo:   previousTo.toISOString(),
    label,
  }
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 1000) / 10  // 1 decimal
}

function avgMinutes(values: (number | null)[]): number | null {
  const filtered = values.filter((v): v is number => v != null && v > 0)
  if (filtered.length === 0) return null
  const sum = filtered.reduce((a, b) => a + b, 0)
  return Math.round(sum / filtered.length / 60 * 10) / 10  // minutes, 1 dec
}

interface MissionRow {
  id: string
  source: string | null
  mission_type: string | null
  status: string
  assigned_to: string | null
  received_at: string | null
  intervention_date: string | null
  assigned_at: string | null
  accepted_at: string | null
  on_way_at: string | null
  on_site_at: string | null
  completed_at: string | null
  parked_at: string | null
  dpr_motif: string | null
  incident_city: string | null
}

function diffSeconds(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  return Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 1000)
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const period    = searchParams.get('period')    || 'month'
  const dateFrom  = searchParams.get('dateFrom')  || undefined
  const dateTo    = searchParams.get('dateTo')    || undefined
  const source    = searchParams.get('source')    || undefined
  const chauffeur = searchParams.get('chauffeur') || undefined
  const type      = searchParams.get('type')      || undefined

  const p = computePeriod(period, dateFrom, dateTo)
  const sb = createAdminClient()

  // Permission check : user doit avoir module 'stats'
  const { data: actor } = await sb.from('users')
    .select('id, role, roles').eq('email', session.user!.email!).single()
  if (!actor) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  const isAdmin = ['admin', 'superadmin'].includes(actor.role)
  if (!isAdmin) {
    const { data: mods } = await sb.from('user_modules')
      .select('module_id').eq('user_id', actor.id).eq('granted', true)
    const moduleIds = (mods || []).map(m => m.module_id)
    if (!moduleIds.includes('stats')) {
      return NextResponse.json({ error: 'Module stats non autorise' }, { status: 403 })
    }
  }

  // Fetch missions de la periode courante
  let qCurrent = sb.from('incoming_missions')
    .select('id, source, mission_type, status, assigned_to, received_at, intervention_date, assigned_at, accepted_at, on_way_at, on_site_at, completed_at, parked_at, dpr_motif, incident_city')
    .gte('intervention_date', p.from)
    .lt('intervention_date', p.to)
    .in('status', ELIGIBLE_STATUSES)
  if (source)    qCurrent = qCurrent.eq('source', source)
  if (chauffeur) qCurrent = qCurrent.eq('assigned_to', chauffeur)
  if (type)      qCurrent = qCurrent.eq('mission_type', type)
  const { data: currentMissions } = await qCurrent
  const current: MissionRow[] = (currentMissions || []) as any

  // Fetch missions de la periode precedente (pour comparaison)
  let qPrev = sb.from('incoming_missions')
    .select('id, status, mission_type, assigned_to, received_at, assigned_at, accepted_at, completed_at, parked_at, dpr_motif')
    .gte('intervention_date', p.previousFrom)
    .lt('intervention_date', p.previousTo)
    .in('status', ELIGIBLE_STATUSES)
  if (source)    qPrev = qPrev.eq('source', source)
  if (chauffeur) qPrev = qPrev.eq('assigned_to', chauffeur)
  if (type)      qPrev = qPrev.eq('mission_type', type)
  const { data: prevMissionsRaw } = await qPrev
  const previous: MissionRow[] = (prevMissionsRaw || []) as any

  // Recupere les mission_logs action='dispatched' pour calculer le delai
  // dispatcher (received_at -> moment de confirmation par dispatcher).
  const allMissionIds = [...current.map(m => m.id), ...previous.map(m => m.id)]
  const dispatchedAtMap = new Map<string, string>()
  if (allMissionIds.length > 0) {
    const { data: dispatchedLogs } = await sb
      .from('mission_logs')
      .select('mission_id, created_at')
      .eq('action', 'dispatched')
      .in('mission_id', allMissionIds)
      .order('created_at', { ascending: true })
    for (const log of dispatchedLogs || []) {
      // Garde le premier dispatched (le plus ancien) par mission_id
      if (!dispatchedAtMap.has(log.mission_id)) {
        dispatchedAtMap.set(log.mission_id, log.created_at)
      }
    }
  }

  // KPI : totaux + comparaison
  const kpi = {
    totalMissions: {
      current: current.length,
      previous: previous.length,
      delta: pctDelta(current.length, previous.length),
    },
    completedMissions: {
      current: current.filter(m => ['completed', 'to_invoice'].includes(m.status)).length,
      previous: previous.filter(m => ['completed', 'to_invoice'].includes(m.status)).length,
      delta: pctDelta(
        current.filter(m => ['completed', 'to_invoice'].includes(m.status)).length,
        previous.filter(m => ['completed', 'to_invoice'].includes(m.status)).length
      ),
    },
    avgInterventionMinutes: {
      current:  avgMinutes(current.map(m => diffSeconds(m.accepted_at, m.completed_at))),
      previous: avgMinutes(previous.map(m => diffSeconds(m.accepted_at, m.completed_at))),
      delta:    null as number | null,
    },
    avgAcceptanceMinutes: {
      current:  avgMinutes(current.map(m => diffSeconds(m.received_at, m.accepted_at))),
      previous: avgMinutes(previous.map(m => diffSeconds(m.received_at, m.accepted_at))),
      delta:    null as number | null,
    },
    // Delai dispatcher : received_at → moment ou le dispatcher confirme
    // (passage status new -> dispatching via /api/missions/confirm).
    avgDispatchConfirmMinutes: {
      current:  avgMinutes(current.map(m  => diffSeconds(m.received_at, dispatchedAtMap.get(m.id) || null))),
      previous: avgMinutes(previous.map(m => diffSeconds(m.received_at, dispatchedAtMap.get(m.id) || null))),
      delta:    null as number | null,
    },
    // Delai assignation : received_at → moment ou un chauffeur est assigne
    // (assigned_at set dans /api/missions/assign).
    avgAssignmentMinutes: {
      current:  avgMinutes(current.map(m  => diffSeconds(m.received_at, m.assigned_at))),
      previous: avgMinutes(previous.map(m => diffSeconds(m.received_at, m.assigned_at))),
      delta:    null as number | null,
    },
  }
  kpi.avgInterventionMinutes.delta     = pctDelta(kpi.avgInterventionMinutes.current     || 0, kpi.avgInterventionMinutes.previous     || 0)
  kpi.avgAcceptanceMinutes.delta       = pctDelta(kpi.avgAcceptanceMinutes.current       || 0, kpi.avgAcceptanceMinutes.previous       || 0)
  kpi.avgDispatchConfirmMinutes.delta  = pctDelta(kpi.avgDispatchConfirmMinutes.current  || 0, kpi.avgDispatchConfirmMinutes.previous  || 0)
  kpi.avgAssignmentMinutes.delta       = pctDelta(kpi.avgAssignmentMinutes.current       || 0, kpi.avgAssignmentMinutes.previous       || 0)

  // Breakdown par type — normalisation des valeurs DB :
  //   REM / remorquage   → remorquage
  //   DSP / depannage / reparation_place → dsp (= dépannage sur place)
  //   trajet_vide        → trajet_vide
  const normalizeType = (t: string | null): string => (t ?? '').toLowerCase().trim()
  const isRemorquage = (t: string | null) => ['rem', 'remorquage'].includes(normalizeType(t))
  const isTrajetVide = (t: string | null) => normalizeType(t) === 'trajet_vide'
  const isDsp = (t: string | null) => ['dsp', 'depannage', 'reparation_place'].includes(normalizeType(t))

  const byType = {
    remorquage:  current.filter(m => isRemorquage(m.mission_type)).length,
    dsp:         current.filter(m => isDsp(m.mission_type)).length,
    parc:        current.filter(m => m.status === 'parked').length,
    dpr:         current.filter(m => m.dpr_motif != null).length,
    trajet_vide: current.filter(m => isTrajetVide(m.mission_type)).length,
    null_or_unknown: current.filter(m => !isRemorquage(m.mission_type) && !isDsp(m.mission_type) && !isTrajetVide(m.mission_type)).length,
  }

  // Conversions REM <-> DSP : depuis mission_logs
  const missionIds = current.map(m => m.id)
  let conversions = { rem_to_dsp: 0, dsp_to_rem: 0 }
  if (missionIds.length > 0) {
    const { data: logs } = await sb.from('mission_logs')
      .select('mission_id, action, metadata')
      .eq('action', 'change_type')
      .in('mission_id', missionIds)
    for (const log of logs || []) {
      const meta = log.metadata as any
      const newType = (meta?.new_type || meta?.action_payload?.new_type || '').toLowerCase()
      if (['dsp', 'depannage', 'reparation_place'].includes(newType))  conversions.rem_to_dsp++
      if (['rem', 'remorquage'].includes(newType))                      conversions.dsp_to_rem++
    }
  }

  // Breakdown par source
  const sourceMap = new Map<string, { count: number; totalInterventionSec: number; sampleSize: number }>()
  for (const m of current) {
    const s = m.source || 'inconnu'
    const entry = sourceMap.get(s) || { count: 0, totalInterventionSec: 0, sampleSize: 0 }
    entry.count++
    const dur = diffSeconds(m.accepted_at, m.completed_at)
    if (dur != null) { entry.totalInterventionSec += dur; entry.sampleSize++ }
    sourceMap.set(s, entry)
  }
  const bySource = Array.from(sourceMap.entries()).map(([source, v]) => ({
    source,
    count: v.count,
    avgInterventionMinutes: v.sampleSize > 0 ? Math.round((v.totalInterventionSec / v.sampleSize / 60) * 10) / 10 : null,
  })).sort((a, b) => b.count - a.count)

  // Breakdown par chauffeur (top N)
  const driverIds = Array.from(new Set(current.map(m => m.assigned_to).filter(Boolean) as string[]))
  let driversMap = new Map<string, { id: string; name: string }>()
  if (driverIds.length > 0) {
    const { data: users } = await sb.from('users').select('id, name').in('id', driverIds)
    for (const u of users || []) driversMap.set(u.id, u)
  }
  const byDriver = driverIds.map(id => {
    const userMissions = current.filter(m => m.assigned_to === id)
    const completed = userMissions.filter(m => ['completed', 'to_invoice'].includes(m.status)).length
    const refused = 0  // À enrichir avec dispatch_attempts_log si besoin
    const avgInterventionSec = userMissions.map(m => diffSeconds(m.accepted_at, m.completed_at)).filter((v): v is number => v != null)
    const avgInterventionMin = avgInterventionSec.length > 0
      ? Math.round((avgInterventionSec.reduce((a, b) => a + b, 0) / avgInterventionSec.length / 60) * 10) / 10
      : null
    return {
      driver_id: id,
      name: driversMap.get(id)?.name || '?',
      missions_count: userMissions.length,
      completed,
      refused,
      avg_intervention_minutes: avgInterventionMin,
    }
  }).sort((a, b) => b.missions_count - a.missions_count)

  // Heatmap : count missions par (jour-de-semaine, heure)
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const m of current) {
    const ts = m.intervention_date || m.received_at
    if (!ts) continue
    const d = new Date(ts)
    const wday = (d.getDay() + 6) % 7  // 0=lundi
    const hour = d.getHours()
    heatmap[wday][hour]++
  }

  // Geographic top (top 10 villes)
  const cityMap = new Map<string, number>()
  for (const m of current) {
    if (!m.incident_city) continue
    const c = m.incident_city.trim()
    if (!c) continue
    cityMap.set(c, (cityMap.get(c) || 0) + 1)
  }
  const geographicTop = Array.from(cityMap.entries())
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Refus auto-dispatch : count dispatch_attempts_log refused dans la periode
  const { count: refusalsAutoDispatchCurrent } = await sb
    .from('dispatch_attempts_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'refused')
    .gte('created_at', p.from)
    .lt('created_at', p.to)
  const { count: refusalsAutoDispatchPrev } = await sb
    .from('dispatch_attempts_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'refused')
    .gte('created_at', p.previousFrom)
    .lt('created_at', p.previousTo)

  // Liste des chauffeurs (pour dropdown filtre côté client)
  const { data: allDrivers } = await sb
    .from('users')
    .select('id, name')
    .or('role.eq.driver,role.eq.chauffeur,roles.cs.{driver},roles.cs.{chauffeur}')
    .eq('active', true)
    .order('name', { ascending: true })

  return NextResponse.json({
    period:  p,
    filters: { source, chauffeur, type },
    kpi,
    byType,
    conversions,
    bySource,
    byDriver,
    heatmap,
    geographicTop,
    refusalsAutoDispatch: {
      current:  refusalsAutoDispatchCurrent || 0,
      previous: refusalsAutoDispatchPrev    || 0,
      delta:    pctDelta(refusalsAutoDispatchCurrent || 0, refusalsAutoDispatchPrev || 0),
    },
    drivers_list: allDrivers || [],
  })
}
