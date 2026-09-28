// src/app/restitution/[missionId]/piece/page.tsx — ouverte par la notification envoyée
// depuis le PC : photo recto/verso de la pièce d'identité, rangée dans le dossier.
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import AppShell             from '@/components/layout/AppShell'
import PiecePhoneClient     from './PiecePhoneClient'

export const dynamic = 'force-dynamic'

export default async function PiecePage({ params }: { params: { missionId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect(`/login?callbackUrl=/restitution/${params.missionId}/piece`)
  const u = session.user as any
  return (
    <AppShell title="Pièce d’identité" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={u.role || ''} userModules={u.modules || []}>
      <PiecePhoneClient missionId={params.missionId} />
    </AppShell>
  )
}
