// src/app/api/odoo/create-vehicle/route.ts

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
      params: {
        service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_KEY, model, method, args, kwargs]
      }
    })
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.data?.message || data.error.message)
  return data.result
}

async function findOrCreateBrand(name: string): Promise<number | false> {
  if (!name?.trim()) return false
  const existing = await odooCall('fleet.vehicle.model.brand', 'search_read',
    [[['name', 'ilike', name.trim()]]], { fields: ['id', 'name'], limit: 1 })
  if (existing?.length) return existing[0].id
  return await odooCall('fleet.vehicle.model.brand', 'create', [{ name: name.trim() }])
}

async function findOrCreateModel(modelName: string, brandId: number): Promise<number | false> {
  if (!modelName?.trim()) return false
  const existing = await odooCall('fleet.vehicle.model', 'search_read',
    [[['name', 'ilike', modelName.trim()], ['brand_id', '=', brandId]]],
    { fields: ['id', 'name'], limit: 1 })
  if (existing?.length) return existing[0].id
  return await odooCall('fleet.vehicle.model', 'create',
    [{ name: modelName.trim(), brand_id: brandId }])
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plate, vin, brand, model, fuel, gearbox, partner_id } = await req.json()

  if (!plate?.trim()) {
    return NextResponse.json({ error: 'Plaque requise' }, { status: 400 })
  }

  try {
    const vals: Record<string, any> = {
      license_plate: plate.trim().toUpperCase(),
      state_id:      false,
    }

    if (vin)        vals.vin_sn       = vin.trim()
    if (fuel)       vals.fuel_type    = fuel
    if (gearbox)    vals.transmission = gearbox
    if (partner_id) vals.partner_id   = partner_id

    // Trouver ou créer marque + modèle
    if (brand?.trim()) {
      const brandId = await findOrCreateBrand(brand)
      if (brandId) {
        vals.brand_id = brandId
        if (model?.trim()) {
          const modelId = await findOrCreateModel(model, brandId)
          if (modelId) vals.model_id = modelId
        }
      }
    }

    const vehicleId = await odooCall('fleet.vehicle', 'create', [vals])

    return NextResponse.json({ ok: true, vehicle_id: vehicleId, plate: plate.trim().toUpperCase() })
  } catch (err: any) {
    console.error('[Odoo create-vehicle]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
