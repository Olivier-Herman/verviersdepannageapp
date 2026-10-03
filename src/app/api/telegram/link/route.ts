// src/app/api/telegram/link/route.ts
//
// Liaison Telegram depuis le profil (Olivier 03/10/2026) :
//   GET    → état (relié ou non)
//   POST   → lien t.me/VerviersDepannageBot?start=<code> (usage unique, 15 min)
//   DELETE → délier

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomBytes } from 'crypto'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
const BOT = 'VerviersDepannageBot'

async function me() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return null
  const { data } = await createAdminClient().from('users').select('id, active').eq('email', email).maybeSingle()
  return data?.active ? data : null
}

export async function GET() {
  const u = await me(); if (!u) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const { data } = await createAdminClient().from('telegram_links').select('linked_at, tg_username').eq('user_id', u.id).maybeSingle()
  return NextResponse.json({ linked: !!data, linked_at: data?.linked_at || null, username: data?.tg_username || null })
}

export async function POST() {
  const u = await me(); if (!u) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const code = randomBytes(12).toString('base64url')
  await createAdminClient().from('telegram_link_codes').insert({ code, user_id: u.id, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
  return NextResponse.json({ url: `https://t.me/${BOT}?start=${code}`, expires_in_min: 15 })
}

export async function DELETE() {
  const u = await me(); if (!u) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  await createAdminClient().from('telegram_links').delete().eq('user_id', u.id)
  return NextResponse.json({ ok: true })
}
