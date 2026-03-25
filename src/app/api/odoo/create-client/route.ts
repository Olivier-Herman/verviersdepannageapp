// src/app/api/odoo/create-client/route.ts

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

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, phone, mobile, street, city, zip, email } = await req.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Nom requis' }, { status: 400 })
  }

  try {
    const vals: Record<string, any> = {
      name:       name.trim(),
      is_company: false,
      customer_rank: 1,
    }
    if (phone)  vals.phone  = phone.trim()
    if (mobile) vals.mobile = mobile.trim()
    if (street) vals.street = street.trim()
    if (city)   vals.city   = city.trim()
    if (zip)    vals.zip    = zip.trim()
    if (email)  vals.email  = email.trim()

    const partnerId = await odooCall('res.partner', 'create', [vals])

    // Relire le partenaire créé pour retourner les infos complètes
    const [partner] = await odooCall('res.partner', 'read', [[partnerId]], {
      fields: ['id', 'name', 'phone', 'mobile', 'street', 'city', 'zip', 'email']
    })

    return NextResponse.json({ ok: true, partner })
  } catch (err: any) {
    console.error('[Odoo create-client]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
