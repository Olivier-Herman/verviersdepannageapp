import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import { canUseMatthieu } from '@/lib/mecano/access'
import MatthieuClient from './MatthieuClient'

export const dynamic = 'force-dynamic'

export default async function MatthieuPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const sb = createAdminClient()
  const uid = (session.user as any).id
  const { data: user } = uid
    ? await sb.from('users').select('id, role, name').eq('id', uid).single()
    : await sb.from('users').select('id, role, name').ilike('email', session.user!.email!).single()
  if (!canUseMatthieu(user?.role, user?.id)) redirect('/login')
  const modules = (session.user as any).modules ?? []
  return <MatthieuClient userRole={user?.role || ''} userName={user?.name || ''} userModules={modules} />
}
