// GET /api/admin/max-conversations           → toutes les conversations avec Max (toutes personnes)
// GET /api/admin/max-conversations?id=<conv>  → le détail (messages, outils, actions)
// Superadmin uniquement (Olivier 14/10/2026 : « sur super admin, tu peux m'afficher toutes
// les conversations détaillées »). Lecture seule ; chaque ouverture est journalisée.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  const roles: string[] = [u?.role, ...(Array.isArray(u?.roles) ? u.roles : [])]
  if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Superadmin uniquement' }, { status: 403 })
  const sb = createAdminClient()
  // Coût de Max : mois en cours + 5 précédents (refacturation à VD, Olivier 14/10/2026).
  if (new URL(req.url).searchParams.get('cout')) {
    const { maxMonth, monthKey } = await import('@/lib/assistant/max-cost')
    const mois = await Promise.all([0, -1, -2, -3, -4, -5].map(d => maxMonth(monthKey(d))))
    return NextResponse.json({ mois })
  }
  const id = new URL(req.url).searchParams.get('id')
  if (id) {
    const [{ data: conv }, { data: messages }, { data: actions }] = await Promise.all([
      sb.from('assistant_conversations').select('id, title, user_id, mode, created_at, updated_at').eq('id', id).eq('mode', 'bureau').maybeSingle(),
      sb.from('assistant_messages').select('id, role, content, tool_call_id, tool_name, created_at').eq('conversation_id', id).order('created_at', { ascending: true }),
      sb.from('assistant_actions').select('id, kind, resume, status, error, result, created_at, decided_at').eq('conversation_id', id),
    ])
    if (!conv) return NextResponse.json({ error: 'Conversation introuvable' }, { status: 404 })
    await sb.from('agent_journal').insert({ agent_name: 'Max', action: 'conversation consultée', detail: `${conv.title} (${conv.id}) ouverte par ${u.name || u.email}`, ok: true, actor: u.email || null }).then(() => {}, () => {})
    return NextResponse.json({ conversation: conv, messages: messages || [], actions: actions || [] })
  }
  const [{ data: convs }, { data: acts }, { data: users }] = await Promise.all([
    sb.from('assistant_conversations').select('id, title, user_id, created_at, updated_at').eq('mode', 'bureau').order('updated_at', { ascending: false }).limit(300),
    sb.from('assistant_actions').select('conversation_id, status'),
    sb.from('users').select('id, name, email'),
  ])
  const nm = Object.fromEntries((users || []).map((x: any) => [x.id, x.name || x.email]))
  const stats: Record<string, Record<string, number>> = {}
  for (const a of acts || []) { const s = (stats[a.conversation_id] ||= {}); s[a.status] = (s[a.status] || 0) + 1 }
  return NextResponse.json({ conversations: (convs || []).map((c: any) => ({ ...c, personne: nm[c.user_id] || '—', actions: stats[c.id] || {} })) })
}
