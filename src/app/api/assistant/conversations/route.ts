// src/app/api/assistant/conversations/route.ts
//
// GET  /api/assistant/conversations → liste les conversations de l user (superadmin)
// POST /api/assistant/conversations → cree une nouvelle conversation

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { assistantUser, type AssistantMode } from '@/lib/assistant/access'

export const dynamic = 'force-dynamic'


const modeOf = (v: unknown): AssistantMode => v === 'bureau' ? 'bureau' : 'admin'

export async function GET(req: Request) {
  const mode = modeOf(new URL(req.url).searchParams.get('mode'))
  const user = await assistantUser(mode)
  if (!user) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('assistant_conversations')
    .select('id, title, created_at, updated_at, archived')
    .eq('user_id', user.id)
    .eq('archived', false)
    .eq('mode', mode)
    .order('updated_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, conversations: data || [] })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { title?: string; mode?: string }
  const mode = modeOf(body.mode)
  const user = await assistantUser(mode)
  if (!user) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('assistant_conversations')
    .insert({ user_id: user.id, title: body.title || 'Nouvelle conversation', mode })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, conversation: data })
}
