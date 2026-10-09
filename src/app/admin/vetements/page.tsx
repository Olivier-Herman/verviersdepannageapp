// /admin/vetements — commande pulls et t-shirts (module temporaire, Olivier 09/10/2026).
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import VetementsClient      from './VetementsClient'

export const dynamic = 'force-dynamic'

export default async function VetementsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!sessionAccess(session).ok) redirect('/dashboard')
  return <VetementsClient />
}
