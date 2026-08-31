// GET /api/mail-agent/items?status=ready|blocked|to_verify|applied|all
// Liste la file de l'agent mail + le mode d'autonomie courant.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'
import { getMode }           from '@/lib/mail-agent'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { roles: ['superadmin'] }).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const status = new URL(req.url).searchParams.get('status') || 'all'
  const sb = createAdminClient()

  // order by created_at après un UPSERT n'est pas déterministe : on trie sur la
  // date de réception du mail, puis sur l'id pour départager.
  let q = sb.from('mail_agent_items').select('*')
    .order('received_at', { ascending: false }).order('id', { ascending: true }).limit(200)
  if (status !== 'all') q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const counts: Record<string, number> = {}
  const { data: all } = await sb.from('mail_agent_items').select('status')
  for (const r of all || []) counts[r.status] = (counts[r.status] || 0) + 1

  return NextResponse.json({ items: data || [], counts, mode: await getMode(sb) })
}
