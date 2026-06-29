// src/app/francofolies/page.tsx
//
// Module Francofolies — mal garée évènementiel (Francofolies de Spa).
// Encodage ultra-rapide à l'arrivée + enlèvement client. Olivier 2026-06-24.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import FrancofoliesClient    from './FrancofoliesClient'

export const dynamic = 'force-dynamic'

export default async function FrancofoliesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const u = session.user as any
  const role = u.role || ''
  const roles: string[] = Array.isArray(u.roles) ? u.roles : [role]
  const modules: string[] = u.modules || []
  const isStaff  = ['admin', 'superadmin', 'dispatcher'].some(r => role === r || roles.includes(r)) || modules.includes('francofolies')
  const isDriver = roles.includes('driver') || roles.includes('chauffeur')
  const hasAccess = isStaff || isDriver
  if (!hasAccess) redirect('/dashboard?error=access_denied')
  // Chauffeur "pur" (pas staff) → ne choisit pas, c'est forcément lui.
  const isDriverOnly = isDriver && !isStaff

  const sb = createAdminClient()
  const [{ data: drivers }, { data: settings }] = await Promise.all([
    sb.from('users').select('id, name')
      .or('role.eq.driver,roles.cs.{driver}')
      .eq('active', true)
      .order('name'),
    sb.from('app_settings').select('key, value').in('key', ['francofolies_price', 'francofolies_gardiennage_price']),
  ])
  const sMap = Object.fromEntries((settings || []).map(s => [s.key, s.value]))

  return (
    <FrancofoliesClient
      userRole={role}
      userName={u.name || ''}
      userEmail={u.email || undefined}
      userModules={modules}
      currentUserId={u.id || ''}
      isDriverOnly={isDriverOnly}
      drivers={isDriverOnly
        ? [{ id: u.id || '', name: u.name || 'Moi' }]
        : (drivers || []).map(d => ({ id: d.id, name: d.name || 'Sans nom' }))}
      price={Number(sMap.francofolies_price || 220)}
      gardiennagePrice={Number(sMap.francofolies_gardiennage_price || 20)}
    />
  )
}
