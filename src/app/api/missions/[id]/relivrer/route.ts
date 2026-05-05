// src/app/api/missions/[id]/relivrer/route.ts
//
// Crée une mission de relivraison (REL) à partir d'une mission parc-ée.
// Déclenché par le dispatcher via le bouton "Relivrer" sur la fiche d'une
// mission en statut 'parked'. Idempotent : si une REL existe déjà pour
// cette mission parente, retourne son id.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { createRelivraisonMission } from '@/lib/missions/create-relivraison'

const ALLOWED_ROLES = ['dispatcher', 'admin', 'superadmin']

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = session.user as any
  const userRoles: string[] = Array.isArray(u.roles) ? u.roles : (u.role ? [u.role] : [])
  if (!userRoles.some(r => ALLOWED_ROLES.includes(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()

  // Lire la mission parente — elle doit être en statut 'parked' avec
  // une redelivery_address déjà définie (= ancienne destination).
  const { data: parent } = await sb
    .from('incoming_missions')
    .select('id, status, destination_address, destination_lat, destination_lng, redelivery_address, park_stage_name')
    .eq('id', params.id)
    .single()
  if (!parent) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  if (parent.status !== 'parked') {
    return NextResponse.json({ error: 'La mission n\'est pas en parc' }, { status: 422 })
  }

  // À ce stade, destination_address contient l'adresse du parc (vu depuis park),
  // et redelivery_address contient l'adresse originale que l'on veut atteindre.
  const redelivery = parent.redelivery_address
  if (!redelivery) {
    return NextResponse.json({ error: 'Aucune adresse de relivraison enregistrée' }, { status: 422 })
  }

  const result = await createRelivraisonMission({
    parentMissionId:   params.id,
    parkAddress:       parent.destination_address || '',
    parkLat:           parent.destination_lat ?? null,
    parkLng:           parent.destination_lng ?? null,
    redeliveryAddress: redelivery,
  })

  if (!result) {
    return NextResponse.json({ error: 'Création REL échouée' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, mission_id: result.id })
}
