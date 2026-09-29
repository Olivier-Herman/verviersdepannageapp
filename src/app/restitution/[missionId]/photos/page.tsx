// src/app/restitution/[missionId]/photos/page.tsx — ouverte par la notification envoyée
// depuis le PC : documents du transporteur ou photos diverses, en rafale, rangés au dossier.
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import AppShell             from '@/components/layout/AppShell'
import PhotosPhoneClient    from './PhotosPhoneClient'

export const dynamic = 'force-dynamic'

export default async function RestitutionPhotosPage({ params, searchParams }: { params: { missionId: string }; searchParams: { type?: string } }) {
  const type = searchParams?.type === 'divers' ? 'divers' : 'transport'
  const session = await getServerSession(authOptions)
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(`/restitution/${params.missionId}/photos?type=${type}`)}`)
  const u = session.user as any
  return (
    <AppShell title={type === 'divers' ? 'Photos du véhicule' : 'Documents du transporteur'} userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={u.role || ''} userModules={u.modules || []}>
      <PhotosPhoneClient missionId={params.missionId} type={type} />
    </AppShell>
  )
}
