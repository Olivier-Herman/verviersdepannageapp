// src/app/api/telephonie/pris/route.ts — quelqu'un a pris l'appel sur le grand bandeau (Olivier 25/11/2026) :
// le bandeau disparaît aussi des écrans des autres personnes prévenues. POST { notif_id }.
// On part de SA propre notification : impossible de fermer les bandeaux d'un appel dont on n'a pas été prévenu.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as any)?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { notif_id } = await req.json().catch(() => ({}))
  if (!notif_id) return NextResponse.json({ error: 'notif_id manquant' }, { status: 400 })

  const sb = createAdminClient()
  const { data: n, error } = await sb.from('notifications_log').select('id, notif_type, payload')
    .eq('id', notif_id).eq('user_id', userId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!n || n.notif_type !== 'appel_entrant') return NextResponse.json({ error: 'Appel introuvable' }, { status: 404 })

  const now = new Date().toISOString()
  const appelId = (n.payload as any)?.data?.appel_id
  // Notification d'avant ce réglage (sans identifiant d'appel) : on ne ferme que la sienne.
  const q = sb.from('notifications_log').update({ read_at: now }).eq('notif_type', 'appel_entrant').is('read_at', null)
  const { data: fermes, error: e2 } = await (appelId ? q.eq('payload->data->>appel_id', String(appelId)) : q.eq('id', notif_id)).select('id')
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  return NextResponse.json({ ok: true, fermes: (fermes || []).length })
}
