// GET   /api/truck-checks/[id] → rapport complet (le chauffeur voit les siens, le bureau tout)
// PATCH /api/truck-checks/[id] { anomaly_id, resolved } → anomalie réglée / rouverte (bureau)
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isReportViewer, loadCheck } from '@/lib/truck-checks/server'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const u: any = session.user
  const sb = createAdminClient()
  const c = await loadCheck(sb, params.id)
  if (!c) return NextResponse.json({ error: 'Rapport introuvable' }, { status: 404 })
  const viewer = await isReportViewer(sb, { id: u.id, role: u.role, roles: u.roles })
  if (!viewer && c.driver_id !== u.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  if (viewer) await sb.from('truck_check_views').upsert({ check_id: c.id, user_id: u.id }, { onConflict: 'check_id,user_id' })
  const { data: history } = await sb.from('truck_checks').select('id, created_at, mileage, driver_name, anomaly_count, max_level').eq('truck_plate', c.truck_plate).neq('id', c.id).order('created_at', { ascending: false }).limit(10)
  return NextResponse.json({ check: c, history: history || [], viewer })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const u: any = session.user
  const sb = createAdminClient()
  if (!(await isReportViewer(sb, { id: u.id, role: u.role, roles: u.roles }))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const { error } = await sb.from('truck_check_anomalies').update(b.resolved ? { resolved_at: new Date().toISOString(), resolved_by: u.id } : { resolved_at: null, resolved_by: null })
    .eq('id', String(b.anomaly_id || '')).eq('check_id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, check: await loadCheck(sb, params.id) })
}
