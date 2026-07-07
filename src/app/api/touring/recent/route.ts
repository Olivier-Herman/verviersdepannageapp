// src/app/api/touring/recent/route.ts
//
// Diagnostic superadmin : 20 dernières fiches incoming_missions (toutes sources)
// + repérage des Touring / parse_error, pour voir ce qu'un mail vient de produire.
//
// GET /api/touring/recent

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roles: string[] = Array.isArray((session.user as any).roles) ? (session.user as any).roles : ((session.user as any).role ? [(session.user as any).role] : [])
  if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data } = await sb.from('incoming_missions')
    .select('mission_number, source, source_format, status, dossier_number, external_id, vehicle_plate, created_at, archived_at')
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({
    mode: process.env.TOURING_COMEX_MODE || '(absent → observe)',
    now:  new Date().toISOString(),
    recent: (data || []).map((m: any) => ({
      n:      m.mission_number,
      source: m.source,
      fmt:    m.source_format,
      status: m.status,
      dossier: m.dossier_number,
      ext:    m.external_id,
      plate:  m.vehicle_plate,
      created: m.created_at,
      archived: !!m.archived_at,
    })),
  })
}
