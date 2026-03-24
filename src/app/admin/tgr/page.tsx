// src/app/admin/tgr/page.tsx
export const dynamic = 'force-dynamic'

import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { redirect }         from 'next/navigation'
import { createAdminClient }from '@/lib/supabase'
import AdminTGRClient       from './AdminTGRClient'

export default async function AdminTGRPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const isAdmin = ['admin', 'superadmin', 'dispatcher'].includes((session.user as any).role)
  if (!isAdmin) redirect('/dashboard')

  const supabase = createAdminClient()

  const { data: missions } = await supabase
    .from('tgr_missions')
    .select('*, partner:users!partner_id(name, email), acceptedBy:users!accepted_by(name)')
    .order('created_at', { ascending: false })
    .limit(200)

  return <AdminTGRClient missions={missions || []} />
}
