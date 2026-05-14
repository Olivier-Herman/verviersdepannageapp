// src/app/api/missions/[id]/pdf/route.ts
//
// GET /api/missions/[id]/pdf[?chain=1]
// Genere et retourne le PDF mission (preview/download). Pas d'attachement
// Odoo ici — c'est juste la sortie navigateur.
//
// ?chain=1 : si la mission a un parent ou des enfants (chaine REM+REL),
// genere le PDF combine de toute la chaine.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { generateMissionPdfBuffer } from '@/lib/missions/attach-mission-pdf'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const missionId = params.id
  if (!missionId) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const url = new URL(req.url)
  const wantChain = url.searchParams.get('chain') === '1'

  let missionIds: string[] = [missionId]
  if (wantChain) {
    const sb = createAdminClient()
    const { data: m } = await sb
      .from('incoming_missions')
      .select('id, parent_mission_id')
      .eq('id', missionId)
      .maybeSingle()
    if (m) {
      const baseId = m.parent_mission_id || m.id
      const { data: chain } = await sb
        .from('incoming_missions')
        .select('id')
        .or(`id.eq.${baseId},parent_mission_id.eq.${baseId}`)
      missionIds = (chain || []).map(c => c.id)
    }
  }

  try {
    const { buffer, filename } = await generateMissionPdfBuffer(missionIds)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (e: any) {
    console.error('[api/missions/pdf]', e.message)
    return NextResponse.json({ error: e.message || 'Erreur generation PDF' }, { status: 500 })
  }
}
