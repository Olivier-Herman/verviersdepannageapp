// src/app/api/assistant/conversations/[id]/messages/route.ts
//
// POST → envoie un message user, declenche le tool use loop Claude,
//        retourne tous les messages mis a jour (incluant tool_calls + assistant final).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { runChatTurn }       from '@/lib/assistant/claude'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120  // tool use loop peut prendre du temps

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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireOwner(params.id)
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as { text?: string }
  const text = String(body.text || '').trim()
  if (!text) return NextResponse.json({ error: 'Texte requis' }, { status: 400 })

  let result
  try {
    result = await runChatTurn({
      conversationId: params.id,
      ctx: {
        userId:    auth.user.id,
        userEmail: auth.user.email,
        userName:  auth.user.name || auth.user.email,
      },
      userMessage: text,
    })
  } catch (e: any) {
    console.error('[assistant] runChatTurn error:', e.message)
    return NextResponse.json({ error: e.message || 'Erreur Claude' }, { status: 500 })
  }

  // Auto-genere un titre si conversation encore "Nouvelle conversation" et > 1er msg
  if (auth.conv.title === 'Nouvelle conversation') {
    const newTitle = text.slice(0, 60).trim() || 'Nouvelle conversation'
    const sb = createAdminClient()
    sb.from('assistant_conversations').update({ title: newTitle }).eq('id', params.id).then(() => {})
  }

  // Renvoie l historique complet a jour pour que le frontend reaffiche tout
  const sb = createAdminClient()
  const { data: messages } = await sb
    .from('assistant_messages')
    .select('id, role, content, tool_call_id, tool_name, created_at')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true })

  return NextResponse.json({
    ok: true,
    assistantText: result.assistantText,
    toolCalls:     result.toolCalls,
    messages:      messages || [],
  })
}
