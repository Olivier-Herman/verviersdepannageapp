// src/app/admin/page.tsx
//
// Page Réglages (ex-Administration), option C validée par Olivier le 11/11/2026 :
// recherche, « Au quotidien », 8 rubriques, « Rangé ». Le contenu vient du catalogue
// unique src/lib/admin/reglages.ts ; ici on ne calcule que l'accès et les alertes.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { readAxaHealth, axaDownSince } from '@/lib/axa/health'
import { isPreviewOn }       from '@/lib/feature-flags'
import ReglagesClient        from './ReglagesClient'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const isAdmin = ['admin', 'superadmin'].some(r => (user.roles || [user.role]).includes(r))
  if (!isAdmin) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const [obd, axaHealth, srcMissing] = await Promise.all([
    isPreviewOn('obd_diagnostic', user.role, user.id),
    readAxaHealth(sb).catch(() => null),
    sb.from('mission_source_catalog').select('*', { count: 'exact', head: true }).eq('active', true).is('default_billed_to_id', null)
      .then(r => r.count || 0, () => 0),
  ])

  // Alertes à traiter, rattachées à la page qui les règle (affichées en tête et sur l'écran).
  const alertes: Record<string, string> = {}
  if (axaHealth && !axaHealth.ok) alertes['/admin/axa'] = `AXA go&assist déconnecté ${axaDownSince(axaHealth)} : réamorcer la connexion`
  if (srcMissing > 0) alertes['/admin/sources'] = `${srcMissing} source${srcMissing > 1 ? 's' : ''} sans client facturé par défaut`

  return <ReglagesClient superadmin={user.role === 'superadmin'} obd={obd} alertes={alertes} />
}
