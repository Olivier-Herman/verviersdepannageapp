// src/app/api/devices/register/route.ts
//
// POST /api/devices/register { token, platform, device_name? }
//
// Appelé par le wrapper Capacitor après que l'utilisateur ait autorisé
// les push (event 'registration'). Upsert le token pour ce user.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d\'identite' }, { status: 401 })

  const body = await req.json() as { token?: string; platform?: string; device_name?: string }
  const token       = (body.token || '').trim()
  const platform    = body.platform === 'android' ? 'android' : (body.platform === 'ios' ? 'ios' : null)
  const deviceName  = (body.device_name || '').trim() || null

  if (!token)    return NextResponse.json({ error: 'token requis' }, { status: 400 })
  if (!platform) return NextResponse.json({ error: 'platform requis (ios ou android)' }, { status: 400 })

  const sb = createAdminClient()

  // Upsert : si (user_id, token) existe, met a jour last_seen_at. Sinon insert.
  const { data, error } = await sb
    .from('device_tokens')
    .upsert({
      user_id:      userId,
      token,
      platform,
      device_name:  deviceName,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'user_id,token' })
    .select('id')
    .single()

  if (error) {
    console.error('[devices/register] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: data.id })
}
