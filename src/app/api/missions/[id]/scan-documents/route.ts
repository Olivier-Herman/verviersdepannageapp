// src/app/api/missions/[id]/scan-documents/route.ts
//
// GET — pages de documents scannées au parc pour cette fiche (page Accident :
// carte grise, carte verte, CT…), avec ce que la lecture y a reconnu.
// Olivier 28/09/2026 : « les photos des documents qu'on fait n'apparaissent
// pas dans la fiche ». Les images passent par /api/missions/documents/[id].

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const [{ data: docs }, { data: run }] = await Promise.all([
    sb.from('mission_documents').select('id, file_name, mime_type, created_at').eq('mission_id', params.id).eq('kind', 'parc_scan').order('created_at', { ascending: true }),
    sb.from('process_runs').select('reading').eq('mission_id', params.id).eq('process_key', 'accident_police').maybeSingle(),
  ])
  const reading: any = run?.reading || null
  return NextResponse.json({
    documents: docs || [],
    recognized: (reading?.documents || []).filter((d: any) => d.present).map((d: any) => d.type),
    missing: (reading?.documents || []).filter((d: any) => !d.present).map((d: any) => d.type),
  })
}
