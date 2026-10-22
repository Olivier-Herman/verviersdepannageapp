// src/lib/assistant/access.ts — qui peut ouvrir quelle conversation de l'assistant.
// Conversations « admin » : superadmin seulement (outils d'administration).
// Conversations « bureau » (assistant de Jona, Olivier 14/10/2026) : superadmin ou personne
// listée dans le réglage « assistant_bureau_users », toujours sur SES conversations.
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { canUseBureau }      from './bureau'

export type AssistantMode = 'admin' | 'bureau'

export async function assistantUser(mode: AssistantMode) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const su = session.user as any
  const roles: string[] = [su.role, ...(Array.isArray(su.roles) ? su.roles : [])].filter(Boolean)
  const ok = mode === 'bureau' ? await canUseBureau({ email: su.email, role: su.role, roles }) : roles.includes('superadmin')
  if (!ok) return null
  const { data: user } = await createAdminClient().from('users').select('id, name, email').eq('email', su.email).maybeSingle()
  return user ?? null
}

/** Questions de la veille : les personnes qui ont Max, et celles du réglage « veille_alerte_users »
 *  (alerte au milieu de l'écran, sans Max — Olivier 22/10/2026). */
export async function veilleUser() {
  const withMax = await assistantUser('bureau')
  if (withMax) return withMax
  const session = await getServerSession(authOptions)
  const email = String(session?.user?.email || '').toLowerCase()
  if (!email || !(await inVeilleAlerte(email))) return null
  const { data: user } = await createAdminClient().from('users').select('id, name, email').eq('email', session!.user!.email!).maybeSingle()
  return user ?? null
}

export async function inVeilleAlerte(email: string | null | undefined): Promise<boolean> {
  if (!email) return false
  const { getBusinessList } = await import('@/lib/settings/business')
  const list = await getBusinessList('veille_alerte_users').catch(() => [] as string[])
  return list.map(x => String(x).trim().toLowerCase()).includes(String(email).toLowerCase())
}

export async function assistantOwner(conversationId: string) {
  const { data: conv } = await createAdminClient().from('assistant_conversations').select('*').eq('id', conversationId).maybeSingle()
  if (!conv) return null
  const user = await assistantUser(conv.mode === 'bureau' ? 'bureau' : 'admin')
  if (!user || conv.user_id !== user.id) return null
  return { user, conv }
}
