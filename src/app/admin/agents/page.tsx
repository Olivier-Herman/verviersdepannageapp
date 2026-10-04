// src/app/admin/agents/page.tsx
//
// Propositions des agents HOOS dédiés à VD (lot 1, Olivier 05/10/2026) :
// les agents préparent, la personne désignée valide, VD Soft exécute.
// Admins et superadmins ; seuls Mobi et le validateur désigné décident.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import AgentsClient         from './AgentsClient'

export const dynamic = 'force-dynamic'

export default async function AgentsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const roles: string[] = [u.role, ...(Array.isArray(u.roles) ? u.roles : [])]
  if (!roles.some(r => r === 'admin' || r === 'superadmin')) redirect('/admin?error=access_denied')
  return <AgentsClient />
}
