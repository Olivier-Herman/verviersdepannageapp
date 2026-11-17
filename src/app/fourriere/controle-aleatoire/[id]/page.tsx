// src/app/fourriere/controle-aleatoire/[id]/page.tsx — contrôle aléatoire du parc (Olivier 17/11/2026) : scans un par un
// sur le téléphone, puis recherche des véhicules pas trouvés au bureau. Maquette 1DStEWrJtFLfHRLRe3E2Dv validée.
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import AppShell             from '@/components/layout/AppShell'
import ControleAleatoireClient from './ControleAleatoireClient'

export const dynamic = 'force-dynamic'

export default async function ControleAleatoirePage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect(`/login?callbackUrl=/fourriere/controle-aleatoire/${params.id}`)
  const a = sessionAccess(session, { roles: ['admin', 'superadmin', 'dispatcher'], modules: ['fourriere'] })
  if (!a.ok) redirect('/dashboard?error=fourriere_required')
  const u = session.user as any
  const { data: zones } = await createAdminClient().from('parc_zones').select('key, label, sort_order').order('sort_order')
  return (
    <AppShell title="Contrôle du parc" userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userId={u.id} userModules={u.modules || []}>
      <ControleAleatoireClient id={params.id} zones={(zones || []).filter((z: any) => z.key !== 'T').map((z: any) => String(z.key))} />
    </AppShell>
  )
}
