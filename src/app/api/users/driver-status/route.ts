// src/app/api/users/driver-status/route.ts
// Retourne le statut de chaque chauffeur actif : Libre / En mission
// Compatible avec role='driver' (colonne) ET roles=['driver'] (array)

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()

  // Récupère tous les chauffeurs actifs — cherche sur role ET roles[]
  // pour couvrir les deux cas de configuration possible
  const { data: drivers, error } = await supabase
    .from('users')
    .select('id, name, role, roles')
    .eq('active', true)
    .or('role.eq.driver,roles.cs.{driver}')
    .order('name')

  if (error) {
    console.error('[DriverStatus] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!drivers || drivers.length === 0) {
    return NextResponse.json({ drivers: [] })
  }

  // Récupère les missions actives par chauffeur
  const { data: activeMissions } = await supabase
    .from('incoming_missions')
    .select('id, assigned_to, client_name, mission_type, status')
    .in('status', ['assigned', 'accepted', 'in_progress'])
    .in('assigned_to', drivers.map(d => d.id))

  // Un chauffeur peut avoir plusieurs missions — on prend la plus "avancée"
  const STATUS_WEIGHT: Record<string, number> = {
    in_progress: 3,
    accepted:    2,
    assigned:    1,
  }

  const missionByDriver = new Map<string, NonNullable<typeof activeMissions>[number]>()
  for (const m of activeMissions ?? []) {
    if (!m.assigned_to) continue
    const existing = missionByDriver.get(m.assigned_to)
    if (!existing || (STATUS_WEIGHT[m.status] ?? 0) > (STATUS_WEIGHT[existing.status] ?? 0)) {
      missionByDriver.set(m.assigned_to, m)
    }
  }

  const result = drivers.map(d => {
    const m = missionByDriver.get(d.id)
    return m
      ? {
          id:             d.id,
          name:           d.name,
          status:         'en_mission' as const,
          mission_id:     m.id,
          client_name:    m.client_name ?? undefined,
          mission_type:   m.mission_type ?? undefined,
          mission_status: m.status,
        }
      : { id: d.id, name: d.name, status: 'libre' as const }
  })

  return NextResponse.json({ drivers: result })
}
