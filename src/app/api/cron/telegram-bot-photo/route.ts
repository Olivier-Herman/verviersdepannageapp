// src/app/api/cron/telegram-bot-photo/route.ts
//
// Photo du bot @VerviersDepannageBot selon l'agent de service (Olivier
// 03/10/2026) : Sam de 8 h à 20 h, Sonic de 20 h à 8 h (heure de Bruxelles).
// Passage toutes les heures : la photo n'est changée que si elle ne correspond
// pas à l'agent du moment (un passage manqué se rattrape au suivant).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { agentDuMoment } from '@/lib/sam/core'

export const dynamic = 'force-dynamic'
const KEY = 'telegram_bot_photo'

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = process.env.TELEGRAM_VD_BOT_TOKEN
  if (!token) return NextResponse.json({ ok: false, error: 'bot non configuré' }, { status: 500 })
  const sb = createAdminClient()
  const agent = agentDuMoment()
  const { data } = await sb.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  let current: string | null = null
  try { current = data?.value ? JSON.parse(String(data.value)) : null } catch { current = null }
  if (current === agent) return NextResponse.json({ ok: true, agent, changed: false })

  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com').replace(/\/$/, '')
  const img = await fetch(`${base}/noprecache/agents/${agent.toLowerCase()}.jpg`, { cache: 'no-store' })
  if (!img.ok) return NextResponse.json({ ok: false, error: `photo introuvable (${img.status})` }, { status: 500 })
  const form = new FormData()
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://f' }))
  form.append('f', new Blob([await img.arrayBuffer()], { type: 'image/jpeg' }), `${agent.toLowerCase()}.jpg`)
  const r = await fetch(`https://api.telegram.org/bot${token}/setMyProfilePhoto`, { method: 'POST', body: form, cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (!j.ok) {
    console.error('[telegram-bot-photo]', j.description || r.status)
    return NextResponse.json({ ok: false, error: j.description || `HTTP ${r.status}` }, { status: 502 })
  }
  await sb.from('app_settings').upsert({ key: KEY, value: JSON.stringify(agent), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return NextResponse.json({ ok: true, agent, changed: true })
}
