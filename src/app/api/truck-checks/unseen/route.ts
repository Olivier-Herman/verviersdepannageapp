// GET  /api/truck-checks/unseen → rapports des 3 derniers jours pas encore vus (bureau)
// POST /api/truck-checks/unseen { id } → « Plus tard » : marqué vu, la fenêtre ne revient plus
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isReportViewer, loadCheck } from '@/lib/truck-checks/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ checks: [], viewer: false })
  const u: any = session.user
  const sb = createAdminClient()
  if (!(await isReportViewer(sb, { id: u.id, role: u.role, roles: u.roles }))) return NextResponse.json({ checks: [], viewer: false })
  const since = new Date(Date.now() - 3 * 86400_000).toISOString()
  const [{ data: recent }, { data: seen }] = await Promise.all([
    sb.from('truck_checks').select('id').gte('created_at', since).order('created_at', { ascending: false }).limit(20),
    sb.from('truck_check_views').select('check_id').eq('user_id', u.id).gte('seen_at', new Date(Date.now() - 4 * 86400_000).toISOString()),
  ])
  const seenIds = new Set((seen || []).map((s: any) => s.check_id))
  const ids = (recent || []).map((r: any) => r.id).filter((id: string) => !seenIds.has(id)).slice(0, 5)
  const checks = (await Promise.all(ids.map((id: string) => loadCheck(sb, id)))).filter(Boolean)
  return NextResponse.json({ checks, viewer: true })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  await createAdminClient().from('truck_check_views').upsert({ check_id: String(b.id || ''), user_id: (session.user as any).id }, { onConflict: 'check_id,user_id' })
  return NextResponse.json({ ok: true })
}
