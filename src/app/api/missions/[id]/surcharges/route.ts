// src/app/api/missions/[id]/surcharges/route.ts
//
// GET /api/missions/[id]/surcharges
// Renvoie les majorations applicables a la mission, basees sur la date
// d'intervention (heure planifiee / heure de l'appel client), PAS sur
// completed_at qui est l'heure de cloture chauffeur — ce qui n'a aucun
// sens pour la facturation (la majoration depend du contexte horaire de
// la mission, pas du moment ou le chauffeur a clique "Termine").
//
// Ordre de priorite :
//   1. intervention_date (heure planifiee, source de verite)
//   2. received_at (fallback : heure de reception du mail mission)
//
// completed_at n'est volontairement pas utilise.

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
    .select('source, client_name, mission_type, incident_type, parent_mission_id, intervention_date, received_at')
    .eq('id', params.id)
    .maybeSingle()
  if (error)    return NextResponse.json({ error: error.message }, { status: 500 })
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const dateStr = mission.intervention_date || mission.received_at
  const at = new Date(dateStr)

  const surcharges = await getApplicableSurcharges(mission, at)

  return NextResponse.json({
    surcharges,
    reference_at: at.toISOString(),
    reference_kind: mission.intervention_date ? 'intervention_date' : 'received_at',
  })
}
