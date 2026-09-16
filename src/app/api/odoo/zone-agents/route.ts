// src/app/api/odoo/zone-agents/route.ts
//
// GET /api/odoo/zone-agents?company_id=<int>&q=<query>
//   sans company_id : toutes les zones de police actives (recherche/inventaire
//   fourrière — Olivier 16/09/2026) ; q d'au moins 2 caractères.
// Renvoie les CONTACTS (agents) d'une société Odoo (la zone de police).
// Utilisé pour l'autocomplete du nom d'agent côté chauffeur (PoliceClient).
// On ne crée jamais de contact : si rien ne matche, le chauffeur garde son texte.
//
// Olivier 2026-06-14.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

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

  // Périmètre : une zone (company_id) ou toutes les zones actives.
  let companyIds: number[] = []
  if (Number.isFinite(companyId) && companyId > 0) companyIds = [companyId]
  else {
    if (q.length < 2) return NextResponse.json({ agents: [] })
    const { data: zones } = await createAdminClient().from('police_zones').select('odoo_company_id').eq('active', true)
    companyIds = (zones || []).map(z => Number(z.odoo_company_id)).filter(n => Number.isFinite(n) && n > 0)
    if (!companyIds.length) return NextResponse.json({ agents: [] })
  }

  try {
    // Contacts rattachés à la société (et sous-départements) — hors sociétés.
    const domain: any[] = [
      ['id', 'child_of', companyIds],
      ['is_company', '=', false],
    ]
    if (q) domain.push(['name', 'ilike', q])

    const rows = await odooCall('res.partner', 'search_read', [domain], {
      fields: ['id', 'name', 'phone', 'function', 'parent_id'],
      limit:  20,
      order:  'name asc',
    })
    const agents = (rows || []).map((a: any) => ({ id: a.id, name: a.name, phone: a.phone || undefined, function: a.function || undefined, zone: Array.isArray(a.parent_id) ? a.parent_id[1] : undefined }))

    return NextResponse.json({ agents })
  } catch (err: any) {
    console.error('[Odoo zone-agents]', err.message)
    return NextResponse.json({ error: err.message, agents: [] }, { status: 500 })
  }
}
