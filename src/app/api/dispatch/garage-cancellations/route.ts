// GET /api/dispatch/garage-cancellations : liste des demandes d annulation
// garage en attente (pour l UI dispatch). Olivier 2026-06-02.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function isDispatcherOrAdmin(session: any): boolean {
  const role: string = session?.user?.role || ''
  const roles: string[] = Array.isArray(session?.user?.roles) ? session.user.roles : []
  const all = [role, ...roles]
  return all.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isDispatcherOrAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'pending'

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('garage_cancellation_requests')
    .select(`
      id, mission_id, requested_at, reason, status, decided_at, decision_note,
      garage_partners ( id, name ),
      incoming_missions ( id, mission_number, mission_type, vehicle_plate, vehicle_brand, vehicle_model, status, accepted_at, on_way_at )
    `)
    .eq('status', status)
    .order('requested_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ requests: data || [] })
}
