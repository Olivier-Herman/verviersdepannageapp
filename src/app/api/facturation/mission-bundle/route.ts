// src/app/api/facturation/mission-bundle/route.ts
//
// GET ?id=<uuid> → tout ce dont FacturerModal a besoin pour UNE mission :
// { mission, siblings (chaîne REM+REL), payments, drivers }. Permet d'ouvrir le
// modal de facturation directement depuis la fiche. Olivier 2026-06-30.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const COLS = `
  id, mission_number, external_id, dossier_number, source, status,
  mission_type, incident_type, parent_mission_id,
  client_name, client_phone,
  vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
  incident_address, destination_address,
  received_at, intervention_date, completed_at,
  amount_to_collect, amount_collected, payment_method,
  special_tarif_htva, assigned_to,
  invoice_method, invoice_number, invoice_url,
  no_charge_at, no_charge_reason,
  odoo_quote_id, odoo_quote_url, odoo_quoted_at,
  billed_to_id, billed_to_name
`

function canAccess(session: any): boolean {
  if (!session) return false
  const role = (session.user as any)?.role || ''
  const modules: string[] = (session.user as any)?.modules || []
  return ['admin', 'superadmin', 'dispatcher'].includes(role)
    || modules.includes('facturation') || modules.includes('fourriere')
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = (new URL(req.url).searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data: mission, error } = await sb.from('incoming_missions').select(COLS).eq('id', id).maybeSingle()
  if (error)   return NextResponse.json({ error: error.message }, { status: 500 })
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Chaîne REM+REL : parent + enfants.
  const sibFilters: string[] = []
  if ((mission as any).parent_mission_id) sibFilters.push(`id.eq.${(mission as any).parent_mission_id}`)
  sibFilters.push(`parent_mission_id.eq.${id}`)
  const { data: siblings } = await sb.from('incoming_missions').select(COLS).or(sibFilters.join(','))

  const all = [mission, ...(siblings || [])]
  const allIds = all.map((m: any) => m.id)

  const { data: payments } = await sb.from('interventions')
    .select('id, mission_id, amount, payment_mode, client_name, created_at, driver_id')
    .in('mission_id', allIds)

  const driverIds = [...new Set([
    ...(all.map((m: any) => m.assigned_to)),
    ...((payments || []).map((p: any) => p.driver_id)),
  ].filter(Boolean))] as string[]
  const { data: drivers } = driverIds.length > 0
    ? await sb.from('users').select('id, name').in('id', driverIds)
    : { data: [] }

  return NextResponse.json({
    mission,
    siblings: siblings || [],
    payments: payments || [],
    drivers:  drivers || [],
  })
}
