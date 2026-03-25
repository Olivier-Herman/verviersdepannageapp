// src/app/dispatch/[id]/page.tsx

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import MissionDetailClient   from './MissionDetailClient'

export default async function MissionDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const hasAccess = ['admin', 'superadmin', 'dispatcher'].some(r =>
    (user.roles || [user.role]).includes(r)
  )
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  const supabase = createAdminClient()

  // Mission complète avec logs
  const { data: mission } = await supabase
    .from('incoming_missions')
    .select(`
      *,
      assigned_user:users!assigned_to(id, name, avatar_url)
    `)
    .eq('id', params.id)
    .single()

  if (!mission) redirect('/dispatch')

  // Logs de la mission
  const { data: logs } = await supabase
    .from('mission_logs')
    .select('*, actor:users!actor_id(name)')
    .eq('mission_id', params.id)
    .order('created_at', { ascending: false })

  // Chauffeurs actifs
  const { data: drivers } = await supabase
    .from('users')
    .select('id, name, avatar_url')
    .eq('active', true)
    .in('role', ['driver', 'admin', 'superadmin'])
    .order('name')

  return (
    <MissionDetailClient
      mission={mission}
      logs={logs || []}
      drivers={drivers || []}
      userName={user.name || ''}
      userRole={user.role || ''}
    />
  )
}
