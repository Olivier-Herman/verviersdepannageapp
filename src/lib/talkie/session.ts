// src/lib/talkie/session.ts
//
// Talkie (Olivier 30/09/2026) : quels canaux pour qui.
//  - « Garde de nuit » : le 1er départ et la réserve de la nuit de garde en cours
//    (planning) + les superadmins. Tous visibles quand ils sont connectés, tous
//    peuvent parler (pas d'écoute discrète : Olivier veut apparaître).
//  - Direct « Mobi / IT » : chaque chauffeur a un canal vers Mobi / IT (réglage
//    « talkie_it ») pour signaler un souci ; Mobi / IT voit un canal par chauffeur.
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
}

function secretName(key: string, nightKey: string | null): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.CRON_SECRET || 'talkie'
  const scope = key === 'garde' ? `garde:${nightKey}` : key
  return `talkie-${createHmac('sha256', secret).update(`talkie:${scope}`).digest('hex').slice(0, 32)}`
}

const isSuper = (u: any) => u?.role === 'superadmin' || (Array.isArray(u?.roles) && u.roles.includes('superadmin'))

export async function talkieAccess(user: { id?: string; role?: string; roles?: string[] } | null | undefined): Promise<TalkieAccess> {
  if (!user?.id) return { me: null, nightKey: null, channels: [] }
  const sb = createAdminClient()
  const [night, itEmails] = await Promise.all([gardeNight(sb), getBusinessList('talkie_it').catch(() => [] as string[])])
  const [{ data: meRow }, { data: it }] = await Promise.all([
    sb.from('users').select('id, name, role, roles, towsoft_name').eq('id', user.id).maybeSingle(),
    itEmails.length ? sb.from('users').select('id, name').eq('active', true).in('email', itEmails) : Promise.resolve({ data: [] as any[] }),
  ])
  if (!meRow) return { me: null, nightKey: null, channels: [] }
  const me = { id: meRow.id, name: meRow.name }
  const channels: TalkieChannel[] = []
  const nightKey = night?.nightKey || null

  // Garde de nuit
  const gardeIds = [night?.nightFirst, night?.reserve].filter(Boolean) as string[]
  if (nightKey && gardeIds.length && (gardeIds.includes(me.id) || isSuper(user))) {
    const { data: g } = await sb.from('users').select('id, name').in('id', gardeIds)
    const members = [...new Set(gardeIds)].map(id => ({ id, name: (g || []).find((x: any) => x.id === id)?.name || '—' }))
    channels.push({ key: 'garde', kind: 'garde', label: 'Garde de nuit', channel: secretName('garde', nightKey), members })
  }

  // Direct vers Mobi / IT
  const dir = (it || []) as TalkieMember[]
  const isIt = dir.some(d => d.id === me.id)
  const roles: string[] = Array.isArray(meRow.roles) ? meRow.roles : []
  const isDriver = meRow.role === 'driver' || roles.includes('driver') || roles.includes('chauffeur') || !!meRow.towsoft_name
  if (isIt) {
    const { data: drivers } = await sb.from('users').select('id, name').eq('active', true).not('towsoft_name', 'is', null).neq('towsoft_name', '').order('name')
    for (const d of (drivers || []) as TalkieMember[]) {
      if (d.id === me.id) continue
      channels.push({ key: `direct:${d.id}`, kind: 'direct', label: d.name, channel: secretName(`direct:${d.id}`, null), members: [d, ...dir] })
    }
  } else if (isDriver && dir.length) {
    channels.push({ key: `direct:${me.id}`, kind: 'direct', label: dir.map(d => d.name).join(', '), channel: secretName(`direct:${me.id}`, null), members: [me, ...dir] })
  }
  return { me, nightKey, channels }
}

/** Canal autorisé pour cet utilisateur (contrôle des API), ou null. */
export async function talkieChannel(user: any, key: string): Promise<{ access: TalkieAccess; ch: TalkieChannel } | null> {
  const access = await talkieAccess(user)
  const ch = access.channels.find(c => c.key === key)
  return ch && access.me ? { access, ch } : null
}
