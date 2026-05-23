// src/app/api/missions/[id]/qr-rel-action/route.ts
//
// POST /api/missions/[id]/qr-rel-action
// Declenche par le scan d un QR REL dans le parc. Cree ou reassigne la
// mission REL fille au chauffeur scanneur.
//
// Body :
//   { confirm_reassign?: boolean }  // true = OK pour reprendre une REL deja
//                                   // assignee a un autre chauffeur
//
// Reponses :
//   200 { ok: true, mission_id, redirect_url }   -> success
//   409 { ok: false, needs_confirm: true,        -> REL deja prise, demande confirmation
//         current_assignee_id, current_assignee_name }
//   403, 400, 500                                -> erreurs

import { NextResponse }              from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { createRelivraisonMission }  from '@/lib/missions/create-relivraison'
import { sendPushToUser }            from '@/lib/push'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const userId   = user.id
  const userRoles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const isDriver = userRoles.includes('driver') || userRoles.some(r => ['admin', 'superadmin'].includes(r))
  if (!isDriver) {
    return NextResponse.json({ ok: false, error: 'Seul un chauffeur peut prendre une REL' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const confirmReassign = !!body.confirm_reassign

  const sb = createAdminClient()

  // 1. Lecture mission parent
  const { data: parent, error: pErr } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, source, mission_type, status, snc_scenario,
      vehicle_plate, destination_address, destination_city,
      incident_address, incident_lat, incident_lng
    `)
    .eq('id', params.id)
    .single()
  if (pErr || !parent) {
    return NextResponse.json({ ok: false, error: 'Mission introuvable' }, { status: 404 })
  }

  // 2. Verification eligibilite
  const isParked = parent.status === 'parked'
  const isRemRel = parent.mission_type === 'REM+REL'
  const isSiabisRemDepot = ['police_snc', 'sia_couvert'].includes(parent.source || '')
                        && parent.snc_scenario === 'rem_depot'
  if (!isParked || !(isRemRel || isSiabisRemDepot)) {
    return NextResponse.json({
      ok: false,
      error: `Mission non eligible pour relivraison (statut=${parent.status}, type=${parent.mission_type})`,
    }, { status: 400 })
  }

  // 3. Cherche une REL fille existante (idempotence)
  const { data: existingRel } = await sb
    .from('incoming_missions')
    .select('id, external_id, status, assigned_to')
    .eq('parent_mission_id', parent.id)
    .eq('incident_type', 'relivraison')
    .maybeSingle()

  let relMissionId: string
  let wasReassigned = false

  if (existingRel) {
    // REL deja existante : verifier l assigne actuel
    if (existingRel.assigned_to && existingRel.assigned_to !== userId && !confirmReassign) {
      // Conflit : demande confirmation au scanneur
      let currentAssigneeName = 'un autre chauffeur'
      const { data: u } = await sb.from('users').select('name').eq('id', existingRel.assigned_to).single()
      if (u?.name) currentAssigneeName = u.name
      return NextResponse.json({
        ok:                       false,
        needs_confirm:            true,
        current_assignee_id:      existingRel.assigned_to,
        current_assignee_name:    currentAssigneeName,
      }, { status: 409 })
    }
    // Reassigner si necessaire
    wasReassigned = existingRel.assigned_to && existingRel.assigned_to !== userId
    relMissionId = existingRel.id
    if (existingRel.assigned_to !== userId) {
      await sb.from('incoming_missions')
        .update({
          assigned_to: userId,
          status:      'assigned',
          assigned_at: new Date().toISOString(),
        })
        .eq('id', relMissionId)
      await sb.from('mission_logs').insert({
        mission_id: relMissionId,
        actor_id:   userId,
        action:     'assigned',
        notes:      wasReassigned
          ? `Reassigne via scan QR REL (anciennement assigne a ${existingRel.assigned_to})`
          : 'Assigne via scan QR REL',
        metadata:   { qr_scan: true, reassigned: wasReassigned },
      })
      // Notifier l ancien assigne qu il n est plus dessus
      if (wasReassigned && existingRel.assigned_to) {
        sendPushToUser(existingRel.assigned_to, {
          title: 'Mission REL reprise',
          body:  `La relivraison ${existingRel.external_id} a ete reprise par un autre chauffeur via scan QR.`,
          url:   `/dispatch/${relMissionId}`,
          tag:   `mission-rel-${relMissionId}`,
        }).catch(() => {})
      }
    }
  } else {
    // 4. Pas de REL fille : creation via le helper existant
    const result = await createRelivraisonMission({
      parentMissionId:    parent.id,
      parkAddress:        parent.incident_address || '',
      parkLat:            parent.incident_lat,
      parkLng:            parent.incident_lng,
      redeliveryAddress: [parent.destination_address, parent.destination_city].filter(Boolean).join(', '),
    })
    if (!result) {
      return NextResponse.json({ ok: false, error: 'Echec creation REL' }, { status: 500 })
    }
    relMissionId = result.id
    // Assigner immediatement au scanneur
    await sb.from('incoming_missions')
      .update({
        assigned_to: userId,
        status:      'assigned',
        assigned_at: new Date().toISOString(),
      })
      .eq('id', relMissionId)
    await sb.from('mission_logs').insert({
      mission_id: relMissionId,
      actor_id:   userId,
      action:     'assigned',
      notes:      'Cree et assigne via scan QR REL',
      metadata:   { qr_scan: true, created_via_qr: true },
    })
  }

  return NextResponse.json({
    ok:           true,
    mission_id:   relMissionId,
    redirect_url: `/mission/${relMissionId}`,
    reassigned:   wasReassigned,
  })
}
