import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import VerifyCodeClient from './VerifyCodeClient'

export const dynamic = 'force-dynamic'

export default async function VerifierCodePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const sb = createAdminClient()
  const userId = (session.user as any).id
  const { data: user } = userId
    ? await sb.from('users').select('id, name, role, verify_pin_hash').eq('id', userId).single()
    : await sb.from('users').select('id, name, role, verify_pin_hash').ilike('email', session.user.email!).single()

  const modules = (session.user as any).modules ?? []
  return <VerifyCodeClient
    userName={user?.name || ''}
    userRole={user?.role || ''}
    userModules={modules}
    hasPin={!!user?.verify_pin_hash}
  />
}
