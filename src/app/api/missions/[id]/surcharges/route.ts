// src/app/api/missions/[id]/surcharges/route.ts
//
// GET /api/missions/[id]/surcharges
// Renvoie les majorations applicables a la mission, basees sur completed_at
// (heure reelle de cloture chauffeur). Si pas de completed_at, utilise
// intervention_date en fallback.

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { createAdminClient }       from '@/lib/supabase'
import { getApplicableSurcharges } from '@/lib/surcharges'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: mission, error } = await sb
    .from('incoming_missions')
    .select('source, client_name, mission_type, incident_type, parent_mission_id, is_police_call, completed_at, intervention_date, received_at')
    .eq('id', params.id)
    .maybeSingle()
  if (error)    return NextResponse.json({ error: error.message }, { status: 500 })
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const dateStr = mission.completed_at || mission.intervention_date || mission.received_at
  const at = new Date(dateStr)

  const surcharges = await getApplicableSurcharges(mission, at)

  return NextResponse.json({
    surcharges,
    reference_at: at.toISOString(),
    reference_kind: mission.completed_at ? 'completed_at' : (mission.intervention_date ? 'intervention_date' : 'received_at'),
  })
}
