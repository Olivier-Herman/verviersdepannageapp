// src/app/api/francofolies/list/route.ts
//
// GET /api/francofolies/list?q=&scope=pending|all
//   Liste des véhicules Francofolies (source='francofolies').
//   - pending (défaut) : encore en parc (pas encore enlevés/encaissés)
//   - all              : tout (avec statut)

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  const role = u.role || ''
  const roles: string[] = Array.isArray(u.roles) ? u.roles : [role]
  const modules: string[] = u.modules || []
  return ['admin', 'superadmin', 'dispatcher'].some(r => role === r || roles.includes(r))
    || modules.includes('francofolies')
    || roles.includes('driver') || roles.includes('chauffeur')
}

const norm = (s: string) => (s || '').replace(/[-.\s_]/g, '').toUpperCase()

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const q     = (searchParams.get('q') || '').trim()
  const scope = searchParams.get('scope') || 'pending'

  const sb = createAdminClient()
  let query = sb
    .from('incoming_missions')
    .select(`id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, status,
             amount_to_collect, parked_at, received_at, remarks_general, assigned_to,
             assigned_user:users!assigned_to(id, name)`)
    .eq('source', 'francofolies')
    .not('status', 'in', '(cancelled,ignored)')
    .order('parked_at', { ascending: false, nullsFirst: false })
    .limit(500)

  // pending = encore à enlever (en parc, pas encore facturé/clôturé)
  if (scope !== 'all') query = query.eq('status', 'parked')

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let rows = data || []
  if (q) {
    const nq = norm(q)
    rows = rows.filter((m: any) =>
      norm(m.vehicle_plate || '').includes(nq)
      || (m.vehicle_brand || '').toUpperCase().includes(q.toUpperCase())
      || (m.vehicle_model || '').toUpperCase().includes(q.toUpperCase()))
  }

  return NextResponse.json({ ok: true, count: rows.length, rows })
}
