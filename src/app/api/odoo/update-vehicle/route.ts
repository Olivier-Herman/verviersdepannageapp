// src/app/api/odoo/update-vehicle/route.ts
//
// Complète les champs absents (VIN, fuel, transmission) sur un véhicule Odoo
// existant — sans jamais écraser une valeur déjà saisie côté Odoo.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { odooRpc, withOdooActor } from '@/lib/odoo'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actorId = (session.user as any).id as string | undefined

  const { vehicle_id, vin, fuel, gearbox } = await req.json()
  if (!vehicle_id) return NextResponse.json({ error: 'vehicle_id requis' }, { status: 400 })

  return withOdooActor(actorId, async () => {
    try {
      const [current] = await odooRpc<any[]>('fleet.vehicle', 'read', [[vehicle_id]],
        { fields: ['id', 'vin_sn', 'fuel_type', 'transmission'] })
      if (!current) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })

      const updates: Record<string, any> = {}
      if (vin?.trim()    && !current.vin_sn)       updates.vin_sn       = vin.trim()
      if (fuel?.trim()   && !current.fuel_type)    updates.fuel_type    = fuel
      if (gearbox?.trim() && !current.transmission) updates.transmission = gearbox

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ ok: true, updated: [], message: 'Rien à mettre à jour' })
      }

      await odooRpc('fleet.vehicle', 'write', [[vehicle_id], updates])
      return NextResponse.json({ ok: true, updated: Object.keys(updates) })
    } catch (err: any) {
      console.error('[Odoo update-vehicle]', err.message)
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
  })
}
