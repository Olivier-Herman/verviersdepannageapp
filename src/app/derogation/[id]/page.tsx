// src/app/derogation/[id]/page.tsx — le responsable valide une dérogation avec son code
// (ouvert depuis la notification sur son téléphone). Olivier 28/09/2026.
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import AppShell             from '@/components/layout/AppShell'
import DerogationClient     from './DerogationClient'

export const dynamic = 'force-dynamic'

export default async function DerogationPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect(`/login?callbackUrl=/derogation/${params.id}`)
  const u = session.user as any
  return (
    <AppShell title="Dérogation" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={u.role || ''} userModules={u.modules || []}>
      <DerogationClient id={params.id} />
    </AppShell>
  )
}
