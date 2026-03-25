// src/app/api/admin/missions/errors/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !['admin', 'superadmin'].includes((session.user as any)?.role))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { data: missions } = await supabase
    .from('incoming_missions')
    .select('id, external_id, source, source_format, status, received_at, raw_content')
    .or('status.eq.parse_error,source.eq.unknown,external_id.like.UNKNOWN_SENDER_%')
    .order('received_at', { ascending: false })
    .limit(50)

  return NextResponse.json({ missions: missions || [] })
}
