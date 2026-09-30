// src/lib/talkie/session.ts
//
// Talkie « Garde de nuit » (Olivier 30/09/2026) : qui peut y accéder cette nuit.
//  - Membres : le 1er départ et la réserve de la nuit de garde en cours (planning).
//  - Superadmins : écoute seule, sans apparaître parmi les connectés.
// Le nom du canal temps réel est dérivé de la nuit + d'un secret serveur : il n'est
// connu que des personnes autorisées (la clé publique Supabase ne suffit pas à le
// deviner).

import { createHmac } from 'crypto'
import { createAdminClient } from '@/lib/supabase'
import { gardeNight } from '@/lib/missions/market-notify'

export interface TalkieSession {
  allowed:  boolean
  role?:    'member' | 'listener'
  nightKey?: string
  channel?: string
  me?:      { id: string; name: string }
  members?: { id: string; name: string }[]
}

export function talkieChannelName(nightKey: string): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.CRON_SECRET || 'talkie'
  return `talkie-garde-${nightKey}-${createHmac('sha256', secret).update(`talkie:${nightKey}`).digest('hex').slice(0, 24)}`
}

export async function talkieSession(user: { id?: string; role?: string; roles?: string[] } | null | undefined): Promise<TalkieSession> {
  if (!user?.id) return { allowed: false }
  const sb = createAdminClient()
  const night = await gardeNight(sb)
  if (!night) return { allowed: false }
  const ids = [night.nightFirst, night.reserve].filter(Boolean) as string[]
  const { data: users } = ids.length ? await sb.from('users').select('id, name').in('id', [...ids, user.id]) : await sb.from('users').select('id, name').eq('id', user.id)
  const nameOf = (id: string) => (users || []).find((u: any) => u.id === id)?.name || '—'
  const members = [...new Set(ids)].map(id => ({ id, name: nameOf(id) }))
  const isSuper = user.role === 'superadmin' || (user.roles || []).includes('superadmin')
  const isMember = ids.includes(user.id)
  if (!isMember && !isSuper) return { allowed: false }
  return {
    allowed: true, role: isMember ? 'member' : 'listener', nightKey: night.nightKey,
    channel: talkieChannelName(night.nightKey), me: { id: user.id, name: nameOf(user.id) }, members,
  }
}
