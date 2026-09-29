// src/app/courrier/page.tsx — module Courrier (Olivier, maquette v2 validée le 29/09/2026).
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import AppShell             from '@/components/layout/AppShell'
import { courrierAccess }   from '@/lib/courrier/access'
import CourrierClient       from './CourrierClient'

export const dynamic = 'force-dynamic'

export default async function CourrierPage({ searchParams }: { searchParams: { c?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/courrier')
  const a = await courrierAccess()
  if (!a.ok) redirect('/dashboard')
  const u = session.user as any
  return (
    <AppShell title="Courrier" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={u.role || ''} userModules={u.modules || []}>
      <CourrierClient initialId={searchParams?.c || null} />
    </AppShell>
  )
}
