// src/app/api/notifications/stale/route.ts
//
// POST { items: [{ key, mission_id?, action_url?, notif_type?, attempt_id? }] }
//   → { keys: [...] } : les notifications affichées sur le téléphone qui sont
//   devenues sans objet (mission acceptée, clôturée, retirée…). L'app les
//   retire alors de l'écran du téléphone (Olivier 04/10/2026).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { staleNotifKeys }    from '@/lib/notifications/stale'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ keys: [] }, { status: 401 })
  const { data: me } = await createAdminClient().from('users').select('id').eq('email', session.user.email).maybeSingle()
  if (!me) return NextResponse.json({ keys: [] }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const items = (Array.isArray(body?.items) ? body.items : []).slice(0, 100).map((n: any) => ({
    key:        String(n?.key ?? ''),
    mission_id: typeof n?.mission_id === 'string' ? n.mission_id : null,
    action_url: typeof n?.action_url === 'string' ? n.action_url : null,
    notif_type: typeof n?.notif_type === 'string' ? n.notif_type : null,
    attempt_id: typeof n?.attempt_id === 'string' ? n.attempt_id : null,
  })).filter((n: any) => n.key)
  return NextResponse.json({ keys: await staleNotifKeys(me.id, items) })
}
