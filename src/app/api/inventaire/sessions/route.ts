// src/app/api/inventaire/sessions/route.ts
//
// GET  /api/inventaire/sessions/current → retourne la session active (avec items) du user, ou null
// POST /api/inventaire/sessions         → cree une nouvelle session (zone + tag + auto_print).
//                                          Si une session active existe deja avec memes zone/tag :
//                                          la retourne (reprise). Sinon en cree une nouvelle.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function requireAccess() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: 'Unauthorized', status: 401 } as const
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return { error: 'Forbidden', status: 403 } as const
  }
  return { user } as const
}

export async function POST(req: Request) {
  const auth = await requireAccess()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json() as {
    tag_name?:       string
    zone_state_id?:  number | null
    zone_code?:      string
    zone_label?:     string
    zone_full_name?: string
    auto_print?:     boolean
    depot_id?:       string | null
  }
  if (!body.tag_name) return NextResponse.json({ error: 'tag_name requis' }, { status: 400 })

  const sb = createAdminClient()

  // Si une session active existe pour ce user + tag, on la reprend
  const { data: existing } = await sb
    .from('inventaire_sessions')
    .select('*')
    .eq('user_id',  auth.user.id)
    .eq('tag_name', body.tag_name)
    .is('completed_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    // Met a jour la zone + auto_print si different
    const update: any = { updated_at: new Date().toISOString() }
    if (body.zone_state_id !== undefined)  update.zone_state_id  = body.zone_state_id
    if (body.zone_code !== undefined)      update.zone_code      = body.zone_code
    if (body.zone_label !== undefined)     update.zone_label     = body.zone_label
    if (body.zone_full_name !== undefined) update.zone_full_name = body.zone_full_name
    if (body.auto_print !== undefined)     update.auto_print     = Boolean(body.auto_print)
    if (body.depot_id !== undefined)       update.depot_id       = body.depot_id || null
    const { data: updated } = await sb
      .from('inventaire_sessions')
      .update(update)
      .eq('id', existing.id)
      .select()
      .single()
    return NextResponse.json({ ok: true, session: updated || existing, resumed: true })
  }

  // Sinon : creation
  const { data, error } = await sb
    .from('inventaire_sessions')
    .insert({
      user_id:        auth.user.id,
      tag_name:       body.tag_name,
      zone_state_id:  body.zone_state_id ?? null,
      zone_code:      body.zone_code || null,
      zone_label:     body.zone_label || null,
      zone_full_name: body.zone_full_name || null,
      auto_print:     Boolean(body.auto_print),
      depot_id:       body.depot_id || null,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, session: data, resumed: false })
}
