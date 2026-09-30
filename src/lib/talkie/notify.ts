// src/lib/talkie/notify.ts — notif talkie (Olivier 30/09/2026) : aux membres du canal
// qui n'ont pas l'app à l'écran ; au plus une toutes les 2 min par personne (une
// conversation ne doit pas déclencher une rafale de notifs).
import { createAdminClient } from '@/lib/supabase'
import { sendNotification }  from '@/lib/notifications/send'
import type { TalkieAccess, TalkieChannel } from './session'

const DEDUPE_MS = 2 * 60_000

export async function notifyTalkie(t: { access: TalkieAccess; ch: TalkieChannel }, online: Set<string>, when: 'start' | 'end', secs?: number): Promise<number> {
  const me = t.access.me!
  const sb = createAdminClient()
  const since = new Date(Date.now() - DEDUPE_MS).toISOString()
  let sent = 0
  for (const m of t.ch.members.filter(x => x.id !== me.id && !online.has(x.id))) {
    const { data: recent } = await sb.from('notifications_log').select('id').eq('user_id', m.id).eq('notif_type', 'talkie_message').gte('created_at', since).limit(1)
    if (recent?.length) continue
    await sendNotification(m.id, 'talkie_message', {
      title: `📻 ${me.name} ${when === 'start' ? 'parle en ce moment' : 'a parlé'}${t.ch.kind === 'garde' ? ' sur « Garde de nuit »' : ' sur le talkie'}`,
      body:  when === 'start' ? 'Ouvre l’app pour l’entendre en direct.' : `Message de ${secs || 1} s. Ouvre le talkie pour l’écouter.`,
      action_url: `/talkie?c=${encodeURIComponent(t.ch.key)}`,
    }).then(() => { sent++ }, () => {})
  }
  return sent
}
