// /api/talkie/messages — enregistrements du talkie « Garde de nuit » (Olivier 30/09/2026)
// GET  → derniers messages de la nuit (liens d'écoute temporaires)
// POST (formulaire : audio WAV, durationMs, peerOnline) → enregistre la prise de
//      parole ; si l'autre membre n'avait pas l'app ouverte, notif « X parle sur le
//      talkie » pour qu'il réécoute.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { talkieSession }     from '@/lib/talkie/session'
import { sendNotification }  from '@/lib/notifications/send'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  const t = await talkieSession(session?.user as any)
  if (!t.allowed || !t.nightKey) return NextResponse.json({ error: 'Accès réservé au 1er départ et à la réserve de la nuit.' }, { status: 403 })
  const sb = createAdminClient()
  const { data } = await sb.from('talkie_messages').select('id, sender_id, duration_ms, storage_path, created_at')
    .eq('night_key', t.nightKey).order('created_at', { ascending: false }).limit(30)
  const out = await Promise.all((data || []).map(async (m: any) => {
    const { data: s } = await sb.storage.from('talkie').createSignedUrl(m.storage_path, 3600)
    return { id: m.id, senderId: m.sender_id, senderName: t.members?.find(x => x.id === m.sender_id)?.name || '—', durationMs: m.duration_ms, at: m.created_at, url: s?.signedUrl || null }
  }))
  return NextResponse.json({ messages: out })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const t = await talkieSession(session?.user as any)
  if (!t.allowed || t.role !== 'member' || !t.nightKey || !t.me) return NextResponse.json({ error: 'Réservé au 1er départ et à la réserve de la nuit.' }, { status: 403 })
  const form = await req.formData()
  const file = form.get('audio')
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Audio manquant' }, { status: 400 })
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Message trop long' }, { status: 413 })
  const durationMs = Math.max(0, Math.min(300_000, Number(form.get('durationMs')) || 0))
  const peerOnline = form.get('peerOnline') === '1'
  const sb = createAdminClient()
  const path = `${t.nightKey}/${Date.now()}-${t.me.id.slice(0, 8)}.wav`
  const { error } = await sb.storage.from('talkie').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: 'audio/wav', upsert: false })
  if (error) return NextResponse.json({ error: `Enregistrement impossible : ${error.message}` }, { status: 500 })
  const { data: row } = await sb.from('talkie_messages').insert({ night_key: t.nightKey, sender_id: t.me.id, duration_ms: durationMs, storage_path: path }).select('id').single()
  if (!peerOnline) {
    for (const m of (t.members || []).filter(x => x.id !== t.me!.id)) {
      await sendNotification(m.id, 'talkie_message', {
        title: `📻 ${t.me.name} parle sur le talkie`,
        body:  `Message de ${Math.max(1, Math.round(durationMs / 1000))} s sur « Garde de nuit ». Ouvre le talkie pour l’écouter.`,
        action_url: '/talkie',
      }).catch(() => {})
    }
  }
  return NextResponse.json({ ok: true, id: row?.id })
}
