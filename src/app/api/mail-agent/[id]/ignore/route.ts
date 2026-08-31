// POST /api/mail-agent/[id]/ignore — écarte un item à la main.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { roles: ['superadmin'] }).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const actor = (session?.user as any)?.name || (session?.user as any)?.email || 'inconnu'
  const sb = createAdminClient()
  const { error } = await sb.from('mail_agent_items')
    .update({ status: 'ignored', applied_by: actor, updated_at: new Date().toISOString() })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
