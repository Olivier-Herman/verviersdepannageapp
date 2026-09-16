// Suivi & relance des réquisitoires manquants (fourrière / saisie).
// Liste les saisies sans réquisitoire reçu, avec l'indicateur « email policier
// connu (Odoo) » + boutons d'action. Olivier 2026-08-08.

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import { loadRelanceItems }  from '@/lib/requisitoire/relance-items'
import RelanceRequisitoireClient from './RelanceRequisitoireClient'

export const dynamic = 'force-dynamic'

// « EN PARC » = mêmes statuts que la recherche fourrière (ACTIVE_PARC_STATUSES).
// On ne relance PAS un réquisitoire pour un véhicule déjà sorti / restitué /
// facturé. Olivier 2026-08-08.
const PARC_STATUSES = ['parked', 'delivering', 'unlocated', 'awaiting_payment']

export default async function RelanceRequisitoirePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const roles = [user.role, ...(Array.isArray(user.roles) ? user.roles : [])].filter(Boolean)
  const modules: string[] = user.modules || []
  const hasAccess = roles.some((r: string) => ['admin', 'superadmin'].includes(r)) || modules.includes('fourriere')
  if (!hasAccess) redirect('/dashboard?error=fourriere_required')

  const sb = createAdminClient()
  const items = await loadRelanceItems(sb)

  return <RelanceRequisitoireClient initialItems={items} appUrl={process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'} />
}
