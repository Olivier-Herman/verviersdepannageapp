// src/app/api/missions/dispatch-mode/route.ts
// Gère le switch global manuel/auto du dispatch

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'dispatch_mode')
    .maybeSingle()

  return NextResponse.json({ mode: data?.value?.mode || 'manual' })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mode } = await req.json()
  if (!['manual', 'auto'].includes(mode)) {
    return NextResponse.json({ error: 'Mode invalide' }, { status: 400 })
  }

  const supabase = createAdminClient()
  await supabase
    .from('app_settings')
    .upsert(
      { key: 'dispatch_mode', value: { mode, updated_at: new Date().toISOString() } },
      { onConflict: 'key' }
    )

  return NextResponse.json({ ok: true, mode })
}
