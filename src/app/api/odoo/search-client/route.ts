// src/app/api/odoo/search-client/route.ts
// Recherche un partenaire Odoo par nom ou téléphone

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
  const q = searchParams.get('q')?.trim() || ''

  if (q.length < 3) return NextResponse.json({ clients: [] })

  try {
    // Recherche par nom OU téléphone OU mobile
    const domain = [
      '|', '|',
      ['name',  'ilike', q],
      ['phone', 'ilike', q],
      ['ref',   'ilike', q],
    ]

    const clients = await odooCall('res.partner', 'search_read', [domain], {
      fields:  ['id', 'name', 'phone', 'street', 'city', 'zip', 'email', 'vat', 'ref'],
      limit:   10,
      order:   'name asc',
    })

    return NextResponse.json({ clients: clients || [] })
  } catch (err: any) {
    console.error('[Odoo search-client]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
