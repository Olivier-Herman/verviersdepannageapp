// src/app/api/assistant/conversations/[id]/route.ts
//
// GET    → conversation + messages
// PATCH  → renomme (title)
// DELETE → archive (soft delete)

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function requireOwner(conversationId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const role  = (session.user as any).role  || ''
  const roles = (session.user as any).roles || [role]
  const allRoles: string[] = Array.isArray(roles) ? roles : [roles]
  if (!allRoles.includes('superadmin')) return null
  const sb = createAdminClient()
  const { data: user } = await sb.from('users').select('id, name, email').eq('email', session.user.email).maybeSingle()
  if (!user) return null
  const { data: conv } = await sb.from('assistant_conversations').select('*').eq('id', conversationId).maybeSingle()
  if (!conv || conv.user_id !== user.id) return null
  return { user, conv }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireOwner(params.id)
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data: messages, error } = await sb
    .from('assistant_messages')
    .select('id, role, content, tool_call_id, tool_name, created_at')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, conversation: auth.conv, messages: messages || [] })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireOwner(params.id)
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as { title?: string; archived?: boolean }
  const update: any = { updated_at: new Date().toISOString() }
  if (typeof body.title === 'string')    update.title    = body.title.trim().slice(0, 200)
  if (typeof body.archived === 'boolean') update.archived = body.archived

  const sb = createAdminClient()
  const { data, error } = await sb.from('assistant_conversations').update(update).eq('id', params.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, conversation: data })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireOwner(params.id)
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { error } = await sb.from('assistant_conversations').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
