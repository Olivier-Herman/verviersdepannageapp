// POST /api/talkie/native-log { key, version, device, lines: [{ t, msg }] } — journal du
// module talkie iPhone (téléphone verrouillé), authentifié par le jeton du serveur vocal
// (Authorization: Bearer …). Olivier 01/10/2026 : voir ce qui se passe sans brancher le téléphone.
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyLivekitToken, baseIdentity } from '@/lib/talkie/livekit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const v = bearer ? verifyLivekitToken(bearer) : null
  if (!v) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { key?: string; version?: string; device?: string; lines?: { t?: string; msg?: string }[] }
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 200).filter(l => l && l.msg)
  if (!lines.length) return NextResponse.json({ ok: true, stored: 0 })
  const userId = baseIdentity(v.identity)
  const rows = lines.map(l => {
    const t = l.t && !isNaN(Date.parse(l.t)) ? new Date(l.t).toISOString() : null
    return { user_id: /^[0-9a-f-]{36}$/.test(userId) ? userId : null, channel_key: String(b.key || '').slice(0, 80) || null, version: String(b.version || '').slice(0, 60) || null, device: String(b.device || '').slice(0, 80) || null, t, msg: String(l.msg).slice(0, 2000) }
  })
  const { error } = await createAdminClient().from('talkie_native_logs').insert(rows)
  if (error) { console.warn('[talkie native-log]', error.message); return NextResponse.json({ error: error.message }, { status: 500 }) }
  return NextResponse.json({ ok: true, stored: rows.length })
}
