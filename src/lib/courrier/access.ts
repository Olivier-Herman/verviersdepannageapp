// src/lib/courrier/access.ts — qui voit le courrier : admin/superadmin et le rôle
// « mail_agent » (Jona), derrière le drapeau `courrier` le temps du pilote.
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { sessionAccess } from '@/lib/access'
import { isPreviewOn } from '@/lib/feature-flags'

export async function courrierAccess(): Promise<{ ok: boolean; userId: string | null; name: string | null }> {
  const session = await getServerSession(authOptions)
  const a = sessionAccess(session, { roles: ['admin', 'superadmin', 'mail_agent'] })
  if (!a.ok || !a.id) return { ok: false, userId: null, name: null }
  const role = (session?.user as any)?.role || a.roles[0] || null
  const on = await isPreviewOn('courrier', role, a.id)
  return { ok: on, userId: a.id, name: (session?.user as any)?.name || null }
}
