// POST /api/missions/[id]/siabis-couvert-request — le chauffeur demande le passage
// d'une fiche NON couverte en Siabis couvert ; le dispatch tranche (popup obligatoire).
// Olivier 20/09/2026.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { requestSiabisCouvert } from '@/lib/missions/siabis-couvert-request'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string
  const role = (session.user as any).role as string
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions').select('id, assigned_to').eq('id', params.id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
  if (m.assigned_to !== userId && !['admin', 'superadmin', 'dispatcher'].includes(role)) return NextResponse.json({ error: 'Fiche non attribuée à toi' }, { status: 403 })
  const r = await requestSiabisCouvert(sb, params.id, userId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, requested_at: new Date().toISOString() })
}
