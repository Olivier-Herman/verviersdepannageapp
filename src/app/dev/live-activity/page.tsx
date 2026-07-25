// src/app/dev/live-activity/page.tsx
// Page de TEST de la Live Activity (superadmin). À ouvrir DANS l'app iOS pour
// déclencher/mettre à jour/terminer une Live Activity de démo. Olivier 2026-07-28.
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { redirect }         from 'next/navigation'
import LiveActivityDevClient from './LiveActivityDevClient'

export const dynamic = 'force-dynamic'

export default async function LiveActivityDevPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if ((session.user as any).role !== 'superadmin') redirect('/dashboard')
  return <LiveActivityDevClient />
}
