// POST /api/missions/[id]/pause { action: 'pause' | 'release' | 'resume' | 'take', until?, reason? } — « Je reviens plus
// tard » et reprise, par le chauffeur de la mission (Olivier 18/10/2026).
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { pauseMission, resumeMission, releaseToDispatch, takePausedMission } from '@/lib/missions/pause-transfer'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  const actor = { id: u.id, name: u.name || 'Chauffeur' }
  try {
    if (b.action === 'pause') return NextResponse.json({ ok: true, ...(await pauseMission(sb, params.id, actor, String(b.until || ''), b.reason ? String(b.reason).slice(0, 120) : null)) })
    // Remise au dispatch / reprise par n'importe quel chauffeur (Olivier 29/10/2026).
    if (b.action === 'release') return NextResponse.json({ ok: true, ...(await releaseToDispatch(sb, params.id, actor, String(b.until || ''), b.reason ? String(b.reason).slice(0, 120) : null)) })
    if (b.action === 'take') return NextResponse.json({ ok: true, ...(await takePausedMission(sb, params.id, actor)) })
    if (b.action === 'resume') return NextResponse.json({ ok: true, ...(await resumeMission(sb, params.id, actor)) })
    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ error: e?.message || String(e) }, { status: 400 }) }
}
