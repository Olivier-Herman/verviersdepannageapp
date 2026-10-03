// src/app/admin/sam-echanges/page.tsx
//
// Échanges des chauffeurs avec Sam / Sonic (Olivier 03/10/2026) : toutes les
// conversations terminées, avec ou sans mission. Superadmin seulement ; le
// bureau et le dispatch les voient sur la fiche de la mission. Chaque lecture
// est journalisée.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import SamConversations     from '@/components/sam/SamConversations'

export const dynamic = 'force-dynamic'

export default async function SamEchangesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const roles: string[] = Array.isArray(u.roles) ? u.roles : []
  if (u.role !== 'superadmin' && !roles.includes('superadmin')) redirect('/admin?error=access_denied')
  return (
    <div className="space-y-4 max-w-4xl">
        <h1 className="text-ink font-bold text-2xl">Échanges Sam / Sonic</h1>
        <p className="text-ink-muted text-sm">Conversations terminées des chauffeurs avec Sam (le jour) et Sonic (la nuit), avec ou sans mission. Les 200 plus récentes. Conservées 12 mois ; le résumé reste ensuite.</p>
        <SamConversations all showDriver />
      </div>
  )
}
