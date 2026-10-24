// src/app/api/odoo/search-vehicle/route.ts
// Recherche un véhicule Odoo par plaque (exacte/partielle) ou VIN (exact/partiel)

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { odooSend } from '@/lib/odoo-transport'

const ODOO_URL = process.env.ODOO_URL!
const ODOO_DB  = process.env.ODOO_DB!
const ODOO_UID = parseInt(process.env.ODOO_UID || '8')
const ODOO_KEY = process.env.ODOO_API_KEY!

async function odooCall(model: string, method: string, args: any[], kwargs: any = {}) {
  // Transport commun (JSON-2 ou JSON-RPC, cf. @/lib/odoo-transport) — compte de service, sans contexte société.
  const data = await odooSend({ url: ODOO_URL, db: ODOO_DB, uid: ODOO_UID, apiKey: ODOO_KEY }, model, method, args, kwargs as Record<string, any>)
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

    // model_id[1] retourne le display_name de fleet.vehicle.model (souvent "Brand/Model")
    // qui ne match pas la liste déroulante (qui a les pures `name`). On lit explicitement
    // les modèles pour récupérer leur vrai `name`.
    const modelIds = Array.from(new Set(
      (vehicles || []).map((v: any) => v.model_id?.[0]).filter((x: any) => typeof x === 'number')
    ))
    const modelMap = new Map<number, string>()
    if (modelIds.length > 0) {
      const models = await odooCall('fleet.vehicle.model', 'read', [modelIds], { fields: ['id', 'name'] })
      for (const m of (models as any[])) modelMap.set(m.id, m.name)
    }

    // Normaliser les données
    const normalized = (vehicles || []).map((v: any) => ({
      id:           v.id,
      name:         v.name,
      plate:        v.license_plate,
      vin:          v.vin_sn,
      brand:        v.brand_id?.[1] || '',
      model:        v.model_id?.[0] ? (modelMap.get(v.model_id[0]) || v.model_id[1] || '') : '',
      partner_id:   null,
      partner_name: null,
      fuel:         '',     // carburant Odoo non fiable — cf. odoo-fuel.ts
      gearbox:      v.transmission || '',
      color:        v.color || '',
    }))

    return NextResponse.json({ vehicles: normalized })
  } catch (err: any) {
    console.error('[Odoo search-vehicle]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
