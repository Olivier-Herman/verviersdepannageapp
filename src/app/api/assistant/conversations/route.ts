// src/app/api/assistant/conversations/route.ts
//
// GET  /api/assistant/conversations → liste les conversations de l user (superadmin)
// POST /api/assistant/conversations → cree une nouvelle conversation

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function requireSuperadmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const role  = (session.user as any).role  || ''
  const roles = (session.user as any).roles || [role]
  const allRoles: string[] = Array.isArray(roles) ? roles : [roles]
  if (!allRoles.includes('superadmin')) return null
  const sb = createAdminClient()
  const { data: user } = await sb.from('users').select('id, name, email').eq('email', session.user.email).maybeSingle()
  return user
}

export async function GET() {
  const user = await requireSuperadmin()
  if (!user) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('assistant_conversations')
    .select('id, title, created_at, updated_at, archived')
    .eq('user_id', user.id)
    .eq('archived', false)
    .order('updated_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, conversations: data || [] })
}

export async function POST(req: Request) {
  const user = await requireSuperadmin()
  if (!user) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { title?: string }
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('assistant_conversations')
    .insert({ user_id: user.id, title: body.title || 'Nouvelle conversation' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, conversation: data })
}
