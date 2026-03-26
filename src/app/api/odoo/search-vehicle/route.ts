// src/app/api/odoo/search-vehicle/route.ts
// Recherche un véhicule Odoo par plaque (exacte/partielle) ou VIN (exact/partiel)

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

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim().toUpperCase() || ''

  if (q.length < 3) return NextResponse.json({ vehicles: [] })

  try {
    const domain = [
      '|',
      ['license_plate', 'ilike', q],
      ['vin_sn',        'ilike', q],
    ]

    const vehicles = await odooCall('fleet.vehicle', 'search_read', [domain], {
      fields: [
        'id', 'name', 'license_plate', 'vin_sn',
        'model_id', 'brand_id',
        'fuel_type', 'transmission', 'color',
      ],
      limit: 10,
      order: 'license_plate asc',
    })

    // Normaliser les données
    const normalized = (vehicles || []).map((v: any) => ({
      id:           v.id,
      name:         v.name,
      plate:        v.license_plate,
      vin:          v.vin_sn,
      brand:        v.brand_id?.[1] || '',
      model:        v.model_id?.[1] || '',
      partner_id:   null,
      partner_name: null,
      fuel:         v.fuel_type || '',
      gearbox:      v.transmission || '',
      color:        v.color || '',
    }))

    return NextResponse.json({ vehicles: normalized })
  } catch (err: any) {
    console.error('[Odoo search-vehicle]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
