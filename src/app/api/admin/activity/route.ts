// src/app/api/admin/activity/route.ts
//
// Journal d'activité GLOBAL (superadmin) : flux chronologique de tous les
// mission_logs (qui / quoi / quand / sur quelle mission). Sert de « mouchard »
// pour vérifier que les process sont respectés. Olivier 2026-07-14.
//
// GET ?user=<actorId>&action=<txt>&q=<txt>&hours=<n>&limit=<n>&before=<iso>

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((session.user as any)?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { searchParams } = new URL(req.url)
  const user   = (searchParams.get('user')   || '').trim()
  const action = (searchParams.get('action') || '').trim()
  const q      = (searchParams.get('q')      || '').trim()
  const hours  = Math.min(Math.max(Number(searchParams.get('hours')) || 24, 1), 720)
  const limit  = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 10), 300)
  const before = (searchParams.get('before') || '').trim()

  let query = sb
    .from('mission_logs')
    .select('id, mission_id, actor_id, action, notes, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  query = query.gte('created_at', since)
  if (before) query = query.lt('created_at', before)
  if (user)   query = query.eq('actor_id', user)
  if (action) query = query.ilike('action', `%${action}%`)
  if (q)      query = query.ilike('notes', `%${q}%`)

  const { data: logs, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = logs || []
  const actorIds   = [...new Set(rows.map(r => r.actor_id).filter(Boolean))] as string[]
  const missionIds = [...new Set(rows.map(r => r.mission_id).filter(Boolean))] as string[]

  const [{ data: users }, { data: missions }] = await Promise.all([
    actorIds.length   ? sb.from('users').select('id, name, email').in('id', actorIds) : Promise.resolve({ data: [] as any[] }),
    missionIds.length ? sb.from('incoming_missions').select('id, mission_number, vehicle_plate, source').in('id', missionIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const uMap = new Map((users || []).map((u: any) => [u.id, u]))
  const mMap = new Map((missions || []).map((m: any) => [m.id, m]))

  const items = rows.map(r => {
    const u = r.actor_id ? uMap.get(r.actor_id) : null
    const m = r.mission_id ? mMap.get(r.mission_id) : null
    return {
      id:             r.id,
      created_at:     r.created_at,
      action:         r.action,
      notes:          r.notes,
      actor_name:     u?.name || (r.actor_id ? '—' : 'Système'),
      actor_email:    u?.email || null,
      mission_id:     r.mission_id,
      mission_number: m?.mission_number ?? null,
      vehicle_plate:  m?.vehicle_plate ?? null,
      source:         m?.source ?? null,
    }
  })

  // Liste des utilisateurs pour le filtre déroulant (une fois).
  const includeUsers = searchParams.get('with_users') === '1'
  let usersList: any[] | undefined
  if (includeUsers) {
    const { data } = await sb.from('users').select('id, name, email').order('name')
    usersList = (data || []).map((u: any) => ({ id: u.id, name: u.name || u.email }))
  }

  return NextResponse.json({ items, users: usersList, next_before: items.length === limit ? items[items.length - 1].created_at : null })
}
