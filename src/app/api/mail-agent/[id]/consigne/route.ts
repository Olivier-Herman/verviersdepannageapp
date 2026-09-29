// POST /api/mail-agent/[id]/consigne { instruction } — « Ce que j'ai compris » : l'agent
// traduit la consigne en gestes, sans rien faire (Olivier 29/09/2026).
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess } from '@/lib/access'
import { planMail } from '@/lib/mail-agent/consignes'
import { officePeople } from '@/lib/courrier/match'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const access = sessionAccess(session, { roles: ['admin', 'superadmin', 'mail_agent'] })
  if (!access.ok || !access.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { instruction } = await req.json().catch(() => ({}))
  const txt = String(instruction || '').trim()
  if (txt.length < 3) return NextResponse.json({ error: 'Écrivez ce que l’agent doit faire.' }, { status: 400 })
  const sb = createAdminClient()
  const { data: item } = await sb.from('mail_agent_items').select('*').eq('id', params.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Mail introuvable' }, { status: 404 })
  try {
    const plan = await planMail(item, txt.slice(0, 1500), await officePeople(sb), { id: access.id, name: (session?.user as any)?.name || null })
    return NextResponse.json(plan)
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'L’agent n’a pas compris' }, { status: 502 }) }
}
