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
import { isRelEligibleSource }       from '@/lib/missions/rel-eligible'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const userId   = user.id
  const userRoles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const isAdminOrDispatcher = userRoles.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))
  const isDriver = userRoles.includes('driver')
  if (!isDriver && !isAdminOrDispatcher) {
    return NextResponse.json({ ok: false, error: 'Acces refuse' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const confirmReassign = !!body.confirm_reassign
  // Olivier 2026-05-28 : dispatcher peut assigner a un chauffeur specifique.
  // Sinon (chauffeur scanneur) : auto-assignation au scanneur (userId).
  const targetDriverId: string = (isAdminOrDispatcher && body.assigned_to_driver_id)
    ? String(body.assigned_to_driver_id)
    : userId

  const sb = createAdminClient()

  // 1. Lecture mission parent.
  // Olivier 2026-06-18 : select('*') au lieu d'une liste explicite. Avant, la
  // liste référençait une colonne potentiellement absente (destination_city) →
  // PostgREST renvoyait une erreur → le code affichait "Mission introuvable" au
  // chauffeur dès qu'il tentait de créer la REL au scan (le cas où la REL était
  // pré-créée n'appelle pas cette route, d'où "ça marche si je l'ai créée moi-même").
  const { data: parent, error: pErr } = await sb
    .from('incoming_missions')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (pErr) {
    console.error('[qr-rel-action] lecture mission échouée:', pErr.message)
    return NextResponse.json({ ok: false, error: `Erreur lecture mission : ${pErr.message}` }, { status: 500 })
  }
  if (!parent) {
    return NextResponse.json({ ok: false, error: 'Mission introuvable' }, { status: 404 })
  }

  // 2. Verification eligibilite
  // Olivier 2026-05-28 : ajout Appel Prive REM depot.
  // Olivier 2026-06-05 : bascule Transit -> K pour rem_depot, on accepte
  // les 2 zones (rétrocompat missions migrees).
  const isParked = parent.status === 'parked'
  const isRemRel = parent.mission_type === 'REM+REL'
  const isSiabisRemDepot = ['police_snc', 'sia_couvert'].includes(parent.source || '')
                        && parent.snc_scenario === 'rem_depot'
  const isPriveDepot = parent.source === 'prive'
                    && (parent.parc_zone_key === 'K' || parent.parc_zone_key === 'Transit')
  // Olivier 2026-06-18 : cas general. Tout vehicule parque en zone K (= file
  // relivraison) dont la source est eligible REL doit pouvoir generer la REL au
  // scan, meme si le type n'a pas ete converti en REM+REL (ex: assistance dont
  // l'adresse de relivraison vient d'etre saisie). Avant : seuls REM+REL / SNC
  // rem_depot / prive etaient acceptes -> "Mission non eligible" au scan.
  const isZoneKRelEligible = parent.parc_zone_key === 'K'
                          && isRelEligibleSource(parent.source, parent.snc_scenario)
  if (!isParked || !(isRemRel || isSiabisRemDepot || isPriveDepot || isZoneKRelEligible)) {
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
    if (existingRel.assigned_to && existingRel.assigned_to !== targetDriverId && !confirmReassign) {
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
    wasReassigned = Boolean(existingRel.assigned_to && existingRel.assigned_to !== targetDriverId)
    relMissionId = existingRel.id
    if (existingRel.assigned_to !== targetDriverId) {
      await sb.from('incoming_missions')
        .update({
          assigned_to: targetDriverId,
          status:      'assigned',
          assigned_at: new Date().toISOString(),
        })
        .eq('id', relMissionId)
      await sb.from('mission_logs').insert({
        mission_id: relMissionId,
        actor_id:   userId,  // l acteur reste l user qui a clique (peut etre dispatcher)
        action:     'assigned',
        notes:      wasReassigned
          ? `Reassigne via scan QR REL a ${targetDriverId} (anciennement ${existingRel.assigned_to}) par ${userId}`
          : `Assigne via scan QR REL a ${targetDriverId} par ${userId}`,
        metadata:   { qr_scan: true, reassigned: wasReassigned, assigned_by: userId, assigned_to: targetDriverId },
      })
      // Notifier l ancien assigne qu il n est plus dessus
      if (wasReassigned && existingRel.assigned_to) {
        sendPushToUser(existingRel.assigned_to, {
          title: 'Mission REL reprise',
          body:  `La relivraison ${existingRel.external_id} a ete reassignee.`,
          url:   `/dispatch/${relMissionId}`,
          tag:   `mission-rel-${relMissionId}`,
        }).catch(() => {})
      }
      // Si dispatcher a assigne a un chauffeur tiers, notifier le nouveau driver
      if (targetDriverId !== userId) {
        sendPushToUser(targetDriverId, {
          title: '🚛 Nouvelle relivraison assignee',
          body:  `Tu as ete assigne(e) a la REL ${existingRel.external_id}.`,
          url:   `/mission/${relMissionId}`,
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
      redeliveryAddress: parent.redelivery_address || [parent.destination_address, parent.destination_city].filter(Boolean).join(', '),
    })
    if (!result) {
      return NextResponse.json({ ok: false, error: 'Echec creation REL' }, { status: 500 })
    }
    relMissionId = result.id
    // Assigner immediatement au targetDriver (scanneur OU chauffeur selectionne par dispatcher)
    await sb.from('incoming_missions')
      .update({
        assigned_to: targetDriverId,
        status:      'assigned',
        assigned_at: new Date().toISOString(),
      })
      .eq('id', relMissionId)
    await sb.from('mission_logs').insert({
      mission_id: relMissionId,
      actor_id:   userId,  // l acteur reste l user qui a clique
      action:     'assigned',
      notes:      `Cree via scan QR REL et assigne a ${targetDriverId} par ${userId}`,
      metadata:   { qr_scan: true, created_via_qr: true, assigned_by: userId, assigned_to: targetDriverId },
    })
  }

  // Redirect : dispatcher -> fiche dispatch (suivi). Driver scanneur -> fiche mission chauffeur.
  const redirectUrl = (isAdminOrDispatcher && targetDriverId !== userId)
    ? `/dispatch/${relMissionId}`
    : `/mission/${relMissionId}`

  return NextResponse.json({
    ok:           true,
    mission_id:   relMissionId,
    redirect_url: redirectUrl,
    reassigned:   wasReassigned,
  })
}
