// src/app/api/admin/missions/errors/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const maxDuration = 60

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !['admin', 'superadmin'].includes((session.user as any)?.role))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { data: missions } = await supabase
    .from('incoming_missions')
    .select('id, external_id, source, source_format, status, received_at, raw_content, sender_email')
    .or('status.eq.parse_error,source.eq.unknown,external_id.like.UNKNOWN_SENDER_%')
    .order('received_at', { ascending: false })
    .limit(50)

  return NextResponse.json({ missions: missions || [] })
}

// POST : re-parse les missions en parse_error (modèle Claude réparé). Re-applique
// le parsing sur le raw_content stocké et repasse en 'new' si ça réussit.
//   body : { id?: string }  (un id précis, sinon toutes les parse_error)
// Olivier 2026-06-16.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || !['admin', 'superadmin'].includes((session.user as any)?.role))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const onlyId = body.id ? String(body.id) : null

  try {
    const { reprocessErrorMissions } = await import('@/lib/missions/reprocess-errors')
    const r = await reprocessErrorMissions({ onlyId })
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
