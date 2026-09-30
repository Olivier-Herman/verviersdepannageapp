// GET  /api/truck-checks  → formulaire (camions, mon camion, dernier km) + rapports récents
// POST /api/truck-checks  → envoi d'un check camion par le chauffeur
// Olivier 30/09/2026 — maquette https://claude.ai/artifact/WHWzq8AJt5hqdSJDZhWQBi
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isReportViewer, dispatchReport } from '@/lib/truck-checks/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const u: any = session.user
  const sb = createAdminClient()
  const viewer = await isReportViewer(sb, { id: u.id, role: u.role, roles: u.roles })
  const [trucks, me, last, recent] = await Promise.all([
    sb.from('trucks').select('id, name, plate, brand, model, sort_order').eq('active', true).order('sort_order').order('name'),
    sb.from('users').select('current_truck_id, default_truck_id').eq('id', u.id).maybeSingle(),
    sb.from('truck_checks').select('truck_id, mileage, created_at, driver_name').order('created_at', { ascending: false }).limit(500),
    (viewer ? sb.from('truck_checks').select('*') : sb.from('truck_checks').select('*').eq('driver_id', u.id)).order('created_at', { ascending: false }).limit(viewer ? 60 : 20),
  ])
  const lastKm: Record<string, any> = {}
  for (const r of last.data || []) if (r.truck_id && !lastKm[r.truck_id]) lastKm[r.truck_id] = { mileage: r.mileage, at: r.created_at, by: r.driver_name }
  return NextResponse.json({
    trucks: trucks.data || [], myTruckId: me.data?.current_truck_id || me.data?.default_truck_id || null,
    lastKm, recent: recent.data || [], viewer,
  })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const u: any = session.user
  const sb = createAdminClient()
  const b = await req.json().catch(() => ({}))
  const { data: truck } = await sb.from('trucks').select('id, name, plate').eq('id', String(b.truck_id || '')).maybeSingle()
  if (!truck) return NextResponse.json({ error: 'Choisissez le camion.' }, { status: 400 })
  const km = Math.round(Number(String(b.mileage ?? '').replace(/[^\d]/g, '')))
  if (!km || km < 1 || km > 3_000_000) return NextResponse.json({ error: 'Indiquez le kilométrage du compteur.' }, { status: 400 })
  const anomalies = (Array.isArray(b.anomalies) ? b.anomalies : []).map((a: any, i: number) => ({
    title: String(a.title || '').trim().slice(0, 160), description: String(a.description || '').trim().slice(0, 3000) || null,
    level: Math.max(1, Math.min(5, Math.round(Number(a.level) || 0))), sort: i,
    photos: (Array.isArray(a.photos) ? a.photos : []).map(String).filter((p: string) => /^truck\/[\w\-/]+\.jpg$/.test(p)).slice(0, 60),
  }))
  if (anomalies.some((a: any) => !a.title || !a.level)) return NextResponse.json({ error: 'Chaque anomalie doit avoir un titre et un niveau.' }, { status: 400 })
  const { data: me } = await sb.from('users').select('name').eq('id', u.id).maybeSingle()
  const { data: c, error } = await sb.from('truck_checks').insert({
    truck_id: truck.id, truck_plate: truck.plate, truck_name: truck.name, mileage: km,
    comment: String(b.comment || '').trim().slice(0, 3000) || null, driver_id: u.id, driver_name: me?.name || u.name || null,
    anomaly_count: anomalies.length, max_level: anomalies.reduce((m: number, a: any) => Math.max(m, a.level), 0),
  }).select('id').single()
  if (error || !c) return NextResponse.json({ error: error?.message || 'Enregistrement impossible.' }, { status: 500 })
  if (anomalies.length) {
    const { error: e2 } = await sb.from('truck_check_anomalies').insert(anomalies.map((a: any) => ({ ...a, check_id: c.id })))
    if (e2) { await sb.from('truck_checks').delete().eq('id', c.id); return NextResponse.json({ error: e2.message }, { status: 500 }) }
  }
  // Le chauffeur a déjà vu son propre rapport : pas de fenêtre pour lui.
  await sb.from('truck_check_views').insert({ check_id: c.id, user_id: u.id })
  await dispatchReport(c.id)
  return NextResponse.json({ ok: true, id: c.id })
}
