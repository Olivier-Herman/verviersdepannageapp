// src/app/api/admin/towsoft-migration/transit-pending/route.ts
//
// GET /api/admin/towsoft-migration/transit-pending
// Liste des missions en zone Transit avec migration_pending=true.
// Permet la UI "Nettoyage Transit" en fin de migration.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()

  const { data, error } = await sb
    .from('incoming_missions')
    .select(`
      id, mission_number, external_id,
      vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model,
      client_name, source, status,
      parc_zone_key, parked_at,
      odoo_vehicle_id, odoo_helpdesk_id,
      migration_pending, migration_pending_reason,
      created_at, updated_at
    `)
    .eq('parc_zone_key', 'Transit')
    .eq('migration_pending', true)
    .order('migration_pending_reason', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Groupage par raison pour faciliter la UI
  const byReason: Record<string, any[]> = {}
  for (const m of (data || [])) {
    const reason = m.migration_pending_reason || 'unknown'
    if (!byReason[reason]) byReason[reason] = []
    byReason[reason].push(m)
  }

  return NextResponse.json({
    total: data?.length || 0,
    missions: data || [],
    by_reason: byReason,
  })
}
