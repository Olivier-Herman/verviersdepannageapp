// src/app/api/admin/towsoft-migration/mark-zone-done/route.ts
//
// POST /api/admin/towsoft-migration/mark-zone-done { zone_key: string, undo?: boolean }
//
// Olivier 2026-06-06 : marque une zone comme completement scannee dans le
// workflow migration fourriere. Set parc_zones.migration_completed_at +
// migration_completed_by. Si undo=true, remet a NULL.
//
// Permissions : admin / superadmin / module fourriere.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const zoneKey = String(body.zone_key || '').trim()
  const undo    = Boolean(body.undo)

  if (!zoneKey) return NextResponse.json({ error: 'zone_key requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id').eq('email', session.user.email).maybeSingle()

  const { data, error } = await sb
    .from('parc_zones')
    .update({
      migration_completed_at: undo ? null : new Date().toISOString(),
      migration_completed_by: undo ? null : (actor?.id || null),
      updated_at:             new Date().toISOString(),
    })
    .eq('key', zoneKey)
    .select('key, migration_completed_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: `Zone ${zoneKey} introuvable` }, { status: 404 })

  return NextResponse.json({
    ok: true,
    zone_key: data.key,
    migration_completed_at: data.migration_completed_at,
    action: undo ? 'undone' : 'completed',
  })
}
