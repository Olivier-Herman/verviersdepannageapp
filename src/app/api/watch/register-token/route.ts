// src/app/api/watch/register-token/route.ts
//
// POST /api/watch/register-token { token, device_name? }
// Auth : Authorization: Bearer <watch-jwt>
//
// Appele depuis l app Watch apres autorisation push. Upsert le token
// APNs Watch dans device_tokens (platform='watchos'). Le helper
// sendPushNotification dispatch ensuite sur le topic Watch.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyWatchAuth }   from '@/lib/auth-watch'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const userId = await verifyWatchAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { token?: string; device_name?: string }
  const token      = (body.token || '').trim()
  const deviceName = (body.device_name || '').trim() || 'Apple Watch'
  if (!token) return NextResponse.json({ error: 'token requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('device_tokens')
    .upsert({
      user_id:      userId,
      token,
      platform:     'watchos',
      device_name:  deviceName,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'user_id,token' })
    .select('id')
    .single()

  if (error) {
    console.error('[watch/register-token] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: data.id })
}
