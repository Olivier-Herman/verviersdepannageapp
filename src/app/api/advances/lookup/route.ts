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
    const results = await odooCall<any[]>('fleet.vehicle', 'search_read',
      [[['license_plate', 'ilike', normalized]]],
      { fields: ['id', 'license_plate', 'model_id'], limit: 10 }
    )

    const match = results.find(v => normalizePlate(v.license_plate) === normalized)

    if (match) {
      return NextResponse.json({
        found: true,
        id:    match.id,
        plate: match.license_plate,
        model: match.model_id ? match.model_id[1] : null,
      })
    }

    return NextResponse.json({ found: false })

  } catch (err) {
    console.error('[GET /api/advances/lookup]', err)
    return NextResponse.json({ error: 'Erreur recherche véhicule' }, { status: 500 })
  }
}
