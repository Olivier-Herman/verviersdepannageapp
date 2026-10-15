// POST /api/admin/live-activity-restart { mission_id } — envoie au chauffeur une carte
// d'écran verrouillé complète pour une mission déjà acceptée (carte démarrée « verrouillée »
// avant la correction du 15/10/2026). Superadmin, ou appel serveur avec CRON_SECRET.
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { pushStartLiveActivity } from '@/lib/native/pushLiveActivity'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const bearer = !!process.env.CRON_SECRET && req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  if (!bearer) {
    const s = await getServerSession(authOptions); const u = s?.user as any
    const roles: string[] = [u?.role, ...(Array.isArray(u?.roles) ? u.roles : [])]
    if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Superadmin uniquement' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  if (!body.mission_id) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })
  return NextResponse.json(await pushStartLiveActivity(String(body.mission_id), { silent: true }))
}
