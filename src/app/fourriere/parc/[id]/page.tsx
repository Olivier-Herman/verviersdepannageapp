// src/app/fourriere/parc/[id]/page.tsx
//
// Olivier 2026-06-03 : vue inventaire d un parc precis (depot).
// Reprend l ancienne home /fourriere mais filtree sur un depot_id et avec
// TOUTES les zones du parc affichees (meme celles a 0 vehicule).

import { getServerSession }  from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import ParcInventaireClient  from './ParcInventaireClient'

export const dynamic = 'force-dynamic'

export default async function ParcPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const { data: depot } = await sb
    .from('depots')
    .select('id, name, address, is_default_parc')
    .eq('id', params.id)
    .single()

  if (!depot) notFound()

  // Toutes les zones de ce parc (y compris celles à 0 véhicule)
  const { data: zones } = await sb
    .from('parc_zones')
    .select('key, label, sort_order')
    .eq('depot_id', params.id)
    .eq('active', true)
    .order('sort_order')

  return (
    <ParcInventaireClient
      depot={depot}
      depotZones={(zones || []).map(z => ({ key: z.key, label: z.label }))}
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={modules}
    />
  )
}
