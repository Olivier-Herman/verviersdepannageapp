// src/app/api/odoo/zone-agents/route.ts
//
// GET /api/odoo/zone-agents?company_id=<int>&q=<query>
// Renvoie les CONTACTS (agents) d'une société Odoo (la zone de police).
// Utilisé pour l'autocomplete du nom d'agent côté chauffeur (PoliceClient).
// On ne crée jamais de contact : si rien ne matche, le chauffeur garde son texte.
//
// Olivier 2026-06-14.

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
      params: { service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_KEY, model, method, args, kwargs] },
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.data?.message || data.error.message)
  return data.result
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const companyId = parseInt(searchParams.get('company_id') || '', 10)
  const q = searchParams.get('q')?.trim() || ''

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return NextResponse.json({ agents: [] })
  }

  try {
    // Contacts rattachés à la société (et sous-départements) — hors sociétés.
    const domain: any[] = [
      ['id', 'child_of', companyId],
      ['is_company', '=', false],
    ]
    if (q) domain.push(['name', 'ilike', q])

    const agents = await odooCall('res.partner', 'search_read', [domain], {
      fields: ['id', 'name', 'phone', 'function'],
      limit:  20,
      order:  'name asc',
    })

    return NextResponse.json({ agents: agents || [] })
  } catch (err: any) {
    console.error('[Odoo zone-agents]', err.message)
    return NextResponse.json({ error: err.message, agents: [] }, { status: 500 })
  }
}
