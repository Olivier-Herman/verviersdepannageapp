// src/app/api/missions/open-by-plate/route.ts
//
// GET /api/missions/open-by-plate?plate=1ABC234
//
// Cherche une mission ouverte (= en parc OU en cours OU en livraison) pour
// cette plaque. Olivier 2026-05-26 : utilise par le module /encaissement en
// mode standalone pour proposer un auto-lien vers une mission existante.
//
// Retourne :
//   { found: false }                            si aucune mission ouverte
//   { found: true, mission: { id, mission_number, source, mission_type,
//                             amount_to_collect, payment_amount,
//                             vehicle_brand, vehicle_model, status, ... } }
//                                               sinon (1 seule = la plus recente)
//
// Statuts consideres "ouverts" : parked, in_progress, delivering, dispatching,
// assigned, accepted, new, to_invoice. Exclusions : completed, cancelled,
// ignored, archived (gerer via flag archived_at).
//
// Accessible a tout user authentifie (utile aux chauffeurs ET au bureau).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const OPEN_STATUSES = [
  'new', 'dispatching', 'assigned', 'accepted',
  'in_progress', 'parked', 'delivering', 'to_invoice',
]

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const plate = (searchParams.get('plate') || '').trim().toUpperCase()
  if (!plate || plate.length < 3) {
    return NextResponse.json({ error: 'Plaque trop courte (min 3 chars)' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: missions, error } = await supabase
    .from('incoming_missions')
    .select(`
      id, mission_number, external_id, source, mission_type, status,
      vehicle_plate, vehicle_brand, vehicle_model,
      client_name, billed_to_name,
      amount_to_collect, payment_amount, payment_collected_at, payment_mode,
      received_at, intervention_date, parked_at, created_at
    `)
    .eq('vehicle_plate', plate)
    .in('status', OPEN_STATUSES)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('[open-by-plate] Erreur SQL:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!missions || missions.length === 0) {
    return NextResponse.json({ found: false })
  }

  // Si plusieurs missions ouvertes pour la meme plaque (cas rare : REM+REL,
  // ou doublons accidents), on retourne TOUTES pour que l UI affiche un choix.
  return NextResponse.json({
    found:    true,
    mission:  missions[0],
    count:    missions.length,
    missions: missions,
  })
}
