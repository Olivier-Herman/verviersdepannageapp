// src/app/api/users/driver-status/route.ts
// Statut de chaque chauffeur actif : Libre / En mission

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()

  const { data: drivers } = await supabase
    .from('users')
    .select('id, name')
    .eq('active', true)
    .contains('roles', ['driver'])
    .order('name')

  if (!drivers || drivers.length === 0) return NextResponse.json({ drivers: [] })

  const { data: activeMissions } = await supabase
    .from('incoming_missions')
    .select('id, assigned_to, client_name, mission_type, status')
    .in('status', ['assigned', 'accepted', 'in_progress'])
    .in('assigned_to', drivers.map(d => d.id))

  const missionByDriver = new Map<string, (typeof activeMissions extends null ? never : NonNullable<typeof activeMissions>[number])>()
  for (const m of activeMissions ?? []) {
    if (m.assigned_to && !missionByDriver.has(m.assigned_to)) {
      missionByDriver.set(m.assigned_to, m)
    }
  }

  const result = drivers.map(d => {
    const m = missionByDriver.get(d.id)
    return m
      ? { id: d.id, name: d.name, status: 'en_mission', mission_id: m.id, client_name: m.client_name, mission_type: m.mission_type }
      : { id: d.id, name: d.name, status: 'libre' }
  })

  return NextResponse.json({ drivers: result })
}
