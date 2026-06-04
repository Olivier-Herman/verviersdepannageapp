// src/app/api/admin/logs/route.ts
//
// GET /api/admin/logs?level=error&route=/api/towsoft&hours=24&limit=200
// Liste les logs erreurs serveur. Superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden (superadmin only)' }, { status: 403 })
  }

  const url = new URL(req.url)
  const level = url.searchParams.get('level') || ''
  const route = url.searchParams.get('route') || ''
  const hours = Math.min(parseInt(url.searchParams.get('hours') || '24', 10), 720)  // max 30j
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 1000)

  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString()
  const sb = createAdminClient()

  let q = sb
    .from('error_logs')
    .select('id, level, route, message, metadata, user_email, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (level) q = q.eq('level', level)
  if (route) q = q.ilike('route', `%${route}%`)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Stats simples
  const byLevel = (data || []).reduce((acc: Record<string, number>, log) => {
    acc[log.level] = (acc[log.level] || 0) + 1
    return acc
  }, {})
  const byRoute = (data || []).reduce((acc: Record<string, number>, log) => {
    const r = log.route || 'unknown'
    acc[r] = (acc[r] || 0) + 1
    return acc
  }, {})

  return NextResponse.json({
    ok: true,
    total: data?.length || 0,
    since: sinceIso,
    by_level: byLevel,
    top_routes: Object.entries(byRoute).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 10),
    logs: data || [],
  })
}
