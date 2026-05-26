// src/app/api/admin/archives/route.ts
//
// GET  /api/admin/archives[?source=touring&q=plaque&page=1] → liste paginee
// POST /api/admin/archives/unarchive → desarchive une mission

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: 'Unauthorized', status: 401 } as const
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return { error: 'Forbidden', status: 403 } as const
  }
  return { user } as const
}

export async function GET(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url    = new URL(req.url)
  const source = url.searchParams.get('source') || ''
  const q      = (url.searchParams.get('q') || '').trim()
  const page   = Math.max(1, Number(url.searchParams.get('page') || '1'))

  const sb = createAdminClient()
  let query = sb
    .from('incoming_missions')
    .select('id, mission_number, external_id, dossier_number, source, status, vehicle_plate, vehicle_brand, vehicle_model, client_name, intervention_date, completed_at, invoiced_at, invoice_number, invoice_method, archived_at', { count: 'exact' })
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (source) query = query.eq('source', source)
  if (q) {
    query = query.or([
      `external_id.ilike.%${q}%`,
      `dossier_number.ilike.%${q}%`,
      `client_name.ilike.%${q}%`,
      `vehicle_plate.ilike.%${q}%`,
    ].join(','))
  }

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sources distinctes pour le filtre
  const { data: sources } = await sb
    .from('incoming_missions')
    .select('source')
    .not('archived_at', 'is', null)
    .not('source', 'is', null)
    .limit(1000)
  const uniqueSources = Array.from(new Set((sources || []).map(s => s.source).filter(Boolean)))

  return NextResponse.json({
    missions: data || [],
    total:    count || 0,
    page,
    pageSize: PAGE_SIZE,
    sources:  uniqueSources.sort(),
  })
}
