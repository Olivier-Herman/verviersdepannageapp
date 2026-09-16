// src/app/fourriere/requisitoires/page.tsx
//
// File d'attente des réquisitoires capturés automatiquement dans fourriere@ :
// Claude lit la PJ PDF → propose la/les fiche(s) candidate(s) → un humain
// rattache. Aucune annexion automatique (Option A). Olivier 2026-07-01.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import RequisitoiresClient  from './RequisitoiresClient'
import DocumentsClient      from './DocumentsClient'
import { isPreviewOn }      from '@/lib/feature-flags'
import { createAdminClient } from '@/lib/supabase'
import { loadRelanceItems } from '@/lib/requisitoire/relance-items'

export const dynamic = 'force-dynamic'

export default async function RequisitoiresPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/requisitoires')

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess = ['admin', 'superadmin'].includes(role) || modules.includes('fourriere')
  if (!hasAccess) redirect('/dashboard?error=fourriere_required')

  // Refonte Fourrière temps 2 (16/09/2026) : écran Documents (reçus à rattacher +
  // manquants) pour les pilotes ; les autres gardent la file d'attente seule.
  if (await isPreviewOn('fourriere_v2', role, user.id)) {
    const sb = createAdminClient()
    const [relanceItems, pending] = await Promise.all([
      loadRelanceItems(sb),
      sb.from('requisitoire_intake').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ])
    return <DocumentsClient userRole={role} userName={user.name || ''} userEmail={user.email || ''} userModules={modules} relanceItems={relanceItems} pendingCount={pending.count || 0} appUrl={process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'} />
  }
  return (
    <RequisitoiresClient
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={modules}
    />
  )
}
