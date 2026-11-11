// /admin/preversions — Réglages › Général › Préversions › Nouveautés en test (Olivier 11/11/2026).
// Le panneau des préversions vivait au bas de Paramètres ; il a son onglet, à côté de Flux 2.
// Superadmin seulement, comme le panneau et son API.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import FeatureFlagsPanel    from '@/components/admin/FeatureFlagsPanel'

export const dynamic = 'force-dynamic'

export default async function PreversionsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if ((session.user as any).role !== 'superadmin') redirect('/admin')
  return (
    <div className="px-4 py-5 lg:px-0 lg:py-2 max-w-4xl space-y-3">
      <p className="text-ink-muted text-sm">
        Nouveaux écrans en test : pour chacun, choisir qui le voit (personne, vous et les pilotes, ou tout le monde). Effet immédiat, sans mise à jour.
      </p>
      <FeatureFlagsPanel />
    </div>
  )
}
