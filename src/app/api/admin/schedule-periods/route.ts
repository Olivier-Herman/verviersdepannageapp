// src/app/api/admin/schedule-periods/route.ts
//
// Olivier 2026-06-03 : API CRUD pour les periodes de garde
// (jour / nuit / autodispatch_night). Lu par lib/schedule.ts (cache 60s).
//
// GET  → liste
// PATCH → update une ligne (id, hour_start, hour_end, cross_midnight, active)
//
// Acces : admin / superadmin uniquement.

import { NextResponse }       from 'next/server'
import { getServerSession }   from 'next-auth'
import { authOptions }        from '@/lib/auth'
import { createAdminClient }  from '@/lib/supabase'
import { reloadScheduleCache } from '@/lib/schedule-server'

export const dynamic = 'force-dynamic'

async function authorize() {
  const session = await getServerSession(authOptions)
  if (!session) return { ok: false, error: 'Unauthorized', status: 401 }
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return { ok: false, error: 'Forbidden', status: 403 }
  }
  return { ok: true }
}

export async function GET() {
  const auth = await authorize()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('schedule_periods')
    .select('id, kind, hour_start, hour_end, cross_midnight, label, active, updated_at')
    .order('kind')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ periods: data || [] })
}

export async function POST(req: Request) {
  const auth = await authorize()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await req.json()
  const kind = String(body.kind || '')
  if (!['day', 'night', 'autodispatch_night'].includes(kind)) {
    return NextResponse.json({ error: 'kind invalide (day | night | autodispatch_night)' }, { status: 400 })
  }
  const hour_start = Number(body.hour_start)
  const hour_end   = Number(body.hour_end)
  if (!Number.isFinite(hour_start) || hour_start < 0 || hour_start > 24
   || !Number.isFinite(hour_end)   || hour_end   < 0 || hour_end   > 24) {
    return NextResponse.json({ error: 'hour_start / hour_end doivent etre entre 0 et 24' }, { status: 400 })
  }
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('schedule_periods')
    .insert({
      kind,
      hour_start,
      hour_end,
      cross_midnight: !!body.cross_midnight,
      label:          body.label || null,
      active:         body.active != null ? !!body.active : true,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await reloadScheduleCache()
  return NextResponse.json({ ok: true, period: data })
}

export async function DELETE(req: Request) {
  const auth = await authorize()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const url = new URL(req.url)
  const id = Number(url.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id requis (query param)' }, { status: 400 })
  const sb = createAdminClient()
  const { error } = await sb.from('schedule_periods').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await reloadScheduleCache()
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request) {
  const auth = await authorize()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await req.json()
  const id = Number(body.id)
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.hour_start != null)     updates.hour_start     = Number(body.hour_start)
  if (body.hour_end != null)       updates.hour_end       = Number(body.hour_end)
  if (body.cross_midnight != null) updates.cross_midnight = !!body.cross_midnight
  if (body.label != null)          updates.label          = String(body.label || '')
  if (body.active != null)         updates.active         = !!body.active
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('schedule_periods')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Reload cache schedule.ts pour appliquer immediatement
  await reloadScheduleCache()
  return NextResponse.json({ ok: true, period: data })
}
