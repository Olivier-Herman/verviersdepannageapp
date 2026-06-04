// src/app/api/admin/towsoft-migration/orphans/route.ts
//
// GET /api/admin/towsoft-migration/orphans?resolved=0|1
// Liste les fantomes inverses (vehicules scannes absents de TowSoft).
//
// PATCH /api/admin/towsoft-migration/orphans
// Body: { id, action, mission_id?, notes? } -> marque resolu

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function checkAuth() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: 'Unauthorized', status: 401 as const }
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return { error: 'Forbidden', status: 403 as const }
  }
  return { user }
}

export async function GET(req: Request) {
  const auth = await checkAuth()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const showResolved = url.searchParams.get('resolved') === '1'

  const sb = createAdminClient()
  let query = sb
    .from('orphan_scans')
    .select('id, raw_input, parsed_format, plate, vin, zone, scanned_by, scanned_at, resolved_at, resolved_action, resolved_mission_id, resolution_notes')
    .order('scanned_at', { ascending: false })
    .limit(500)

  if (showResolved) {
    query = query.not('resolved_at', 'is', null)
  } else {
    query = query.is('resolved_at', null)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Compte unresolved / resolved
  const { count: totalUnresolved } = await sb
    .from('orphan_scans')
    .select('id', { count: 'exact', head: true })
    .is('resolved_at', null)

  const { count: totalResolved } = await sb
    .from('orphan_scans')
    .select('id', { count: 'exact', head: true })
    .not('resolved_at', 'is', null)

  return NextResponse.json({
    orphans: data || [],
    counts: {
      unresolved: totalUnresolved || 0,
      resolved:   totalResolved || 0,
    },
  })
}

export async function PATCH(req: Request) {
  const auth = await checkAuth()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json() as {
    id:          string
    action:      string  // 'created_in_vdsoft' | 'found_in_odoo' | 'ignored'
    mission_id?: string
    notes?:      string
  }

  if (!body.id || !body.action) {
    return NextResponse.json({ error: 'id et action requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { error } = await sb
    .from('orphan_scans')
    .update({
      resolved_at:         new Date().toISOString(),
      resolved_by:         (auth.user as any).id,
      resolved_action:     body.action,
      resolved_mission_id: body.mission_id || null,
      resolution_notes:    body.notes || null,
      updated_at:          new Date().toISOString(),
    })
    .eq('id', body.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
