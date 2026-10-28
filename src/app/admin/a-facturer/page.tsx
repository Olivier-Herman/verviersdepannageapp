// src/app/admin/a-facturer/page.tsx — « À facturer — pourquoi ça bloque » (Olivier 28/10/2026) : visible par lui seul.
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { peutBasculer } from '@/lib/facturation/suspension'
import AppShell from '@/components/layout/AppShell'
import AFacturerClient from './AFacturerClient'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  if (!(await peutBasculer(u.id))) redirect('/admin?error=access_denied')
  return (
    <AppShell title="À facturer — pourquoi ça bloque" userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userId={u.id} userModules={u.modules || []}>
      <AFacturerClient />
    </AppShell>
  )
}
