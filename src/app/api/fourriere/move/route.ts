// src/app/api/fourriere/move/route.ts
//
// POST /api/fourriere/move
// Body : { odoo_vehicle_id: number, to_state_id: number, notes?: string }
//
// Met a jour fleet.vehicle.state_id dans Odoo + log dans fourriere_movements.
// Le from_state est lu en amont pour audit.

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { createAdminClient }       from '@/lib/supabase'
import { odooRpc, withOdooActor }  from '@/lib/odoo'
import { FOURRIERE_ZONE_BY_ID, SCRATCH_STATE_ID } from '@/lib/fourriere'
import { triggerTowsoftParcChange } from '@/lib/towsoft-sync'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as {
    odoo_vehicle_id?: number
    to_state_id?:     number
    notes?:           string
  }
  const odoo_vehicle_id = Number(body.odoo_vehicle_id)
  const to_state_id     = Number(body.to_state_id)
  if (!odoo_vehicle_id || !to_state_id) {
    return NextResponse.json({ error: 'odoo_vehicle_id et to_state_id requis' }, { status: 400 })
  }

  if (!FOURRIERE_ZONE_BY_ID[to_state_id] && to_state_id !== SCRATCH_STATE_ID) {
    return NextResponse.json({
      error: `state_id ${to_state_id} n'est pas une zone fourrière connue`,
    }, { status: 400 })
  }

  return withOdooActor(user.id as string | undefined, async () => {
    try {
      const current = await odooRpc<any[]>('fleet.vehicle', 'read', [
        [odoo_vehicle_id], ['id', 'license_plate', 'vin_sn', 'brand_id', 'model_id', 'state_id'],
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

      await odooRpc('fleet.vehicle', 'write', [[odoo_vehicle_id], { state_id: to_state_id }])

      const toZone = FOURRIERE_ZONE_BY_ID[to_state_id]
      const toName = toZone?.full_name || (to_state_id === SCRATCH_STATE_ID ? 'Scratch' : `state_${to_state_id}`)

      const sb = createAdminClient()
      await sb.from('fourriere_movements').insert({
        odoo_vehicle_id,
        vehicle_plate: v.license_plate || null,
        vehicle_brand: v.brand_id?.[1] || null,
        vehicle_model: v.model_id?.[1] || null,
        from_state_id,
        from_state_name,
        to_state_id,
        to_state_name: toName,
        moved_by:      user.id,
        notes:         body.notes || null,
      })

      // Sync Towsoft : on retrouve le helpdesk.ticket le plus recent lie a ce
      // vehicule pour extraire le n° mission Towsoft, puis on declenche le
      // workflow GitHub Action (best-effort).
      let towsoft: { triggered: boolean; reason?: string } = { triggered: false, reason: 'pas de helpdesk ticket lie' }
      try {
        const tickets = await odooRpc<any[]>('helpdesk.ticket', 'search_read', [
          [['x_studio_fiche_vehicule', '=', odoo_vehicle_id]],
        ], {
          fields: ['id', 'x_studio_mission_towsoft', 'create_date'],
          order:  'create_date desc',
          limit:  1,
        })
        const missionTowsoft = tickets?.[0]?.x_studio_mission_towsoft
        if (missionTowsoft) {
          towsoft = await triggerTowsoftParcChange({
            missionNumber: missionTowsoft,
            toStateId:     to_state_id,
          })
          if (towsoft.triggered) {
            console.log(`[fourriere/move] Towsoft sync triggered for mission ${missionTowsoft} → ${to_state_id}`)
          } else {
            console.warn(`[fourriere/move] Towsoft sync NOT triggered: ${towsoft.reason}`)
          }
        }
      } catch (e: any) {
        console.warn('[fourriere/move] Towsoft lookup fail (non bloquant):', e.message)
        towsoft = { triggered: false, reason: e?.message || 'lookup fail' }
      }

      return NextResponse.json({
        ok: true,
        from_state_id, from_state_name,
        to_state_id, to_state_name: toName,
        towsoft,
      })
    } catch (e: any) {
      console.error('[fourriere/move]', e.message)
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  })
}
