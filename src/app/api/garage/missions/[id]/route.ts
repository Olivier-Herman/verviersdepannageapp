// GET /api/garage/missions/[id] : detail mission (filtre par garage du user).
// Olivier 2026-06-02.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role
  if (role !== 'garage') return NextResponse.json({ error: 'Reserve garage' }, { status: 403 })

  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d identite' }, { status: 401 })

  const sb = createAdminClient()
  const { data: mission, error } = await sb
    .from('incoming_missions')
    .select(`
      id, mission_number, status, mission_type,
      vehicle_plate, vehicle_brand, vehicle_model,
      incident_address, client_phone,
      received_at, assigned_at, accepted_at, on_way_at, on_site_at, loaded_at, completed_at,
      remarks_general,
      photos_visible_to_garage, driver_photos,
      requested_by_garage_id
    `)
    .eq('id', params.id)
    .maybeSingle()

  if (error || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Verif que ce garage est bien lie au user
  const { data: link } = await sb
    .from('garage_user_partners')
    .select('user_id')
    .eq('user_id', userId)
    .eq('garage_partner_id', mission.requested_by_garage_id || '')
    .maybeSingle()
  if (!link) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  return NextResponse.json({ mission })
}
