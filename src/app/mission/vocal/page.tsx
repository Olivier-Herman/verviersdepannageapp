// /mission/vocal — assistant vocal chauffeur (pilote : flag voice_assistant). Olivier 20/09/2026.
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isPreviewOn }       from '@/lib/feature-flags'
import AppShell              from '@/components/layout/AppShell'
import VocalClient           from './VocalClient'

export const dynamic = 'force-dynamic'

export default async function VocalPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const role = String(user.role || '')
  const roles: string[] = Array.isArray(user.roles) ? user.roles : []
  const isDriver = role === 'driver' || roles.includes('driver') || ['admin', 'superadmin', 'dispatcher'].includes(role)
  if (!isDriver) redirect('/mission')
  if (role !== 'superadmin' && !(await isPreviewOn('voice_assistant', role, user.id))) redirect('/mission')

  const sb = createAdminClient()
  const [{ data: zones }, { data: missions }] = await Promise.all([
    sb.from('police_zones').select('name').eq('active', true).order('sort_order', { ascending: true }),
    sb.from('incoming_missions').select('id, mission_number, status, vehicle_plate, vehicle_brand, vehicle_model, incident_city, incident_address')
      .eq('assigned_to', user.id).in('status', ['assigned', 'accepted', 'in_progress', 'delivering']).order('assigned_at', { ascending: false }).limit(10),
  ])
  const zoneNames = (zones || []).map((z: any) => z.name).filter(Boolean)
  const active = (missions || []).map((m: any) => ({
    id: m.id, plate: m.vehicle_plate || '', status: m.status,
    label: `#${m.mission_number} ${[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')} ${m.incident_city || m.incident_address || ''}`.trim(),
  }))
  return (
    <AppShell title="Assistant vocal" userName={user.name || ''} userRole={role} userId={user.id} userModules={user.modules ?? []}>
      <VocalClient zones={zoneNames} active={active} firstName={String(user.name || '').split(' ')[0]} />
    </AppShell>
  )
}
