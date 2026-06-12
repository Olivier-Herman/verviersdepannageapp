// src/app/api/facturation/mission/route.ts
//
// GET /api/facturation/mission?id=<uuid>
//
// Olivier 2026-06-12 : charge une mission VD Soft complete (forme attendue par
// la FacturerModal) pour facturer une fiche trouvee via la recherche unifiee
// (VD Soft ou TowSoft importee), sans dependre de la liste to_invoice initiale.
//
// Acces : admin / superadmin / module facturation.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function checkAccess(session: any): boolean {
  if (!session) return false
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  return ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!checkAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = (searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('incoming_missions')
    .select(`
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
      odoo_quote_id, odoo_quote_url,
      billed_to_id, billed_to_name
    `)
    .eq('id', id)
    .maybeSingle()

  if (error)  return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  return NextResponse.json({ mission: data })
}
