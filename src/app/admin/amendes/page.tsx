// /admin/amendes : liste, filtres, stats des amendes.
// Olivier 2026-06-01. Reserve admin/superadmin/facturation.

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AdminAmendesClient    from './AdminAmendesClient'

export const dynamic = 'force-dynamic'

export default async function AdminAmendesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const hasAccess = ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const { data: fines } = await sb
    .from('fines')
    .select(`
      id, photo_url,
      infraction_date, infraction_place, infraction_type, infraction_ref, identification_code,
      amount, plate,
      driver_id, driver_match_method, driver_match_confidence,
      mission_id, status, notes,
      odoo_move_id, odoo_move_name, odoo_move_status,
      purchase_email_sent, purchase_email_sent_at,
      created_at,
      driver:users!fines_driver_id_fkey(id, name, email),
      created_by_user:users!fines_created_by_fkey(name),
      mission:incoming_missions!fines_mission_id_fkey(id, mission_number, external_id, dossier_number)
    `)
    .order('infraction_date', { ascending: false })
    .limit(500)

  // Liste de tous les chauffeurs (pour le filtre)
  const { data: drivers } = await sb
    .from('users')
    .select('id, name')
    .or('role.in.(driver,dispatcher,admin,superadmin),roles.ov.{driver,dispatcher,admin,superadmin}')
    .eq('active', true)
    .order('name')

  return <AdminAmendesClient
    fines={(fines as any[]) || []}
    drivers={drivers || []}
    userRole={role}
    userName={user.name || ''}
    userModules={modules}
  />
}
