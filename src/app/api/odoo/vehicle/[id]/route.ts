// src/app/api/odoo/vehicle/[id]/route.ts
//
// GET /api/odoo/vehicle/[id] → fiche vehicule enrichie pour <VehicleSheet>
// Recupere les champs utiles directement depuis Odoo (fleet.vehicle + tables liees).
// Les writes restent geres par "Ouvrir dans Odoo" (Phase A). Phase B utilisera
// la cle API du user pour les writes in-app.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { odooRpc }           from '@/lib/odoo'
import { FOURRIERE_ZONE_BY_ID } from '@/lib/fourriere'

export const dynamic     = 'force-dynamic'
export const maxDuration = 20

const ODOO_URL = process.env.ODOO_URL || ''

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const vehicleId = parseInt(params.id, 10)
  if (!vehicleId || Number.isNaN(vehicleId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 })
  }

  try {
    // 1) Vehicule (champs principaux). On utilise fields_get pour ne demander
    // que les champs qui existent reellement (les colonnes Odoo varient selon
    // les modules installes et les versions).
    const allFields = await odooRpc<Record<string, any>>('fleet.vehicle', 'fields_get', [], { attributes: ['type'] })
    const wanted = [
      'id', 'name', 'license_plate', 'vin_sn', 'model_id', 'brand_id',
      'color', 'fuel_type', 'transmission', 'tag_ids',
      'driver_id', 'state_id', 'company_id',
      'model_year', 'acquisition_date',
      'odometer', 'odometer_unit', 'next_assignation_date',
      'image_128',
    ]
    const safeFields = wanted.filter(f => f === 'id' || allFields[f])

    const vehicles = await odooRpc<any[]>('fleet.vehicle', 'read', [[vehicleId]], { fields: safeFields })
    const v = vehicles[0]
    if (!v) return NextResponse.json({ error: 'Vehicule introuvable' }, { status: 404 })

    // 2) Modele (vrai nom, pas display_name)
    let modelName: string | null = null
    if (v.model_id?.[0]) {
      const models = await odooRpc<any[]>('fleet.vehicle.model', 'read', [[v.model_id[0]]], { fields: ['name'] })
      modelName = models[0]?.name || v.model_id[1] || null
    }

    // 3) Historique conducteurs (5 derniers)
    let driverHistory: any[] = []
    try {
      driverHistory = await odooRpc<any[]>('fleet.vehicle.assignation.log', 'search_read', [
        [['vehicle_id', '=', vehicleId]],
      ], {
        fields: ['id', 'driver_id', 'date_start', 'date_end'],
        limit:  5,
        order:  'date_start desc',
      })
    } catch (e: any) {
      // Modele peut ne pas exister selon version Odoo — silencieux
      console.warn('[vehicle] driver history n/a:', e.message)
    }

    // 4) Factures liees via x_studio_plaque_1 (10 dernieres)
    let invoices: any[] = []
    try {
      invoices = await odooRpc<any[]>('account.move', 'search_read', [
        [
          '&', '&',
          ['state', '!=', 'cancel'],
          ['move_type', 'in', ['out_invoice', 'out_refund']],
          ['x_studio_plaque_1', '=', vehicleId],
        ],
      ], {
        fields: ['id', 'name', 'partner_id', 'amount_total', 'amount_residual', 'invoice_date', 'invoice_date_due', 'state', 'move_type', 'payment_state'],
        limit:  10,
        order:  'invoice_date desc',
      })
    } catch (e: any) {
      console.warn('[vehicle] invoices n/a:', e.message)
    }

    // 5) Contrats (5 derniers)
    let contracts: any[] = []
    try {
      contracts = await odooRpc<any[]>('fleet.vehicle.log.contract', 'search_read', [
        [['vehicle_id', '=', vehicleId]],
      ], {
        fields: ['id', 'name', 'start_date', 'expiration_date', 'state', 'cost_amount'],
        limit:  5,
        order:  'start_date desc',
      })
    } catch (e: any) {
      console.warn('[vehicle] contracts n/a:', e.message)
    }

    // 6) Services (5 derniers — entretiens/reparations)
    let services: any[] = []
    try {
      services = await odooRpc<any[]>('fleet.vehicle.log.services', 'search_read', [
        [['vehicle_id', '=', vehicleId]],
      ], {
        fields: ['id', 'description', 'date', 'amount', 'service_type_id', 'state'],
        limit:  5,
        order:  'date desc',
      })
    } catch (e: any) {
      // Modele renomme en 'fleet.vehicle.log.services' selon version. Silencieux.
      console.warn('[vehicle] services n/a:', e.message)
    }

    const stateId = v.state_id?.[0]
    const fourriereZone = stateId ? FOURRIERE_ZONE_BY_ID[stateId] : null

    return NextResponse.json({
      vehicle: {
        id:             v.id,
        plate:          v.license_plate || null,
        vin:            v.vin_sn || null,
        brand:          v.brand_id?.[1] || null,
        model:          modelName,
        color:          v.color || null,
        fuel:           v.fuel_type || null,
        gearbox:        v.transmission || null,
        modelYear:      v.model_year || null,
        acquisitionDate: v.acquisition_date || null,
        odometer:       v.odometer || null,
        odometerUnit:   v.odometer_unit || 'kilometers',
        nextAssignation: v.next_assignation_date || null,
        currentDriver:  v.driver_id ? { id: v.driver_id[0], name: v.driver_id[1] } : null,
        state:          v.state_id ? { id: v.state_id[0], name: v.state_id[1] } : null,
        fourriereZone:  fourriereZone ? {
          label:     fourriereZone.label,
          fullName:  fourriereZone.full_name,
        } : null,
        image128:       v.image_128 ? `data:image/png;base64,${v.image_128}` : null,
        odooUrl:        `${ODOO_URL}/web#id=${v.id}&model=fleet.vehicle&view_type=form`,
      },
      driverHistory: driverHistory.map(h => ({
        id:        h.id,
        driver:    h.driver_id ? { id: h.driver_id[0], name: h.driver_id[1] } : null,
        dateStart: h.date_start || null,
        dateEnd:   h.date_end   || null,
      })),
      invoices: invoices.map(inv => ({
        id:            inv.id,
        number:        inv.name || null,
        partnerName:   inv.partner_id?.[1] || null,
        amountTotal:   inv.amount_total || 0,
        amountResidual: inv.amount_residual || 0,
        invoiceDate:   inv.invoice_date || null,
        invoiceDateDue: inv.invoice_date_due || null,
        state:         inv.state,
        moveType:      inv.move_type,
        paymentState:  inv.payment_state,
      })),
      contracts: contracts.map(c => ({
        id:         c.id,
        name:       c.name || null,
        startDate:  c.start_date || null,
        expiryDate: c.expiration_date || null,
        state:      c.state || null,
        amount:     c.cost_amount || 0,
      })),
      services: services.map(s => ({
        id:          s.id,
        description: s.description || null,
        date:        s.date || null,
        amount:      s.amount || 0,
        type:        s.service_type_id?.[1] || null,
        state:       s.state || null,
      })),
    })
  } catch (e: any) {
    console.error('[api/odoo/vehicle]', e.message)
    return NextResponse.json({ error: e.message || 'Erreur Odoo' }, { status: 502 })
  }
}
