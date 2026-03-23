export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AdminCashClient from './AdminCashClient'

export default async function AdminCashPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!['admin', 'superadmin'].includes(session.user.role)) redirect('/dashboard')

  const supabase = createAdminClient()

  const { data: drivers } = await supabase
    .from('users')
    .select('id, name, email, role')
    .in('role', ['driver', 'dispatcher', 'admin', 'superadmin'])
    .eq('active', true)
    .order('name')

  const { data: entries } = await supabase
    .from('cash_register')
    .select('*, driver:users!cash_register_driver_id_fkey(name, email), verifier:users!cash_register_verified_by_fkey(name)')
    .order('created_at', { ascending: false })
    .limit(200)

  return <AdminCashClient drivers={drivers || []} entries={entries || []} />
}
