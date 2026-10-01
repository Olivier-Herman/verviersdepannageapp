// src/lib/talkie/notify.ts — notif talkie (Olivier 30/09/2026) : aux membres du canal
// qui n'ont pas l'app à l'écran ; au plus une par minute et par personne QUI PARLE
// (Olivier 30/09/2026 : si Franck puis Fred parlent, on est prévenu pour chacun ; mais
// quelqu'un qui enchaîne plusieurs messages ne déclenche pas une rafale).
// « À l'écran » = signal de présence reçu il y a moins de 25 s (table talkie_presence,
// alimentée toutes les 10 s par l'app visible). La liste « connectés » envoyée par le
// téléphone n'est plus utilisée : sur iPhone, elle restait fausse en arrière-plan.
// Téléphone verrouillé (Olivier 01/10/2026) : un iPhone dont l'app a rejoint le canal
// talkie système (jeton « Push to Talk ») est réveillé à CHAQUE prise de parole et
// entend la voix en direct ; il ne reçoit alors pas la notif classique.
import { createAdminClient } from '@/lib/supabase'
import { sendNotification }  from '@/lib/notifications/send'
import { sendApnsPtt }       from '@/lib/notifications/push-apns'
import { livekitToken, NATIVE_SUFFIX } from './livekit'
import type { TalkieAccess, TalkieChannel, TalkieMember } from './session'

const DEDUPE_MS = 60_000   // une par minute et par personne qui parle (Olivier 30/09/2026)
const SEEN_MS   = 25_000
const HEARD_MS  = 90_000   // réveillé en direct il y a moins de 90 s : pas de notif « a parlé »

/** Nom du canal tel que le destinataire le voit. */
function labelFor(ch: TalkieChannel, m: TalkieMember): string {
  if (ch.kind === 'garde') return ch.label
  const driverId = ch.key.slice('direct:'.length)
  return m.id === driverId ? ch.members.filter(x => x.id !== driverId).map(x => x.name).join(', ') : (ch.members.find(x => x.id === driverId)?.name || ch.label)
}

/** Réveille les iPhones du membre (talkie téléphone verrouillé). true si au moins un a reçu. */
async function wakePtt(sb: ReturnType<typeof createAdminClient>, tokens: string[], ch: TalkieChannel, m: TalkieMember, speaker: TalkieMember): Promise<boolean> {
  const lk = livekitToken(ch.channel, m.id + NATIVE_SUFFIX, m.name, 10 * 60)
  if (!lk) return false
  let ok = false
  for (const token of tokens) {
    const r = await sendApnsPtt(token, { speaker: speaker.name, speakerId: speaker.id, key: ch.key, channelName: labelFor(ch, m), lkUrl: lk.url, lkToken: lk.token })
    if (r.invalid_token) { await sb.from('talkie_ptt_tokens').delete().eq('token', token); continue }
    if (!r.ok) console.warn('[talkie] push PTT refusé', r.status, r.reason)
    await sb.from('talkie_ptt_tokens').update({ last_push_at: new Date().toISOString(), last_push_ok: r.ok }).eq('token', token)
    ok = ok || r.ok
  }
  return ok
}

export async function notifyTalkie(t: { access: TalkieAccess; ch: TalkieChannel }, _clientOnline: Set<string>, when: 'start' | 'end', secs?: number): Promise<number> {
  const me = t.access.me!
  const sb = createAdminClient()
  const since = new Date(Date.now() - DEDUPE_MS).toISOString()
  const others = t.ch.members.filter(x => x.id !== me.id)
  const { data: seen } = others.length ? await sb.from('talkie_presence').select('user_id').in('user_id', others.map(x => x.id)).gte('seen_at', new Date(Date.now() - SEEN_MS).toISOString()) : { data: [] as any[] }
  const onScreen = new Set((seen || []).map((x: any) => x.user_id))
  const away = others.filter(x => !onScreen.has(x.id))
  const { data: ptt } = away.length ? await sb.from('talkie_ptt_tokens').select('token, user_id, last_push_at, last_push_ok').in('user_id', away.map(x => x.id)) : { data: [] as any[] }
  let sent = 0
  for (const m of away) {
    const mine = (ptt || []).filter((p: any) => p.user_id === m.id)
    if (when === 'start' && mine.length && await wakePtt(sb, mine.map((p: any) => p.token), t.ch, m, me).catch(() => false)) { sent++; continue }
    if (when === 'end' && mine.some((p: any) => p.last_push_ok && p.last_push_at && Date.now() - new Date(p.last_push_at).getTime() < HEARD_MS)) continue
    const { data: recent } = await sb.from('notifications_log').select('id').eq('user_id', m.id).eq('notif_type', 'talkie_message')
      .eq('payload->data->>sender_id', me.id).gte('created_at', since).limit(1)
    if (recent?.length) continue
    await sendNotification(m.id, 'talkie_message', {
      title: `📻 ${me.name} ${when === 'start' ? 'parle en ce moment' : 'a parlé'}${t.ch.kind === 'garde' ? ' sur « Garde de nuit »' : ' sur le talkie'}`,
      body:  when === 'start' ? 'Ouvre l’app pour l’entendre en direct.' : `Message de ${secs || 1} s. Ouvre le talkie pour l’écouter.`,
      action_url: `/talkie?c=${encodeURIComponent(t.ch.key)}`,
      data:       { sender_id: me.id, channel: t.ch.key },
    }).then(() => { sent++ }, () => {})
  }
  return sent
}
