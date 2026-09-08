// src/app/api/odoo/create-vehicle/route.ts

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { odooRpc, withOdooActor } from '@/lib/odoo'
import { resolveBrandId, resolveModelId, lookupBrandId, lookupModelId, isOtherName } from '@/lib/odoo-fleet'

// Résolution centralisée anti-doublon — cf. @/lib/odoo-fleet.
async function findOrCreateBrand(name: string): Promise<number | false> {
  if (!name?.trim()) return false
  return resolveBrandId(odooRpc, name)
}

async function findOrCreateModel(modelName: string, brandId: number): Promise<number | false> {
  if (!modelName?.trim()) return false
  return resolveModelId(odooRpc, brandId, modelName)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actorId = (session.user as any).id as string | undefined
  // Olivier 08/09/2026 : un chauffeur ne crée ni marque ni modèle — le catalogue
  // Odoo en lecture seule ; hors liste ou « Autre » → le bureau crée le véhicule.
  const su = session.user as any
  const rolesAll: string[] = [su.role, ...(Array.isArray(su.roles) ? su.roles : [])].filter(Boolean)
  const driverOnly = rolesAll.length > 0 && rolesAll.every(r => r === 'driver')

  const { plate, vin, brand, model, fuel, gearbox } = await req.json()
  if (driverOnly && (isOtherName(brand) || isOtherName(model))) {
    return NextResponse.json({ error: 'Marque ou modèle « Autre » : le bureau créera le véhicule.' }, { status: 400 })
  }

  if (!plate?.trim()) {
    return NextResponse.json({ error: 'Plaque requise' }, { status: 400 })
  }

  return withOdooActor(actorId, async () => {
    try {
      const vals: Record<string, any> = {
        license_plate: plate.trim().toUpperCase(),
        state_id:      false,
      }

      if (vin)        vals.vin_sn       = vin.trim()
      if (fuel)       vals.fuel_type    = fuel
      if (gearbox)    vals.transmission = gearbox
      // Olivier 2026-06-18 : fleet.vehicle n'a PAS de champ partner_id en Odoo 19
      // (le set provoquait "Invalid field 'partner_id'"). On ne le pousse plus.

      if (brand?.trim()) {
        const brandId = driverOnly ? await lookupBrandId(odooRpc, brand) : await findOrCreateBrand(brand)
        if (driverOnly && !brandId) return NextResponse.json({ error: `Marque « ${brand} » inconnue : choisir dans la liste ou « Autre ».` }, { status: 400 })
        if (brandId) {
          vals.brand_id = brandId
          if (model?.trim()) {
            const modelId = driverOnly ? await lookupModelId(odooRpc, brandId, model) : await findOrCreateModel(model, brandId)
            if (driverOnly && !modelId) return NextResponse.json({ error: `Modèle « ${model} » inconnu : choisir dans la liste ou « Autre ».` }, { status: 400 })
            if (modelId) vals.model_id = modelId
          }
        }
      }

      const vehicleId = await odooRpc<number>('fleet.vehicle', 'create', [vals])

      return NextResponse.json({ ok: true, vehicle_id: vehicleId, plate: plate.trim().toUpperCase() })
    } catch (err: any) {
      console.error('[Odoo create-vehicle]', err.message)
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
  })
}
