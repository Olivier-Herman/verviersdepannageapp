// src/app/api/missions/[id]/snc-gerer-depot/route.ts
//
// POST /api/missions/[id]/snc-gerer-depot
// Body : { action: 'rel' | 'abandoned' | 'assistance',
//          rel_address?, assistance_name?, assistance_dossier?, abandon_reason? }
//
// Geremission SNC en zone Transit (scenario rem_depot) une fois que le
// client se presente au bureau. 3 actions possibles :
//   - rel        : cree une mission REL (relivraison) vers l adresse fournie
//   - abandoned  : sortie definitive du parc + motif
//   - assistance : repris par une assistance (Touring, VAB, etc.)
//
// Pour chaque action, la mission SNC passe en to_invoice (ou completed selon
// le cas) et le devis SNC reste a generer separement via /facturation.
//
// Acces : admin / superadmin / module facturation ou fourriere

import { NextResponse }        from 'next/server'
import { getServerSession }    from 'next-auth'
import { authOptions }         from '@/lib/auth'
import { createAdminClient }   from '@/lib/supabase'
import { releaseParcAndShift } from '@/lib/parc/release'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin', 'dispatcher'].includes(role) ||
    modules.includes('facturation') ||
    modules.includes('fourriere')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const missionId = String(params.id || '').trim()
  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '').trim() as 'rel' | 'abandoned' | 'assistance'
  if (!['rel', 'abandoned', 'assistance'].includes(action)) {
    return NextResponse.json({ error: 'action invalide (rel | abandoned | assistance)' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, source, snc_scenario, status, vehicle_plate, vehicle_brand, vehicle_model,
      client_name, client_phone, billed_to_id, billed_to_name,
      parc_zone_key, parc_row_number, parc_slot_index,
      incident_address, intervention_date, received_at
    `)
    .eq('id', missionId)
    .maybeSingle()
  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (mission.source !== 'police_snc' || mission.snc_scenario !== 'rem_depot') {
    return NextResponse.json({
      error: `Cette mission n est pas une SNC en mise en dépôt (source=${mission.source}, scenario=${mission.snc_scenario})`,
    }, { status: 409 })
  }
  if (mission.status !== 'parked') {
    return NextResponse.json({ error: `Mission deja gere (status=${mission.status})` }, { status: 409 })
  }

  const now = new Date().toISOString()

  // ───────── Action 1 : REL (relivraison) ─────────
  if (action === 'rel') {
    const relAddress = String(body.rel_address || '').trim()
    if (!relAddress) return NextResponse.json({ error: 'rel_address requis' }, { status: 400 })

    // Cree la mission REL (relivraison) liee comme child
    const { data: relMission, error: relErr } = await sb
      .from('incoming_missions')
      .insert({
        external_id:         `REL-${(mission.external_id || mission.id).slice(0, 12)}`,
        source:              'police_snc',
        mission_type:        'relivraison',
        status:              'new',
        parent_mission_id:   mission.id,
        vehicle_plate:       mission.vehicle_plate,
        client_name:         mission.client_name,
        client_phone:        mission.client_phone,
        billed_to_id:        mission.billed_to_id,
        billed_to_name:      mission.billed_to_name,
        incident_address:    'Pepinster (dépôt)',          // origine = depot
        destination_address: relAddress,
        received_at:         now,
        intervention_date:   now,
        created_at:          now,
        updated_at:          now,
      })
      .select('id, external_id')
      .single()
    if (relErr) return NextResponse.json({ error: `Erreur creation REL : ${relErr.message}` }, { status: 500 })

    // Mission SNC parente : passe en to_invoice (le devis SNC reste a creer
    // via la facturation classique) et libere la position parc.
    await sb.from('incoming_missions').update({
      status:        'to_invoice',
      released_at:   now,
      released_by:   user.id,
      updated_at:    now,
    }).eq('id', missionId).then(() => {}, async () => {
      await sb.from('incoming_missions').update({ status: 'to_invoice', updated_at: now }).eq('id', missionId)
    })
    await releaseParcAndShift(sb, missionId)
    // Parc Odoo : le dossier a maintenant une REL enfant en attente → le helper
    // ne finalisera le véhicule que quand la REL sera aussi to_invoice.
    { const { syncParcVehicleTerminated } = await import('@/lib/missions/parc-fleet-state'); await syncParcVehicleTerminated(sb, missionId) }

    await sb.from('mission_logs').insert({
      mission_id: missionId,
      actor_id:   user.id,
      action:     'snc_depot_to_rel',
      notes:      `Client passé au bureau : REL créée vers "${relAddress}" (mission ${relMission?.external_id || relMission?.id}).`,
      metadata:   { rel_mission_id: relMission?.id, rel_address: relAddress },
    }).then(() => {}, () => {})

    return NextResponse.json({ ok: true, action, rel_mission: relMission })
  }

  // ───────── Action 2 : Abandon ─────────
  if (action === 'abandoned') {
    const reason = String(body.abandon_reason || '').trim()
    if (!reason) return NextResponse.json({ error: 'abandon_reason requis' }, { status: 400 })

    await sb.from('incoming_missions').update({
      status:           'to_invoice',  // devis SNC reste a creer
      released_at:      now,
      released_by:      user.id,
      updated_at:       now,
    }).eq('id', missionId).then(() => {}, async () => {
      await sb.from('incoming_missions').update({ status: 'to_invoice', updated_at: now }).eq('id', missionId)
    })
    await releaseParcAndShift(sb, missionId)
    { const { syncParcVehicleTerminated } = await import('@/lib/missions/parc-fleet-state'); await syncParcVehicleTerminated(sb, missionId) }

    await sb.from('mission_logs').insert({
      mission_id: missionId,
      actor_id:   user.id,
      action:     'snc_depot_abandoned',
      notes:      `Véhicule abandonné par le client. Motif : ${reason}. Sortie du parc, devis SNC à facturer.`,
      metadata:   { reason },
    }).then(() => {}, () => {})

    return NextResponse.json({ ok: true, action, message: 'Véhicule sorti du parc. Devis SNC reste à facturer.' })
  }

  // ───────── Action 3 : Repris par assistance ─────────
  if (action === 'assistance') {
    const name = String(body.assistance_name || '').trim()
    const dossier = String(body.assistance_dossier || '').trim()
    if (!name) return NextResponse.json({ error: 'assistance_name requis' }, { status: 400 })

    await sb.from('incoming_missions').update({
      status:        'to_invoice',
      released_at:   now,
      released_by:   user.id,
      updated_at:    now,
    }).eq('id', missionId).then(() => {}, async () => {
      await sb.from('incoming_missions').update({ status: 'to_invoice', updated_at: now }).eq('id', missionId)
    })
    await releaseParcAndShift(sb, missionId)
    { const { syncParcVehicleTerminated } = await import('@/lib/missions/parc-fleet-state'); await syncParcVehicleTerminated(sb, missionId) }

    await sb.from('mission_logs').insert({
      mission_id: missionId,
      actor_id:   user.id,
      action:     'snc_depot_assistance',
      notes:      `Repris par assistance ${name}${dossier ? ` (dossier ${dossier})` : ''}. Devis SNC reste à facturer au client.`,
      metadata:   { assistance_name: name, assistance_dossier: dossier || null },
    }).then(() => {}, () => {})

    return NextResponse.json({
      ok: true,
      action,
      message: `Véhicule sorti du parc, repris par ${name}. Devis SNC reste à facturer.`,
    })
  }

  return NextResponse.json({ error: 'Action non implementee' }, { status: 400 })
}
