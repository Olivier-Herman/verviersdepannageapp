// POST /api/missions/[id]/consigne-lue — le chauffeur confirme avoir lu la consigne du garage (dépôt hors créneau,
// Olivier 10/10/2026). Tracé sur la fiche et dans l'historique.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, name, role, roles').eq('email', u.email).maybeSingle()
  const { data: m } = await sb.from('incoming_missions').select('id, assigned_to, source_notice_ack_at').eq('id', params.id).maybeSingle()
  if (!m || !me) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  const bureau = [me.role, ...(me.roles || [])].some((r: string) => ['dispatcher', 'admin', 'superadmin'].includes(r))
  if (m.assigned_to !== me.id && !bureau) return NextResponse.json({ error: 'Mission non attribuée' }, { status: 403 })
  if (!m.source_notice_ack_at) {
    const now = new Date().toISOString()
    await sb.from('incoming_missions').update({ source_notice_ack_at: now, source_notice_ack_by: me.id, updated_at: now }).eq('id', m.id).is('source_notice_ack_at', null)
    await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: me.id, action: 'source_notice_ack', notes: `Consigne du garage (dépôt hors heures d’ouverture) lue et confirmée par ${me.name || 'le chauffeur'}.` }).then(() => {}, () => {})
  }
  return NextResponse.json({ ok: true })
}
