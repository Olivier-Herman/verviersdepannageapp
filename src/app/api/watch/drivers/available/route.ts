// src/app/api/watch/drivers/available/route.ts
//
// GET /api/watch/drivers/available
// Auth : Authorization: Bearer <watch-jwt>
// Acces : dispatcher / admin / superadmin
//
// Liste tous les chauffeurs (role/roles inclut 'chauffeur' ou 'driver'), avec
// statut idle/busy. Idle = aucune mission active. Busy = au moins une mission
// en status ∈ {assigned, accepted, in_progress, delivering}.
//
// Tri : idle en premier (par nom), puis busy (par nom). Permet au dispatcher
// d assigner rapidement depuis la Watch.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyWatchAuth }   from '@/lib/auth-watch'

export const dynamic = 'force-dynamic'

const ACTIVE_STATUSES = ['assigned', 'accepted', 'in_progress', 'delivering']

interface WatchDriver {
  id:                  string
  name:                string
  status:              'idle' | 'busy'
  current_mission_id:  string | null
  current_mission_label: string | null  // ex: "REM Audi A4 - Liege"
  active_count:        number
}

export async function GET(req: Request) {
  const userId = await verifyWatchAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()

  // Verifie que l appelant est dispatcher
  const { data: caller } = await sb
    .from('users')
    .select('id, role, roles')
    .eq('id', userId)
    .single()
  if (!caller) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  const callerRoles = (Array.isArray(caller.roles) ? caller.roles as string[] : [caller.role].filter(Boolean) as string[])
    .map(r => String(r ?? '').trim().toLowerCase())
  const isSuperadmin = callerRoles.includes('superadmin')
  const isDispatcher = isSuperadmin || callerRoles.some(r => r === 'dispatcher' || r === 'admin')
  if (!isDispatcher) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Recupere tous les users actifs (non-suspendus). On filtre les chauffeurs
  // en JS car role/roles peut etre stocke a divers endroits selon historique.
  const { data: users } = await sb
    .from('users')
    .select('id, name, role, roles, suspended_at')
    .is('suspended_at', null)
    .order('name', { ascending: true })

  // ⚠️ `modules` n'est PAS une colonne de `users` (table user_modules). Le
  // sélectionner cassait la requête → 0 chauffeur. On lit le module
  // driver_missions depuis user_modules. Fix Olivier 2026-07-10.
  const { data: dmMods } = await sb.from('user_modules')
    .select('user_id').eq('module_id', 'driver_missions').eq('granted', true)
  const driverModuleIds = new Set((dmMods || []).map(m => m.user_id))

  const drivers = (users || []).filter(u => {
    const roles = Array.isArray(u.roles) ? u.roles : [u.role].filter(Boolean)
    const normalized = roles.map((r: any) => String(r ?? '').trim().toLowerCase())
    return normalized.includes('chauffeur')
        || normalized.includes('driver')
        || normalized.includes('superadmin')
        || driverModuleIds.has(u.id)
  })

  if (drivers.length === 0) {
    return NextResponse.json({ drivers: [] })
  }

  // Lookup missions actives par chauffeur
  const driverIds = drivers.map(d => d.id)
  const { data: activeMissions } = await sb
    .from('incoming_missions')
    .select('id, assigned_to, mission_type, vehicle_brand, vehicle_model, vehicle_plate, incident_city')
    .in('assigned_to', driverIds)
    .in('status', ACTIVE_STATUSES)
    .order('assigned_at', { ascending: false })

  const missionsByDriver = new Map<string, any[]>()
  for (const m of (activeMissions || [])) {
    if (!m.assigned_to) continue
    const list = missionsByDriver.get(m.assigned_to) || []
    list.push(m)
    missionsByDriver.set(m.assigned_to, list)
  }

  function missionLabel(m: any): string {
    const mt = (m.mission_type || '').toLowerCase()
    const tag = ['rem', 'remorquage'].includes(mt) ? 'REM'
              : ['dsp', 'depannage', 'reparation_place'].includes(mt) ? 'DSP'
              : ['rel', 'relivraison'].includes(mt) ? 'REL'
              : 'MIS'
    const veh = [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || m.vehicle_plate || ''
    const city = m.incident_city || ''
    return [tag, veh, city ? `· ${city}` : ''].filter(Boolean).join(' ').trim()
  }

  const result: WatchDriver[] = drivers.map(d => {
    const active = missionsByDriver.get(d.id) || []
    const first = active[0]
    return {
      id:                    d.id,
      name:                  d.name || '(sans nom)',
      status:                active.length > 0 ? 'busy' : 'idle',
      current_mission_id:    first?.id || null,
      current_mission_label: first ? missionLabel(first) : null,
      active_count:          active.length,
    }
  })

  // Tri : idle d abord puis busy, puis par nom
  result.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'idle' ? -1 : 1
    return a.name.localeCompare(b.name, 'fr')
  })

  return NextResponse.json({ drivers: result, server_time: new Date().toISOString() })
}
