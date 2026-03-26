// src/app/api/odoo/fleet-stages/route.ts
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ODOO_URL = process.env.ODOO_URL!
  const ODOO_DB  = process.env.ODOO_DB!
  const ODOO_UID = parseInt(process.env.ODOO_UID!)
  const ODOO_KEY = process.env.ODOO_API_KEY!

  try {
    const res = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'call', id: 1,
        params: {
          model:  'fleet.vehicle.state',
          method: 'search_read',
          args:   [[]],
          kwargs: {
            fields:   ['id', 'name', 'sequence'],
            order:    'sequence asc',
            limit:    50,
            context:  { uid: ODOO_UID, lang: 'fr_BE' },
          },
        },
      }),
    })

    const data = await res.json()
    const stages = (data?.result || []).map((s: any) => ({
      id:   s.id,
      name: s.name,
    }))

    return NextResponse.json(stages)
  } catch (err: any) {
    console.error('[fleet-stages]', err.message)
    return NextResponse.json([], { status: 200 }) // retourner vide plutôt qu'erreur
  }
}
