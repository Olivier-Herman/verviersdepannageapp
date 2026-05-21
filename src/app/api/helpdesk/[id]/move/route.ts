// src/app/api/helpdesk/[id]/move/route.ts
//
// POST /api/helpdesk/[id]/move
// Body : { to_state_id: number, notes?: string }
//
// Met a jour fleet.vehicle.state_id (le vehicule lie au ticket helpdesk)
// dans Odoo + log dans fourriere_movements. Permet de bouger un vehicule
// depuis la page mobile /v/[id] (acces par scan QR).
//
// Pas de PIN : l acces est garanti par la permission de module "fourriere".

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { createAdminClient }       from '@/lib/supabase'
import { odooRpc, withOdooActor }  from '@/lib/odoo'
import { FOURRIERE_ZONE_BY_ID, SCRATCH_STATE_ID } from '@/lib/fourriere'
import { triggerTowsoftParcChange } from '@/lib/towsoft-sync'
import { shiftAfterRelease }        from '@/lib/parc/release'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ticketId = parseInt(params.id, 10)
  if (!ticketId || isNaN(ticketId)) {
    return NextResponse.json({ error: 'ID ticket invalide' }, { status: 400 })
  }

  const body = await req.json() as {
    to_state_id?:  number
    notes?:        string
    /** Optionnel : rangee cible dans la zone (pour placement precis cote VD Soft) */
    target_row?:   number | null
    /** Optionnel : slot cible dans la rangee */
    target_slot?:  number | null
  }
  const to_state_id = Number(body.to_state_id)
  if (!to_state_id) {
    return NextResponse.json({ error: 'to_state_id requis' }, { status: 400 })
  }
  if (!FOURRIERE_ZONE_BY_ID[to_state_id] && to_state_id !== SCRATCH_STATE_ID) {
    return NextResponse.json({
      error: `state_id ${to_state_id} n'est pas une zone fourriere connue`,
    }, { status: 400 })
  }

  return withOdooActor(user.id as string | undefined, async () => {
    try {
      // 1. Lit le ticket pour trouver le fleet vehicle lie + n° mission Towsoft
      const tickets = await odooRpc<any[]>('helpdesk.ticket', 'search_read', [
        [['id', '=', ticketId]],
      ], {
        fields: ['id', 'x_studio_vehicule', 'x_studio_fiche_vehicule', 'x_studio_mission_towsoft'],
        limit: 1,
      })
      if (!tickets || tickets.length === 0) {
        return NextResponse.json({ error: 'Ticket introuvable' }, { status: 404 })
      }
      const t = tickets[0]
      const fleetId = typeof t.x_studio_fiche_vehicule === 'number'
        ? t.x_studio_fiche_vehicule
        : Array.isArray(t.x_studio_vehicule) ? t.x_studio_vehicule[0] : null

      if (!fleetId) {
        return NextResponse.json({ error: 'Ticket sans véhicule lié' }, { status: 400 })
      }

      // 2. Lit l etat actuel du vehicule
      const current = await odooRpc<any[]>('fleet.vehicle', 'read', [
        [fleetId], ['id', 'license_plate', 'vin_sn', 'brand_id', 'model_id', 'state_id'],
      ])
      if (!current || current.length === 0) {
        return NextResponse.json({ error: 'Véhicule introuvable dans Odoo' }, { status: 404 })
      }
      const v = current[0]
      const from_state_id   = v.state_id?.[0] || null
      const from_state_name = v.state_id?.[1] || null

      if (from_state_id === to_state_id) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          message: 'Véhicule déjà dans cette zone',
        })
      }

      // 3. Met a jour le state_id dans Odoo
      await odooRpc('fleet.vehicle', 'write', [[fleetId], { state_id: to_state_id }])

      // 4. Log dans fourriere_movements (audit)
      const toZone = FOURRIERE_ZONE_BY_ID[to_state_id]
      const toName = toZone?.full_name || (to_state_id === SCRATCH_STATE_ID ? 'Scratch' : `state_${to_state_id}`)
      const toCodeRaw = toZone?.code || null

      const sb = createAdminClient()

      // Resolve la casse canonique de parc_zones.key (eviter mismatch BOX/Box).
      // FOURRIERE_ZONES.code est en uppercase ('BOX'), mais parc_zones.key peut
      // etre en mixed case ('Box') -> il faut le lookup case-insensitive.
      let toCode: string | null = toCodeRaw
      if (toCodeRaw) {
        const { data: zoneRow } = await sb
          .from('parc_zones')
          .select('key')
          .ilike('key', toCodeRaw)
          .maybeSingle()
        if (zoneRow?.key) toCode = zoneRow.key
      }
      await sb.from('fourriere_movements').insert({
        odoo_vehicle_id: fleetId,
        vehicle_plate:   v.license_plate || null,
        vehicle_brand:   v.brand_id?.[1] || null,
        vehicle_model:   v.model_id?.[1] || null,
        from_state_id,
        from_state_name,
        to_state_id,
        to_state_name:   toName,
        moved_by:        user.id,
        notes:           body.notes || `Via /v/${ticketId}`,
      })

      // 4bis. Synchronise incoming_missions cote VD Soft (le bouton "Transfert
      // de parc" change la zone Odoo, on doit aussi mettre a jour le plan visuel
      // et liberer l ancien slot avec shift). Lookup par helpdesk_id puis par
      // plaque en fallback. Best effort.
      try {
        const plate = (v.license_plate || '').trim().toUpperCase()
        let mission: any = null
        // Match par odoo_helpdesk_id (preferable, lien direct)
        const { data: byTicket } = await sb
          .from('incoming_missions')
          .select('id, parc_zone_key, parc_row_number, parc_slot_index, status')
          .eq('odoo_helpdesk_id', ticketId)
          .in('status', ['parked', 'delivering'])
          .maybeSingle()
        mission = byTicket
        // Fallback : match par plaque (cas missions creees avant qu on stocke
        // l odoo_helpdesk_id, ou import legacy)
        if (!mission && plate) {
          const { data: byPlate } = await sb
            .from('incoming_missions')
            .select('id, parc_zone_key, parc_row_number, parc_slot_index, status')
            .eq('vehicle_plate', plate)
            .in('status', ['parked', 'delivering'])
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          mission = byPlate
        }

        if (mission) {
          const wasAt = (mission.parc_zone_key && mission.parc_row_number && mission.parc_slot_index)
            ? { zone: mission.parc_zone_key, row: mission.parc_row_number, slot: mission.parc_slot_index }
            : null

          // Update vers la nouvelle zone. Si target_row/target_slot fournis et
          // valides, on place precisement (workflow : suggestion auto sur /v/[id]
          // qui propose la rangee puis confirmation de l operateur).
          // Si Scratch (sortie), on clear tout.
          const isScratch = to_state_id === SCRATCH_STATE_ID
          const targetRow  = (typeof body.target_row  === 'number' && body.target_row  > 0) ? body.target_row  : null
          const targetSlot = (typeof body.target_slot === 'number' && body.target_slot > 0) ? body.target_slot : null
          await sb
            .from('incoming_missions')
            .update({
              parc_zone_key:   isScratch ? null : toCode,
              parc_row_number: isScratch ? null : targetRow,
              parc_slot_index: isScratch ? null : targetSlot,
              updated_at:      new Date().toISOString(),
            })
            .eq('id', mission.id)

          // Shift downstream sur l ancien emplacement pour combler le trou
          if (wasAt) {
            await shiftAfterRelease(sb, wasAt.zone, wasAt.row, wasAt.slot)
          }

          // Log mission_logs pour tracabilite
          await sb.from('mission_logs').insert({
            mission_id: mission.id,
            actor_id:   user.id,
            action:     'parc_transferred',
            notes:      `Transfert de parc via /v/${ticketId} : ${from_state_name || '?'} → ${toName}`,
            metadata:   {
              source:      'helpdesk_move',
              ticket_id:   ticketId,
              from_state_id,
              to_state_id,
              to_zone_code: toCode,
              was_at:      wasAt,
            },
          }).then(() => {}, () => {})
        }
      } catch (e: any) {
        console.error('[helpdesk/move] Sync VD Soft echec (non bloquant):', e.message)
      }

      // 5. Sync Towsoft (best-effort, async, ne bloque pas la response)
      const missionTowsoft = t.x_studio_mission_towsoft
      let towsoft: { triggered: boolean; reason?: string } = { triggered: false, reason: 'pas de mission Towsoft' }
      if (missionTowsoft) {
        towsoft = await triggerTowsoftParcChange({
          missionNumber: missionTowsoft,
          toStateId:     to_state_id,
        })
        if (towsoft.triggered) {
          console.log(`[helpdesk/move] Towsoft sync triggered for mission ${missionTowsoft} → ${to_state_id}`)
        } else {
          console.warn(`[helpdesk/move] Towsoft sync NOT triggered: ${towsoft.reason}`)
        }
      }

      return NextResponse.json({
        ok: true,
        from_state_id, from_state_name,
        to_state_id,   to_state_name: toName,
        towsoft,
      })
    } catch (e: any) {
      console.error('[helpdesk/:id/move]', e.message)
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  })
}
