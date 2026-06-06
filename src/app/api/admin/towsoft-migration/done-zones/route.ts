// src/app/api/admin/towsoft-migration/done-zones/route.ts
//
// GET /api/admin/towsoft-migration/done-zones
// Retourne la liste des zones marquees comme migrees (migration_completed_at != null).

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
    .from('parc_zones')
    .select('key, migration_completed_at, migration_completed_by')
    .not('migration_completed_at', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    zones: (data || []).map(z => z.key),
    details: data || [],
  })
}
