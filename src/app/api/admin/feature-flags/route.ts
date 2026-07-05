// src/app/api/admin/feature-flags/route.ts
//
// Lecture / réglage des feature flags (mode preview). Réservé superadmin.
//   GET  → { flags: [{ key, mode, label }] }
//   POST { key, mode } → règle le mode d'un flag ('off' | 'superadmin' | 'all')

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { invalidateFlagCache, FLAG_MODES, type FlagMode } from '@/lib/feature-flags'

export const dynamic = 'force-dynamic'

function isSuperadmin(session: any): boolean {
  return (session?.user as any)?.role === 'superadmin'
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  const sb = createAdminClient()
  const { data } = await sb.from('feature_flags').select('key, mode, label').order('key')
  return NextResponse.json({ flags: data || [] })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const key  = String(body.key || '').trim()
  const mode = String(body.mode || '') as FlagMode
  if (!key || !FLAG_MODES.includes(mode)) {
    return NextResponse.json({ error: 'key / mode invalide' }, { status: 422 })
  }

  const sb = createAdminClient()
  const { error } = await sb.from('feature_flags')
    .upsert({ key, mode, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  invalidateFlagCache()
  return NextResponse.json({ ok: true, key, mode })
}
