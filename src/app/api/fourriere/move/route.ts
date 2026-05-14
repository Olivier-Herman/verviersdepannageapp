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

      return NextResponse.json({
        ok: true,
        from_state_id, from_state_name,
        to_state_id, to_state_name: toName,
      })
    } catch (e: any) {
      console.error('[fourriere/move]', e.message)
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  })
}
