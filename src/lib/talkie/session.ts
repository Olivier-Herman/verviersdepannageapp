// src/lib/talkie/session.ts
//
// Talkie (Olivier 30/09/2026) : quels canaux pour qui.
//  - Chauffeurs : UNIQUEMENT le 1er départ et la réserve de la nuit de garde, et
//    UNIQUEMENT de 18 h à 8 h (plage de nuit du planning de garde) : « Garde de nuit »
//    + leur canal direct vers Mobi / IT. Hors plage ou autres chauffeurs : rien.
//  - Mobi / IT (réglage « talkie_it ») : toujours visible, jour et nuit — « Garde de
//    nuit » et le canal direct des deux chauffeurs de garde de la nuit.
//  - Accès permanent (réglage « talkie_permanent », essais — Olivier 01/10/2026) : ces
//    chauffeurs ont leur canal direct avec Mobi / IT jour et nuit, même hors garde.
//  Tous apparaissent quand ils sont connectés et peuvent parler (pas d'écoute
//  discrète : Olivier veut apparaître).
// Le nom du canal temps réel est dérivé de la clé du canal + d'un secret serveur :
// il n'est connu que des personnes autorisées.

import { createHmac } from 'crypto'
import { createAdminClient } from '@/lib/supabase'
import { gardeNight } from '@/lib/missions/market-notify'
import { getBusinessList } from '@/lib/settings/business'

export interface TalkieMember { id: string; name: string }
export interface TalkieChannel {
  key:     string            // 'garde' | 'direct:<chauffeurId>'
  kind:    'garde' | 'direct'
  label:   string
  channel: string            // nom du canal temps réel (secret)
  members: TalkieMember[]    // qui reçoit les notifs de ce canal
}
export interface TalkieAccess {
  me:        TalkieMember | null
  nightKey:  string | null
  channels:  TalkieChannel[]
  /** Canal du bouton talkie de l'écran verrouillé (iPhone) : la garde la nuit, sinon un canal direct. */
  primaryKey?: string | null
}

function secretName(key: string, nightKey: string | null): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.CRON_SECRET || 'talkie'
  const scope = key === 'garde' ? `garde:${nightKey}` : key
  return `talkie-${createHmac('sha256', secret).update(`talkie:${scope}`).digest('hex').slice(0, 32)}`
}


export async function talkieAccess(user: { id?: string; role?: string; roles?: string[] } | null | undefined, now = new Date()): Promise<TalkieAccess> {
  if (!user?.id) return { me: null, nightKey: null, channels: [] }
  const sb = createAdminClient()
  const [night, itEmails, permEmails] = await Promise.all([gardeNight(sb, now), getBusinessList('talkie_it').catch(() => [] as string[]), getBusinessList('talkie_permanent').catch(() => [] as string[])])
  const [{ data: meRow }, { data: it }, { data: perm }] = await Promise.all([
    sb.from('users').select('id, name').eq('id', user.id).maybeSingle(),
    itEmails.length ? sb.from('users').select('id, name').eq('active', true).in('email', itEmails) : Promise.resolve({ data: [] as any[] }),
    permEmails.length ? sb.from('users').select('id, name').eq('active', true).in('email', permEmails) : Promise.resolve({ data: [] as any[] }),
  ])
  if (!meRow) return { me: null, nightKey: null, channels: [] }
  const me = { id: meRow.id, name: meRow.name }
  const channels: TalkieChannel[] = []
  const nightKey = night?.nightKey || null

  const dir = (it || []) as TalkieMember[]
  const isIt = dir.some(d => d.id === me.id)
  const gardeIds = [...new Set([night?.nightFirst, night?.reserve].filter(Boolean) as string[])]
  const iAmGarde = !!night?.inNight && gardeIds.includes(me.id)   // chauffeurs : de 18 h à 8 h seulement

  // Garde de nuit
  if (nightKey && gardeIds.length && (iAmGarde || isIt)) {   // seul Mobi / IT hors chauffeurs de garde (Olivier)
    const { data: g } = await sb.from('users').select('id, name').in('id', gardeIds)
    // Membres = les deux chauffeurs de garde + Mobi / IT : tous reçoivent les notifs
    // quand ils n'ont pas l'app à l'écran (Mobi n'était pas prévenu — Olivier 30/09).
    const members = [...gardeIds.map(id => ({ id, name: (g || []).find((x: any) => x.id === id)?.name || '—' })),
      ...dir.filter(d => !gardeIds.includes(d.id))]
    channels.push({ key: 'garde', kind: 'garde', label: 'Garde de nuit', channel: secretName('garde', nightKey), members })
  }

  // Direct vers Mobi / IT : les deux chauffeurs de garde de la nuit + ceux qui ont
  // l'accès permanent (essais).
  const permIds = ((perm || []) as TalkieMember[]).map(p => p.id)
  if (isIt) {
    const ids = [...new Set([...permIds, ...gardeIds])]
    const { data: g } = ids.length ? await sb.from('users').select('id, name').in('id', ids) : { data: [] as any[] }
    for (const id of ids) {
      const d = ((g || []) as TalkieMember[]).find(x => x.id === id)
      if (!d || d.id === me.id) continue
      channels.push({ key: `direct:${d.id}`, kind: 'direct', label: d.name, channel: secretName(`direct:${d.id}`, null), members: [d, ...dir] })
    }
  } else if ((iAmGarde || permIds.includes(me.id)) && dir.length) {
    channels.push({ key: `direct:${me.id}`, kind: 'direct', label: dir.map(d => d.name).join(', '), channel: secretName(`direct:${me.id}`, null), members: [me, ...dir] })
  }
  const primaryKey = (night?.inNight && channels.some(c => c.key === 'garde')) ? 'garde'
    : (channels.find(c => c.kind === 'direct' && permIds.includes(c.key.slice('direct:'.length)))?.key || channels[0]?.key || null)
  return { me, nightKey, channels, primaryKey }
}

/** Canal autorisé pour cet utilisateur (contrôle des API), ou null. */
export async function talkieChannel(user: any, key: string): Promise<{ access: TalkieAccess; ch: TalkieChannel } | null> {
  const access = await talkieAccess(user)
  const ch = access.channels.find(c => c.key === key)
  return ch && access.me ? { access, ch } : null
}
