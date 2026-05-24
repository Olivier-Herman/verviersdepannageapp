// src/app/api/missions/[id]/price-estimate/route.ts
//
// GET /api/missions/[id]/price-estimate
// Retourne l estimation tarifaire d une mission selon source_tariffs + surcharges.
// Visible par tout user authentifie (dispatcher/admin) qui a acces a la mission.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { estimateMissionPrice } from '@/lib/missions/estimate-price'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: mission, error } = await sb
    .from('incoming_missions')
    .select('id, source, mission_type, client_name, vehicle_mileage, parked_at, intervention_date, received_at, incident_type, parent_mission_id, amount_to_collect')
    .eq('id', params.id)
    .single()

  if (error || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const estimate = await estimateMissionPrice(mission as any)
  return NextResponse.json(estimate)
}
