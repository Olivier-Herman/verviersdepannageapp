// src/lib/taches/access.ts — qui a le droit de prendre un véhicule en charge :
// le module Fourrière, ou admin/superadmin. Le flag `taches_accident` gate
// l'écran (pilote : superadmins + Jona) le temps du premier jet.

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { sessionAccess } from '@/lib/access'
import { isPreviewOn } from '@/lib/feature-flags'

export async function tachesAccess(): Promise<{ ok: boolean; userId: string | null; role: string | null }> {
  const session = await getServerSession(authOptions)
  const a = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  if (!a.ok) return { ok: false, userId: null, role: null }
  const role = (session?.user as any)?.role || a.roles[0] || null
  const on = await isPreviewOn('taches_accident', role, a.id)
  return { ok: on, userId: a.id, role }
}
