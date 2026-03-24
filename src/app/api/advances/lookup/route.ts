// src/app/api/advances/lookup/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY!

function normalizePlate(plate: string): string {
  return plate.replace(/[-.\s]/g, '').toUpperCase().trim()
}

async function odooCall<T = any>(
  model: string, method: string, args: any[] = [], kwargs: object = {}
): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Date.now(),
      params: {
        service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs]
      }
    })
  })
  const data = await res.json()
  if (data.error) throw new Error(`Odoo: ${JSON.stringify(data.error)}`)
  return data.result
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const plate = req.nextUrl.searchParams.get('plate')
  if (!plate) return NextResponse.json({ error: 'Plaque manquante' }, { status: 400 })

  const normalized = normalizePlate(plate)

  try {
    // Récupérer le véhicule avec model_id
    const results = await odooCall<any[]>('fleet.vehicle', 'search_read',
      [[['license_plate', 'ilike', normalized]]],
      { fields: ['id', 'license_plate', 'model_id'], limit: 10 }
    )

    const match = results.find(v => normalizePlate(v.license_plate) === normalized)

    if (!match) return NextResponse.json({ found: false })

    // model_id[1] = "Peugeot/Série 5" — séparer marque et modèle
    let brand_text = ''
    let model_text = ''

    if (match.model_id && match.model_id[1]) {
      const fullModel = match.model_id[1] as string
      const slashIdx  = fullModel.indexOf('/')
      if (slashIdx > -1) {
        brand_text = fullModel.substring(0, slashIdx).trim()
        model_text = fullModel.substring(slashIdx + 1).trim()
      } else {
        // Pas de slash — tout dans model_text
        model_text = fullModel.trim()
      }
    }

    // Si modèle "Autre", récupérer la marque directement depuis fleet.vehicle.model
    if (model_text === 'Autre' && match.model_id) {
      try {
        const modelDetails = await odooCall<any[]>('fleet.vehicle.model', 'search_read',
          [[['id', '=', match.model_id[0]]]],
          { fields: ['id', 'name', 'brand_id'], limit: 1 }
        )
        if (modelDetails[0]?.brand_id?.[1]) {
          brand_text = modelDetails[0].brand_id[1]
          model_text = modelDetails[0].name !== 'Autre' ? modelDetails[0].name : 'Autre'
        }
      } catch { /* fallback déjà défini */ }
    }

    return NextResponse.json({
      found:      true,
      id:         match.id,
      plate:      match.license_plate,
      model:      match.model_id ? match.model_id[1] : null,
      brand_text: brand_text || null,
      model_text: model_text || null,
    })

  } catch (err) {
    console.error('[GET /api/advances/lookup]', err)
    return NextResponse.json({ error: 'Erreur recherche véhicule' }, { status: 500 })
  }
}
