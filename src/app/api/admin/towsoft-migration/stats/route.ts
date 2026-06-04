// src/app/api/admin/towsoft-migration/stats/route.ts
//
// GET /api/admin/towsoft-migration/stats
// Stats globales pour le tableau de bord migration.

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

  const [{ count: total }, { count: scanned }, { count: imported }, { count: enriched }, { data: byZone }] = await Promise.all([
    sb.from('towsoft_migration_source').select('id', { count: 'exact', head: true }),
    sb.from('towsoft_migration_source').select('id', { count: 'exact', head: true }).eq('flag_scanned', true),
    sb.from('towsoft_migration_source').select('id', { count: 'exact', head: true }).not('imported_at', 'is', null),
    sb.from('towsoft_migration_source').select('id', { count: 'exact', head: true }).not('detail_fetched_at', 'is', null),
    sb.from('towsoft_migration_source').select('scanned_zone').eq('flag_scanned', true).not('scanned_zone', 'is', null),
  ])

  // Group par zone scannée
  const zoneCount: Record<string, number> = {}
  for (const r of (byZone || []) as any[]) {
    const z = r.scanned_zone || '?'
    zoneCount[z] = (zoneCount[z] || 0) + 1
  }

  return NextResponse.json({
    ok: true,
    total:    total || 0,
    scanned:  scanned || 0,
    imported: imported || 0,
    enriched: enriched || 0,
    pending_import: (scanned || 0) - (imported || 0),
    by_zone:  zoneCount,
  })
}
