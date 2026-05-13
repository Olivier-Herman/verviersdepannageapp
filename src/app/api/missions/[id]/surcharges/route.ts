// src/app/api/missions/[id]/surcharges/route.ts
//
// GET /api/missions/[id]/surcharges
// Renvoie les majorations applicables a la mission, basees sur la date
// d'intervention = intervention_date (= bandeau rouge dans la fiche dispatch).
//
// Choix metier (decide 2026-05-13 par Olivier) :
//   intervention_date reflete l'heure REELLE de l'intervention indiquee
//   par l'assistance. C'est le critere que les assistances utilisent
//   pour valider/refuser la majoration sur leur facture.
//
//   Exemples concrets :
//   - Mission urgente : assistance envoie mardi 20:37 pour intervention
//     immediate → intervention_date = 20:37 mardi → +35% nuit semaine OK
//   - Mission differee : assistance envoie lundi 22h pour intervention
//     mardi 9h → intervention_date = mardi 9h → PAS de majoration
//     (received_at = lundi 22h aurait declenche +35% a tort)
//   - Mission batch : incident mardi 20h, assistance nous envoie mercredi
//     08:43 → intervention_date = mardi 20h → +35% nuit OK
//     (received_at = mercredi 08:43 aurait rate la majoration)
//
//   On ignore completed_at (heure cloture chauffeur) qui peut deriver
//   de plusieurs minutes apres l'intervention reelle.

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
