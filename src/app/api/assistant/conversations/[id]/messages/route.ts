// src/app/api/assistant/conversations/[id]/messages/route.ts
//
// POST → envoie un message user, declenche le tool use loop Claude,
//        retourne tous les messages mis a jour (incluant tool_calls + assistant final).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { assistantOwner }    from '@/lib/assistant/access'
import { runChatTurn }       from '@/lib/assistant/claude'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120  // tool use loop peut prendre du temps

const requireOwner = assistantOwner

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireOwner(params.id)
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as { text?: string; contexte?: { ecran?: string; fiche?: { id?: string; numero?: number | null; plaque?: string | null } | null } }
  const raw = String(body.text || '').trim()
  if (!raw) return NextResponse.json({ error: 'Texte requis' }, { status: 400 })
  // Pastille Max (Olivier 14/10/2026) : la page ouverte accompagne la question, pour que
  // « pourquoi elle est à facturer ? » vise la fiche à l'écran sans redonner la plaque.
  const ctx = body.contexte
  const f = ctx?.fiche
  const where = [ctx?.ecran, f?.id ? `fiche #${f.numero ?? '?'}${f.plaque ? ' ' + f.plaque : ''} (id ${f.id})` : null].filter(Boolean).join(' — ')
  const text = auth.conv.mode === 'bureau' && where ? `[Page ouverte : ${String(where).slice(0, 300)}]\n${raw}` : raw

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
    const newTitle = raw.slice(0, 60).trim() || 'Nouvelle conversation'
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

  const { data: actions } = await sb.from('assistant_actions').select('id, kind, resume, status, error, result, decided_at').eq('conversation_id', params.id)
  return NextResponse.json({
    ok: true,
    actions:       actions || [],
    assistantText: result.assistantText,
    toolCalls:     result.toolCalls,
    messages:      messages || [],
  })
}
