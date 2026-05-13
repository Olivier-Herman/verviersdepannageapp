// src/app/api/missions/[id]/surcharges/route.ts
//
// GET /api/missions/[id]/surcharges
// Renvoie les majorations applicables a la mission, basees sur l'heure
// d'envoi de la mission PAR l'assistance = received_at.
//
// Choix metier (decide 2026-05-13 par Olivier) :
//   Les assistances valident/refusent la majoration sur la facture en
//   se basant sur l'heure ou ELLES nous ont envoye la mission :
//   - Mission recue a 18h59 : Touring refuse +35% (avant 19h00)
//   - Mission recue a 19h00 : +35% accepte
//   - Mission recue a 06h59 : +35% accepte (avant fin de plage 07h00)
//   - Mission recue a 07h00 : refuse
//   Donc on s'aligne strictement sur l'heure des compagnies. Pas de
//   marge, pas d'heure chauffeur (completed_at), pas d'heure planifiee
//   (intervention_date).
//
// Fallback : intervention_date si received_at est null (theoriquement impossible).

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

  const dateStr = mission.received_at || mission.intervention_date
  const at = new Date(dateStr)

  const surcharges = await getApplicableSurcharges(mission, at)

  return NextResponse.json({
    surcharges,
    reference_at: at.toISOString(),
    reference_kind: mission.received_at ? 'received_at' : 'intervention_date',
  })
}
