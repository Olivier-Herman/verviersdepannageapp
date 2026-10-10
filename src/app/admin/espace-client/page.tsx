import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import EspaceClientAdmin from './EspaceClientAdmin'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const s = await getServerSession(authOptions)
  const u = s?.user as any
  if (!u) redirect('/login')
  const roles: string[] = [u.role, ...(u.roles || [])]
  // Le dispatch voit seulement les véhicules VD Assistance, pour réaffecter un garage (Olivier 10/10/2026).
  const admin = roles.some(r => r === 'admin' || r === 'superadmin')
  if (!admin && !roles.includes('dispatcher')) redirect('/dashboard?error=access_denied')
  return <EspaceClientAdmin dispatchSeul={!admin} />
}
