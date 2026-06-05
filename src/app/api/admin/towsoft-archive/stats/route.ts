// src/app/api/admin/towsoft-archive/stats/route.ts
// GET stats archive TowSoft pour le dashboard admin.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role || '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const [{ count: total }, { count: enriched }, { count: cancelled }, { count: failed }, { data: errSamples }] = await Promise.all([
    sb.from('towsoft_archive').select('id', { count: 'exact', head: true }),
    sb.from('towsoft_archive').select('id', { count: 'exact', head: true }).not('detail_fetched_at', 'is', null),
    sb.from('towsoft_archive').select('id', { count: 'exact', head: true }).eq('is_cancelled', true),
    sb.from('towsoft_archive').select('id', { count: 'exact', head: true }).gte('enrich_attempts', 5).is('detail_fetched_at', null),
    sb.from('towsoft_archive').select('towsoft_num, enrich_error, enrich_attempts').not('enrich_error', 'is', null).order('updated_at', { ascending: false }).limit(5),
  ])

  const pending = (total || 0) - (enriched || 0)
  return NextResponse.json({
    ok: true,
    total:        total || 0,
    enriched:     enriched || 0,
    pending,
    cancelled:    cancelled || 0,
    failed_max:   failed || 0,
    error_samples: errSamples || [],
  })
}
