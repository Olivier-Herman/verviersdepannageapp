// src/app/restitution/[missionId]/page.tsx — parcours de restitution unifié (Olivier 28/09/2026).
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import AppShell             from '@/components/layout/AppShell'
import RestitutionClient    from './RestitutionClient'

export const dynamic = 'force-dynamic'

export default async function RestitutionPage({ params }: { params: { missionId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  return (
    <AppShell title="Restitution" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={u.role || ''} userModules={u.modules || []}>
      <RestitutionClient missionId={params.missionId} gmKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''} />
    </AppShell>
  )
}
