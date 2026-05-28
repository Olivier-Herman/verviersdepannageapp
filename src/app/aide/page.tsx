// src/app/aide/page.tsx
// Section Aide : modes d'emploi pour chaque profil utilisateur.
// Olivier 2026-05-28 — Section consultable en ligne, filtree par role.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import AideClient            from './AideClient'

export const dynamic = 'force-dynamic'

export default async function AidePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/aide')

  const user = session.user as any
  const userRoles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const userModules: string[] = Array.isArray(user.modules) ? user.modules : []

  // Determine quels modes d'emploi sont pertinents pour cet user
  const isAdmin       = userRoles.some(r => ['admin', 'superadmin'].includes(r))
  const isDispatcher  = userRoles.includes('dispatcher')
  const isDriver      = userRoles.includes('driver')
  const hasFourriere  = userModules.includes('fourriere')
  const hasFacturation = userModules.includes('facturation')

  // Liste des guides disponibles selon le profil. Les admins/superadmin voient tout.
  const guides: { id: string; title: string; file: string; description: string }[] = []
  if (isDriver || isAdmin)      guides.push({ id: 'driver',                 title: '🚗 Chauffeur',                file: '/aide/driver.html',                 description: 'Création de missions, workflow terrain, encaissement, scan QR' })
  if (isDispatcher || isAdmin)  guides.push({ id: 'dispatcher',             title: '📡 Dispatcher',               file: '/aide/dispatcher.html',             description: 'Vue globale, gestion missions, création, assignation, auto-dispatch' })
  if (hasFourriere || hasFacturation || isAdmin) {
    guides.push({ id: 'fourriere-facturation', title: '🚓 Fourrière & 🧾 Facturation', file: '/aide/fourriere-facturation.html', description: 'Inventaire parc, transferts, restitution, devis Odoo, encaissement bureau' })
  }

  return <AideClient
    guides={guides}
    userName={user.name || ''}
  />
}
