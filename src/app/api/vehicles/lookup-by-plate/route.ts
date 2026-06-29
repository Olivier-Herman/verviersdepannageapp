// src/app/api/vehicles/lookup-by-plate/route.ts
//
// Route unifiée pour lookup véhicule Odoo par plaque exacte.
// Remplace progressivement /api/plates, /api/odoo/search-vehicle (multi-match)
// et /api/advances/lookup. Phase 1 = utilisée par /encaissement, /mission/police,
// /avance-fonds. Phase 2 = autres écrans (NewMission, MissionDetail, NewDriverMission).
//
// Spécificités :
// - Match exact (license_plate = X) sur plaque normalisée → support "même plaque,
//   propriétaires successifs" (multi-rows fleet.vehicle).
// - withPreviousClients optionnel : récupère les res.partner via les sale.order
//   liés (champ custom x_studio_many2one_field_78n_1j6fmmeom). Batch unique
//   pour éviter le N+1.
// - includeArchived optionnel : par défaut filter active=true, opt-in pour
//   l'historique complet.

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }                from '@/lib/auth'
import { normalizePlate }             from '@/lib/plate'
import type {
  VehicleMatch,
  Partner,
  LookupByPlateResponse,
} from '@/types/vehicles'

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY!

/** Champ custom Odoo sale.order pointant vers fleet.vehicle (m2o). */
const FIELD_PLAQUE = 'x_studio_many2one_field_78n_1j6fmmeom'

async function rpc<T = any>(
  model: string, method: string, args: any[] = [], kwargs: object = {}
): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method:  'POST',
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
  if (data.error) throw new Error(`Odoo RPC: ${JSON.stringify(data.error)}`)
  return data.result
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const rawPlate            = req.nextUrl.searchParams.get('plate')
  const withPreviousClients = req.nextUrl.searchParams.get('withPreviousClients') === '1'
  const includeArchived     = req.nextUrl.searchParams.get('includeArchived')     === '1'

  if (!rawPlate) {
    return NextResponse.json({ error: 'Paramètre plate manquant' }, { status: 400 })
  }

  const plate = normalizePlate(rawPlate)
  if (plate.length < 3) {
    return NextResponse.json({ found: false, plate, vehicles: [] } as LookupByPlateResponse)
  }

  try {
    const fields = [
      'id', 'license_plate', 'vin_sn',
      'model_id', 'fuel_type', 'transmission', 'color',
      'active', 'driver_id',
    ]
    const ctx = includeArchived ? { context: { active_test: false } } : {}

    const searchPlate = (dom: any[]) => rpc<any[]>('fleet.vehicle', 'search_read',
      [includeArchived ? [...dom, ['active', 'in', [true, false]]] : dom],
      { fields, limit: 50, order: 'id desc', ...ctx })

    // 1. Search EXACT côté Odoo.
    let rawVehicles = await searchPlate([['license_plate', '=', plate]])

    // 2. Olivier 2026-06-24 : repli TOLÉRANT aux séparateurs. Odoo peut stocker
    //    "1-ABC-234" alors que la recherche est normalisée "1ABC234" → le "="
    //    échouait. On cherche en ilike (chars dans l'ordre) puis on filtre sur
    //    l'égalité normalisée pour écarter les faux positifs.
    if (rawVehicles.length === 0 && plate.length >= 4) {
      const likePattern = '%' + plate.split('').join('%') + '%'
      const cand = await searchPlate([['license_plate', 'ilike', likePattern]])
      rawVehicles = (cand || []).filter(v => normalizePlate(v.license_plate || '') === plate)
    }

    if (rawVehicles.length === 0) {
      return NextResponse.json({ found: false, plate, vehicles: [] } as LookupByPlateResponse)
    }

    // 2. Résoudre les fleet.vehicle.model pour avoir le vrai name + brand
    //    (model_id[1] retourne le display_name "Brand/Model" qui ne match
    //    pas la dropdown brands/models).
    const modelIds = Array.from(new Set(
      rawVehicles
        .map(v => v.model_id?.[0])
        .filter((id): id is number => typeof id === 'number')
    ))

    type FleetModel = { id: number; name: string; brand_id: [number, string] | false }
    const modelsArr = modelIds.length > 0
      ? await rpc<FleetModel[]>('fleet.vehicle.model', 'read', [modelIds],
          { fields: ['id', 'name', 'brand_id'] })
      : []
    const modelsById = new Map<number, FleetModel>()
    for (const m of modelsArr) modelsById.set(m.id, m)

    // 3. Optionnel : previousClients via sale.order (batch unique pour éviter N+1)
    let clientsByVehicleId: Map<number, Partner[]> = new Map()
    if (withPreviousClients) {
      const vehicleIds = rawVehicles.map(v => v.id as number)

      // 3a. Récupérer toutes les sale.order liées (limit 20 par véhicule pour
      //     ne pas exploser la requête, dedup partner_id ensuite).
      type SaleOrder = { id: number; partner_id: [number, string] | false; [k: string]: any }
      const orders = await rpc<SaleOrder[]>('sale.order', 'search_read',
        [[[FIELD_PLAQUE, 'in', vehicleIds]]],
        { fields: ['id', 'partner_id', FIELD_PLAQUE], order: 'id desc', limit: 200 }
      )

      // 3b. Dedup partner_ids globaux pour 1 seule requête res.partner
      const allPartnerIds = Array.from(new Set(
        orders
          .map(o => Array.isArray(o.partner_id) ? o.partner_id[0] : null)
          .filter((id): id is number => typeof id === 'number')
      ))

      type ResPartner = {
        id: number; name: string; phone: string | false; email: string | false;
        street: string | false; zip: string | false; city: string | false;
        country_id: [number, string] | false; vat: string | false;
      }
      const partnersArr: ResPartner[] = allPartnerIds.length > 0
        ? await rpc<ResPartner[]>('res.partner', 'read', [allPartnerIds],
            { fields: ['id', 'name', 'phone', 'email', 'street', 'zip', 'city', 'country_id', 'vat'] })
        : []
      const partnersById = new Map<number, ResPartner>()
      for (const p of partnersArr) partnersById.set(p.id, p)

      // 3c. Grouper par vehicleId, conserver l'ordre orders id desc (= plus récent d'abord)
      for (const vehicleId of vehicleIds) {
        const ordersForVehicle = orders.filter(o => {
          const linked = o[FIELD_PLAQUE] as [number, string] | false | undefined
          return Array.isArray(linked) && linked[0] === vehicleId
        })
        const seen = new Set<number>()
        const partners: Partner[] = []
        for (const o of ordersForVehicle) {
          const pid = Array.isArray(o.partner_id) ? o.partner_id[0] : null
          if (typeof pid !== 'number' || seen.has(pid)) continue
          seen.add(pid)
          const p = partnersById.get(pid)
          if (!p) continue
          partners.push({
            id:          p.id,
            name:        p.name,
            phone:       p.phone || '',
            email:       p.email || '',
            address:     [p.street, p.zip, p.city].filter(Boolean).join(', '),
            street:      p.street  || '',
            zip:         p.zip     || '',
            city:        p.city    || '',
            countryCode: p.country_id ? p.country_id[1] : 'BE',
            vat:         p.vat || '',
          })
        }
        clientsByVehicleId.set(vehicleId, partners)
      }
    }

    // 4. Composer le résultat final
    const vehicles: VehicleMatch[] = rawVehicles.map(v => {
      const modelId   = v.model_id?.[0] as number | undefined
      const modelInfo = typeof modelId === 'number' ? modelsById.get(modelId) : undefined

      const brand = modelInfo?.brand_id ? modelInfo.brand_id[1] : (v.model_id?.[1]?.split('/')[0] || '')
      const model = modelInfo?.name     ?? (v.model_id?.[1]?.split('/').slice(1).join('/') || '')

      const driver = v.driver_id && Array.isArray(v.driver_id)
        ? { id: v.driver_id[0], name: v.driver_id[1] }
        : null

      const match: VehicleMatch = {
        id:            v.id,
        plate:         v.license_plate,
        brand,
        model,
        vin:           v.vin_sn || null,
        fuel:          v.fuel_type || null,
        gearbox:       v.transmission || null,
        color:         v.color || null,
        archived:      v.active === false,
        currentDriver: driver,
      }

      if (withPreviousClients) {
        match.previousClients = clientsByVehicleId.get(v.id) || []
      }

      return match
    })

    return NextResponse.json({
      found: true,
      plate,
      vehicles,
    } as LookupByPlateResponse)

  } catch (err: any) {
    console.error('[lookup-by-plate]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
