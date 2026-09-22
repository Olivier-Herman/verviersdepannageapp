// src/app/missions/chauffeur/page.tsx
//
// « Missions par chauffeur » (Olivier 22/09/2026) : on choisit un chauffeur, on
// voit toutes ses missions, la plus récente en haut. Accès dispatch / admin.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import ChauffeurMissionsClient from './ChauffeurMissionsClient'

export const dynamic = 'force-dynamic'

export default async function MissionsParChauffeurPage({ searchParams }: { searchParams?: { driver?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const role: string = u.role || ''
  const roles: string[] = u.roles || [role]
  const modules: string[] = u.modules || []
  const ok = ['admin', 'superadmin', 'dispatcher'].some(r => role === r || roles.includes(r)) || modules.includes('missions') || modules.includes('dispatch')
  if (!ok) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const [{ data: drivers }, { data: catalogSources }] = await Promise.all([
    sb.from('users').select('id, name, active').or('role.in.(driver),roles.ov.{driver}').order('active', { ascending: false }).order('name'),
    sb.from('mission_source_catalog').select('key, label, display_color, group_key').eq('active', true).order('label'),
  ])

  return (
    <ChauffeurMissionsClient
      drivers={(drivers || []).map(d => ({ id: d.id, name: d.name || '—', active: d.active !== false }))}
      catalogSources={catalogSources || []}
      initialDriver={searchParams?.driver || ''}
      userRole={role} userName={u.name || ''} userEmail={u.email || ''} userId={u.id || ''} userModules={modules}
    />
  )
}
