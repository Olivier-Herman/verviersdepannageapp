// src/lib/talkie/notify.ts — notif talkie (Olivier 30/09/2026) : aux membres du canal
// qui n'ont pas l'app à l'écran ; au plus une par minute et par personne QUI PARLE
// (Olivier 30/09/2026 : si Franck puis Fred parlent, on est prévenu pour chacun ; mais
// quelqu'un qui enchaîne plusieurs messages ne déclenche pas une rafale).
// « À l'écran » = signal de présence reçu il y a moins de 25 s (table talkie_presence,
// alimentée toutes les 10 s par l'app visible). La liste « connectés » envoyée par le
// téléphone n'est plus utilisée : sur iPhone, elle restait fausse en arrière-plan.
import { createAdminClient } from '@/lib/supabase'
import { sendNotification }  from '@/lib/notifications/send'
import type { TalkieAccess, TalkieChannel } from './session'

const DEDUPE_MS = 60_000   // une par minute et par personne qui parle (Olivier 30/09/2026)
const SEEN_MS   = 25_000

export async function notifyTalkie(t: { access: TalkieAccess; ch: TalkieChannel }, _clientOnline: Set<string>, when: 'start' | 'end', secs?: number): Promise<number> {
  const me = t.access.me!
  const sb = createAdminClient()
  const since = new Date(Date.now() - DEDUPE_MS).toISOString()
  const others = t.ch.members.filter(x => x.id !== me.id)
  const { data: seen } = others.length ? await sb.from('talkie_presence').select('user_id').in('user_id', others.map(x => x.id)).gte('seen_at', new Date(Date.now() - SEEN_MS).toISOString()) : { data: [] as any[] }
  const onScreen = new Set((seen || []).map((x: any) => x.user_id))
  let sent = 0
  for (const m of others.filter(x => !onScreen.has(x.id))) {
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
