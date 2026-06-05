// src/app/api/cobrowse/start/route.ts
// POST /api/cobrowse/start { message?, url, user_agent }
// Cree une session pending + push notif a tous les superadmin.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToUser }    from '@/lib/push'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const sb = createAdminClient()

  const { data: user } = await sb
    .from('users')
    .select('id, name')
    .eq('email', session.user.email!)
    .single()
  if (!user) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  // Cancel toute session pending precedente du user (1 seule active a la fois)
  await sb.from('cobrowse_sessions').update({
    status:       'cancelled',
    ended_at:     new Date().toISOString(),
    ended_reason: 'replaced_by_new_request',
    updated_at:   new Date().toISOString(),
  }).eq('user_id', user.id).in('status', ['pending', 'active'])

  // Cree nouvelle session
  const { data: created, error: insErr } = await sb
    .from('cobrowse_sessions')
    .insert({
      user_id:    user.id,
      user_message: body.message || null,
      user_url:   body.url || null,
      user_agent: body.user_agent || null,
      status:     'pending',
    })
    .select('id')
    .single()

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Push notif a tous les superadmin
  const { data: admins } = await sb
    .from('users')
    .select('id')
    .or('role.eq.superadmin,roles.cs.{superadmin}')

  const notifyResults = await Promise.allSettled(
    (admins || []).map(a => sendPushToUser(a.id, {
      title: '🆘 Demande d aide',
      body:  `${user.name || 'Un utilisateur'} a besoin d aide${body.message ? ` : ${String(body.message).slice(0, 80)}` : ''}`,
      url:   '/admin/cobrowse',
      tag:   `cobrowse-${created.id}`,
    }).catch(e => { console.warn('[cobrowse/start] push KO admin:', e?.message); return null }))
  )

  return NextResponse.json({
    ok: true,
    session_id: created.id,
    notified:   notifyResults.filter(r => r.status === 'fulfilled').length,
  })
}
