import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import EspaceClientAdmin from './EspaceClientAdmin'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const s = await getServerSession(authOptions)
  const u = s?.user as any
  if (!u) redirect('/login')
  if (![u.role, ...(u.roles || [])].some((r: string) => r === 'admin' || r === 'superadmin')) redirect('/dashboard?error=access_denied')
  return <EspaceClientAdmin />
}
