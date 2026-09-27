// src/app/api/admin/debug/worker-status/route.ts
//
// GET /api/admin/debug/worker-status (superadmin, lecture seule)
// Le worker du VPS bat-il ? Que reste-t-il dans sa file ? Qu'a-t-il fait en
// dernier ? Affiché dans Admin → Diagnostics → Worker VPS. Olivier 27/09/2026.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { workerHeartbeat, queueSnapshot } from '@/lib/worker/queue'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const roles = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const [hb, file, dernier] = await Promise.all([
    workerHeartbeat(sb),
    queueSnapshot(sb),
    sb.from('app_settings').select('value').eq('key', 'vab_close_retry_last_run').maybeSingle(),
  ])
  let filet: any = null
  try { filet = JSON.parse(String((dernier.data as any)?.value || 'null')) } catch { /* trace illisible */ }

  return NextResponse.json({
    worker: {
      ...hb,
      verdict: hb.alive
        ? `vivant (${hb.host}, version ${hb.version}, dernier signal il y a ${Math.round((hb.ageMs || 0) / 1000)} s)${hb.busy ? ' — occupé' : ''}`
        : hb.at ? `silencieux depuis ${Math.round((hb.ageMs || 0) / 60000)} min → Vercel clôture lui-même`
                : 'jamais vu → Vercel clôture lui-même',
    },
    file,
    dernierPassageFilet: filet,
  })
}
