// src/app/api/fourriere/move/route.ts
//
// POST /api/fourriere/move
// Body : { odoo_vehicle_id: number, to_state_id: number, notes?: string }
//
// Met a jour fleet.vehicle.state_id dans Odoo + log dans fourriere_movements.
// Le from_state est lu en amont pour audit. Pas de sync Towsoft pour
// l'instant (Verviers-QR continue son role pendant la transition).

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { createAdminClient }       from '@/lib/supabase'
import { FOURRIERE_ZONE_BY_ID, SCRATCH_STATE_ID } from '@/lib/fourriere'

export const dynamic = 'force-dynamic'

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY!

async function odooCall<T = any>(model: string, method: string, args: any[] = [], kwargs: object = {}): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Date.now(),
      params: {
        service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs],
      },
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Odoo ${model}.${method}: ${JSON.stringify(data.error)}`)
  return data.result
}

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

  // Sanity check : la destination doit etre une zone fourriere connue
  // OU le state Scratch (utilise pour "sortir" un vehicule definitivement)
  if (!FOURRIERE_ZONE_BY_ID[to_state_id] && to_state_id !== SCRATCH_STATE_ID) {
    return NextResponse.json({
      error: `state_id ${to_state_id} n'est pas une zone fourrière connue`,
    }, { status: 400 })
  }

  try {
    // 1) Lire l'etat actuel pour audit
    const current = await odooCall<any[]>('fleet.vehicle', 'read', [
      [odoo_vehicle_id], ['id', 'license_plate', 'vin_sn', 'brand_id', 'model_id', 'state_id'],
    ])
    if (!current || current.length === 0) {
      return NextResponse.json({ error: 'Véhicule introuvable dans Odoo' }, { status: 404 })
    }
    const v = current[0]
    const from_state_id   = v.state_id?.[0] || null
    const from_state_name = v.state_id?.[1] || null

    // Court-circuit si deja dans la zone cible
    if (from_state_id === to_state_id) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: 'Véhicule déjà dans cette zone',
      })
    }

    // 2) Update Odoo
    await odooCall('fleet.vehicle', 'write', [[odoo_vehicle_id], { state_id: to_state_id }])

    // 3) Log audit Supabase
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
}
