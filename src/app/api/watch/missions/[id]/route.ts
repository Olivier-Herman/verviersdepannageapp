// src/app/api/watch/missions/[id]/route.ts
//
// GET /api/watch/missions/:id
// Auth : Authorization: Bearer <watch-jwt>
//
// Detail mission allege (pas de photos, pas de raw_content, pas de discharge
// data — la Watch n affiche que les infos essentielles + actions). Pour le
// detail complet (encaissement, photos, signatures), l user passe sur iPhone.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyWatchAuth }   from '@/lib/auth-watch'

export const dynamic = 'force-dynamic'

const DETAIL_FIELDS = [
  'id', 'external_id', 'status', 'mission_type', 'source',
  'client_name', 'client_phone',
  'vehicle_plate', 'vehicle_brand', 'vehicle_model',
  'incident_city', 'incident_address', 'incident_lat', 'incident_lng',
  'destination_address', 'destination_name',
  'extra_addresses',
  'amount_to_collect', 'payment_collected_at', 'payment_amount', 'payment_mode',
  'received_at', 'intervention_date',
  'assigned_at', 'assigned_to', 'accepted_at', 'on_way_at', 'on_site_at',
  'loaded_at', 'delivering_at', 'parked_at', 'completed_at',
].join(',')

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const userId = await verifyWatchAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = params.id
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('incoming_missions')
    .select(DETAIL_FIELDS)
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Securite : un chauffeur ne peut voir que ses propres missions.
  // Un dispatcher/admin peut voir n importe laquelle.
  const { data: user } = await sb
    .from('users').select('role, roles').eq('id', userId).single()
  const roles = Array.isArray(user?.roles) ? user!.roles as string[] : [user?.role].filter(Boolean) as string[]
  const isDispatcher = roles.some(r => r === 'dispatcher' || r === 'admin' || r === 'superadmin')

  if (!isDispatcher && (data as any).assigned_to !== userId) {
    return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })
  }

  return NextResponse.json({ ok: true, mission: data })
}
