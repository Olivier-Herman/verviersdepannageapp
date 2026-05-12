// src/app/api/fourriere/list/route.ts
//
// GET /api/fourriere/list[?zone=A]
// Liste les vehicules en fourriere (state_id ∈ FOURRIERE_STATE_IDS) via
// Odoo en lecture live. Filtre optionnel par code de zone.

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { FOURRIERE_STATE_IDS, FOURRIERE_ZONE_BY_ID, FOURRIERE_ZONES } from '@/lib/fourriere'

export const dynamic     = 'force-dynamic'
export const maxDuration = 15

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY!

async function odooCall<T = any>(model: string, method: string, args: any[] = [], kwargs: object = {}): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Date.now(),
      params: {
        service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs],
      },
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Odoo ${model}.${method}: ${JSON.stringify(data.error)}`)
  return data.result
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const zoneCode = (searchParams.get('zone') || '').trim().toUpperCase()

  // Filtre state_ids cible
  let stateIds = FOURRIERE_STATE_IDS
  if (zoneCode) {
    const zone = FOURRIERE_ZONES.find(z => z.code.toUpperCase() === zoneCode)
    if (zone) stateIds = [zone.state_id]
  }

  try {
    const vehicles = await odooCall<any[]>('fleet.vehicle', 'search_read', [
      [['state_id', 'in', stateIds]],
    ], {
      fields: ['id', 'license_plate', 'vin_sn', 'brand_id', 'model_id', 'state_id', 'write_date', 'driver_id'],
      limit:  1000,
      order:  'license_plate asc',
    })

    // Resolve model names (display_name peut etre bizarre)
    const modelIds = Array.from(new Set(
      (vehicles || []).map((v: any) => v.model_id?.[0]).filter((x: any) => typeof x === 'number')
    ))
    const modelMap = new Map<number, string>()
    if (modelIds.length > 0) {
      const models = await odooCall<any[]>('fleet.vehicle.model', 'read', [modelIds], { fields: ['id', 'name'] })
      for (const m of models) modelMap.set(m.id, m.name)
    }

    const enriched = (vehicles || []).map((v: any) => {
      const stateId = v.state_id?.[0]
      const zone = stateId ? FOURRIERE_ZONE_BY_ID[stateId] : null
      return {
        id:           v.id,
        plate:        v.license_plate || null,
        vin:          v.vin_sn || null,
        brand:        v.brand_id?.[1] || '',
        model:        v.model_id?.[0] ? (modelMap.get(v.model_id[0]) || v.model_id[1] || '') : '',
        driver:       v.driver_id?.[1] || null,
        state_id:     stateId || null,
        zone_code:    zone?.code || null,
        zone_label:   zone?.label || (v.state_id?.[1] || '—'),
        last_update:  v.write_date || null,
        odoo_url:     `${ODOO_URL}/web#id=${v.id}&model=fleet.vehicle&view_type=form`,
      }
    })

    return NextResponse.json({ vehicles: enriched, zones: FOURRIERE_ZONES })
  } catch (e: any) {
    console.error('[fourriere/list]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
