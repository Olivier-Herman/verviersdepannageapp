// src/app/api/missions/[id]/requisitoire-history/route.ts
//
// GET → historique des relances de réquisitoire ENVOYÉES pour une fiche (source
// de vérité = mission_logs, action 'requisitoire_relance'). Alimente le déplié
// « X relance(s) » de la vue Relance réquisitoires. Fourrière / admin.
// Olivier 2026-08-09.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'

export const dynamic     = 'force-dynamic'
export const maxDuration = 15

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const sb = createAdminClient()
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { modules: ['fourriere'] }).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const { data } = await sb.from('mission_logs')
    .select('created_at, notes, metadata')
    .eq('mission_id', params.id)
    .eq('action', 'requisitoire_relance')
    .order('created_at', { ascending: false })
    .limit(50)

  const history = (data || []).map((l: any) => ({
    at:    l.created_at,
    email: (l.metadata && l.metadata.email) || null,
  }))

  return NextResponse.json({ ok: true, history })
}
