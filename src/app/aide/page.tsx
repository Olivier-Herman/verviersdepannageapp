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

  // Determine quels modes d'emploi sont pertinents pour cet user.
  // Le role 'support' donne acces a TOUS les guides sans avoir les droits admin
  // (cas Jona : backup support utilisateurs sans privileges admin).
  const isAdmin       = userRoles.some(r => ['admin', 'superadmin'].includes(r))
  const isSupport     = userRoles.includes('support')
  const seeAll        = isAdmin || isSupport
  const isDispatcher  = userRoles.includes('dispatcher')
  const isDriver      = userRoles.includes('driver')
  const hasFourriere  = userModules.includes('fourriere')
  const hasFacturation = userModules.includes('facturation')

  const guides: { id: string; title: string; file: string; description: string }[] = []
  if (isDriver || seeAll)      guides.push({ id: 'driver',                 title: '🚗 Chauffeur',                file: '/aide/driver.html',                 description: 'Création de missions, workflow terrain, encaissement, scan QR' })
  if (isDispatcher || seeAll)  guides.push({ id: 'dispatcher',             title: '📡 Dispatcher',               file: '/aide/dispatcher.html',             description: 'Vue globale, gestion missions, création, assignation' })
  if (hasFourriere || hasFacturation || seeAll) {
    guides.push({ id: 'fourriere-facturation', title: '🚓 Fourrière & 🧾 Facturation', file: '/aide/fourriere-facturation.html', description: 'Inventaire parc, transferts, restitution, devis, encaissement bureau' })
  }

  // Grilles tarifaires officielles : ce ne sont pas des modes d'emploi mais des
  // documents qu'on sort devant un client qui conteste un montant. Tout le monde
  // y a droit — un chauffeur se fait demander le prix au bord de la route aussi
  // souvent que le bureau au telephone. Olivier 2026-08-21.
  guides.push({
    id: 'tarifs-saisies',
    title: '⚖️ Tarifs saisies judiciaires',
    file: '/docs/tarifs-saisies-judiciaires-2026.pdf',
    description: 'Circulaire 131/13 du 16/01/2026 — enlevement, km, gardiennage, frais de dossier',
  })
  guides.push({
    id: 'tarifs-siabis',
    title: '🛣️ Tarifs SIABIS+',
    file: '/docs/tarifs-siabis-2026.pdf',
    description: 'Reseau structurant wallon — depannage, balisage, supplements, gardiennage',
  })

  return <AideClient
    guides={guides}
    userName={user.name || ''}
  />
}
