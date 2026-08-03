import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import ConvocationsClient from './ConvocationsClient'

export const dynamic = 'force-dynamic'
const ALLOWED = ['admin', 'superadmin', 'dispatcher']

export default async function ConvocationsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const roleOk = ALLOWED.includes(u.role) || (Array.isArray(u.roles) && u.roles.some((r: string) => ALLOWED.includes(r)))
  if (!roleOk) redirect('/dashboard')
  const sb = createAdminClient()
  const uid = u.id
  const { data: user } = uid
    ? await sb.from('users').select('id, role, name').eq('id', uid).single()
    : await sb.from('users').select('id, role, name').ilike('email', u.email).single()
  return <ConvocationsClient userRole={user?.role || ''} userName={user?.name || ''} userModules={(u as any).modules ?? []} />
}
