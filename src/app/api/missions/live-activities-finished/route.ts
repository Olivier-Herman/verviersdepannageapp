// GET /api/missions/live-activities-finished → missions du chauffeur terminées,
// annulées, mises au parc ou retirées dans les dernières 24 h. L'app iPhone ferme
// leur Live Activity (Olivier 05/10/2026 : 1VRK946 restée « En route vers la
// destination » 10 min après la clôture — le chauffeur avait quitté la fiche).
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
const TERMINAL = ['to_invoice', 'completed', 'invoiced', 'parked', 'cancelled', 'no_charge', 'ignored']

export async function GET() {
  const session = await getServerSession(authOptions)
  const me = (session?.user as any)?.id as string | undefined
  if (!me) return NextResponse.json({ ids: [] }, { status: 401 })
  const sb = createAdminClient()
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  // Missions sur lesquelles il a agi récemment (le journal garde l'auteur) : terminées
  // ou plus attribuées à lui.
  const { data: logs } = await sb.from('mission_logs').select('mission_id').eq('actor_id', me).gte('created_at', since).limit(500)
  const mids = [...new Set((logs || []).map((l: any) => l.mission_id).filter(Boolean))]
  if (!mids.length) return NextResponse.json({ ids: [] })
  const { data } = await sb.from('incoming_missions').select('id, status, assigned_to').in('id', mids)
  const ids = (data || []).filter((m: any) => TERMINAL.includes(String(m.status)) || m.assigned_to !== me).map((m: any) => m.id)
  return NextResponse.json({ ids })
}
