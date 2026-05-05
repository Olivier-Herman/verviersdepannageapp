// src/app/api/odoo/update-vehicle/route.ts
//
// Complète les champs absents (VIN, fuel, transmission) sur un véhicule Odoo
// existant — sans jamais écraser une valeur déjà saisie côté Odoo.
// Utile après que le dispatcher a lié un véhicule existant et que le formulaire
// contient un VIN/carburant/boîte qui manque dans Odoo.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'

const ODOO_URL = process.env.ODOO_URL!
const ODOO_DB  = process.env.ODOO_DB!
const ODOO_UID = parseInt(process.env.ODOO_UID || '8')
const ODOO_KEY = process.env.ODOO_API_KEY!

async function odooCall(model: string, method: string, args: any[], kwargs: any = {}) {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: 1,
      params: { service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_KEY, model, method, args, kwargs] }
    })
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.data?.message || data.error.message)
  return data.result
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { vehicle_id, vin, fuel, gearbox } = await req.json()
  if (!vehicle_id) return NextResponse.json({ error: 'vehicle_id requis' }, { status: 400 })

  try {
    const [current] = await odooCall('fleet.vehicle', 'read', [[vehicle_id]],
      { fields: ['id', 'vin_sn', 'fuel_type', 'transmission'] })
    if (!current) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })

    const updates: Record<string, any> = {}
    if (vin?.trim()    && !current.vin_sn)       updates.vin_sn       = vin.trim()
    if (fuel?.trim()   && !current.fuel_type)    updates.fuel_type    = fuel
    if (gearbox?.trim() && !current.transmission) updates.transmission = gearbox

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true, updated: [], message: 'Rien à mettre à jour' })
    }

    await odooCall('fleet.vehicle', 'write', [[vehicle_id], updates])
    return NextResponse.json({ ok: true, updated: Object.keys(updates) })
  } catch (err: any) {
    console.error('[Odoo update-vehicle]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
