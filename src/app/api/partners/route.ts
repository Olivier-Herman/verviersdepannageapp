import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY!

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
  if (data.error) throw new Error(`Odoo: ${JSON.stringify(data.error)}`)
  return data.result
}

function invertName(name: string): string {
  const parts = name.trim().split(' ')
  if (parts.length < 2) return name
  return [...parts.slice(1), parts[0]].join(' ')
}

// GET /api/partners?vat=BE0460759205
// GET /api/partners?phone=+32492...
// GET /api/partners?name=Herman Olivier
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const vat   = req.nextUrl.searchParams.get('vat')
  const phone = req.nextUrl.searchParams.get('phone')
  const name  = req.nextUrl.searchParams.get('name')

  try {
    let partner = null

    // 1. Par TVA
    if (vat) {
      const r = await rpc<any[]>('res.partner', 'search_read',
        [[['vat', '=', vat.toUpperCase()]]],
        { fields: ['id','name','vat','phone','email','street','zip','city','country_id'], limit: 1 })
      if (r.length > 0) partner = r[0]
    }

    // 2. Par téléphone
    if (!partner && phone) {
      const clean = phone.replace(/\s/g, '')
      const r = await rpc<any[]>('res.partner', 'search_read',
        [[['phone', 'like', clean]]],
        { fields: ['id','name','vat','phone','email','street','zip','city','country_id'], limit: 1 })
      if (r.length > 0) partner = r[0]
    }

    // 3. Par nom + inversé
    if (!partner && name) {
      const inverted = invertName(name)
      for (const n of [name, inverted]) {
        const r = await rpc<any[]>('res.partner', 'search_read',
          [[['name', 'ilike', n]]],
          { fields: ['id','name','vat','phone','email','street','zip','city','country_id'], limit: 1 })
        if (r.length > 0) { partner = r[0]; break }
      }
    }

    if (!partner) return NextResponse.json({ found: false })

    return NextResponse.json({
      found: true,
      partner: {
        id: partner.id,
        name: partner.name,
        vat: partner.vat || '',
        phone: partner.phone || '',
        email: partner.email || '',
        street: partner.street || '',
        zip: partner.zip || '',
        city: partner.city || '',
        countryCode: partner.country_id?.[1] || 'BE',
        address: [partner.street, partner.zip, partner.city].filter(Boolean).join(', '),
      }
    })
  } catch (err: any) {
    console.error('[Partners API]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
