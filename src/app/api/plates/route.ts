import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY!
const FIELD_PLAQUE = 'x_studio_many2one_field_78n_1j6fmmeom'

async function rpc<T = any>(model: string, method: string, args: any[] = [], kwargs: object = {}): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Date.now(),
      params: { service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs] }
    })
  })
  const data = await res.json()
  if (data.error) throw new Error(`Odoo RPC: ${JSON.stringify(data.error)}`)
  return data.result
}

// Normaliser l'immatriculation : retirer -, ., espaces, majuscules
function normalizePlate(plate: string): string {
  return plate.replace(/[-.\s]/g, '').toUpperCase()
}

// GET /api/plates?plate=1ADK440
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const rawPlate = req.nextUrl.searchParams.get('plate')
  if (!rawPlate) return NextResponse.json({ error: 'Paramètre plate manquant' }, { status: 400 })

  const plate = normalizePlate(rawPlate)

  try {
    // 1. Chercher le véhicule dans Odoo par immat normalisée
    const vehicles = await rpc<any[]>('fleet.vehicle', 'search_read',
      [[['license_plate', '=', plate]]],
      { fields: ['id', 'license_plate', 'model_id', 'vin_sn'], limit: 1 }
    )

    if (vehicles.length === 0) {
      // Véhicule inconnu — pas de clients précédents
      return NextResponse.json({ found: false, plate, vehicle: null, previousClients: [] })
    }

    const vehicle = vehicles[0]
    const vehicleId = vehicle.id
    const modelInfo = vehicle.model_id // [id, "Peugeot/Autre"]

    // 2. Récupérer les clients précédents via les devis liés à ce véhicule
    const orders = await rpc<any[]>('sale.order', 'search_read',
      [[[FIELD_PLAQUE, '=', vehicleId]]],
      {
        fields: ['partner_id'],
        order: 'id desc',
        limit: 20
      }
    )

    // Dédupliquer les partenaires
    const partnerIds = [...new Set(
      orders.map(o => o.partner_id?.[0]).filter(Boolean)
    )]

    let previousClients: any[] = []
    if (partnerIds.length > 0) {
      const partners = await rpc<any[]>('res.partner', 'read',
        [partnerIds],
        { fields: ['id', 'name', 'phone', 'email', 'street', 'zip', 'city', 'country_id', 'vat'] }
      )
      // Trier par ordre d'apparition (plus récent en premier)
      previousClients = partnerIds
        .map(id => partners.find(p => p.id === id))
        .filter(Boolean)
        .map(p => ({
          id: p.id,
          name: p.name,
          phone: p.phone || '',
          email: p.email || '',
          address: [p.street, p.zip, p.city].filter(Boolean).join(', '),
          street: p.street || '',
          zip: p.zip || '',
          city: p.city || '',
          countryCode: p.country_id ? p.country_id[1] : 'BE',
          vat: p.vat || '',
        }))
    }

    // Parser le nom du modèle "Peugeot/Autre" → marque + modèle
    const modelName = typeof modelInfo === 'string' ? modelInfo : modelInfo?.[1] || ''
    const parts = modelName.split('/')
    const brandName = parts[0] || ''
    const modelLabel = parts[1] || ''

    return NextResponse.json({
      found: true,
      plate,
      vehicle: {
        id: vehicleId,
        licensePlate: vehicle.license_plate,
        brandName,
        modelName: modelLabel,
        displayName: modelName,
        vinSn: vehicle.vin_sn || '',
      },
      previousClients,
    })

  } catch (err: any) {
    console.error('[Plates API]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
