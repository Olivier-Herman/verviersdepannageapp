// /api/talkie/messages — enregistrements du talkie (Olivier 30/09/2026)
// GET  ?key=garde|direct:<id> → derniers messages du canal (liens d'écoute temporaires)
// POST (formulaire : key, audio WAV, durationMs, online = ids connectés) → enregistre
//      la prise de parole ; notif « X te parle sur le talkie » aux membres du canal
//      qui n'avaient pas le talkie ouvert.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { talkieChannel }     from '@/lib/talkie/session'
import { sendNotification }  from '@/lib/notifications/send'

export const dynamic = 'force-dynamic'

const dayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const key = new URL(req.url).searchParams.get('key') || 'garde'
  const t = await talkieChannel(session?.user as any, key)
  if (!t) return NextResponse.json({ error: 'Canal non autorisé.' }, { status: 403 })
  const sb = createAdminClient()
  let q = sb.from('talkie_messages').select('id, sender_id, duration_ms, storage_path, created_at').eq('channel_key', key)
  if (key === 'garde' && t.access.nightKey) q = q.eq('night_key', t.access.nightKey)
  const { data } = await q.order('created_at', { ascending: false }).limit(30)
  const ids = [...new Set((data || []).map((m: any) => m.sender_id).filter(Boolean))]
  const { data: us } = ids.length ? await sb.from('users').select('id, name').in('id', ids) : { data: [] as any[] }
  const out = await Promise.all((data || []).map(async (m: any) => {
    const { data: s } = await sb.storage.from('talkie').createSignedUrl(m.storage_path, 3600)
    return { id: m.id, senderId: m.sender_id, senderName: (us || []).find((u: any) => u.id === m.sender_id)?.name || '—', durationMs: m.duration_ms, at: m.created_at, url: s?.signedUrl || null }
  }))
  return NextResponse.json({ messages: out })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const form = await req.formData()
  const key = String(form.get('key') || 'garde')
  const t = await talkieChannel(session?.user as any, key)
  if (!t) return NextResponse.json({ error: 'Canal non autorisé.' }, { status: 403 })
  const me = t.access.me!
  const file = form.get('audio')
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Audio manquant' }, { status: 400 })
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Message trop long' }, { status: 413 })
  const durationMs = Math.max(0, Math.min(300_000, Number(form.get('durationMs')) || 0))
  const online = new Set(String(form.get('online') || '').split(',').filter(Boolean))
  const sb = createAdminClient()
  const nightKey = key === 'garde' ? (t.access.nightKey || dayKey()) : dayKey()
  const path = `${key.replace(/[^a-z0-9-]/gi, '_')}/${nightKey}/${Date.now()}-${me.id.slice(0, 8)}.wav`
  const { error } = await sb.storage.from('talkie').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: 'audio/wav', upsert: false })
  if (error) return NextResponse.json({ error: `Enregistrement impossible : ${error.message}` }, { status: 500 })
  const { data: row } = await sb.from('talkie_messages').insert({ night_key: nightKey, channel_key: key, sender_id: me.id, duration_ms: durationMs, storage_path: path }).select('id').single()
  const secs = Math.max(1, Math.round(durationMs / 1000))
  for (const m of t.ch.members.filter(x => x.id !== me.id && !online.has(x.id))) {
    await sendNotification(m.id, 'talkie_message', {
      title: `📻 ${me.name} ${t.ch.kind === 'garde' ? 'parle sur « Garde de nuit »' : 'te parle sur le talkie'}`,
      body:  `Message de ${secs} s. Ouvre le talkie pour l’écouter.`,
      action_url: `/talkie?c=${encodeURIComponent(key)}`,
    }).catch(() => {})
  }
  return NextResponse.json({ ok: true, id: row?.id })
}
