// src/app/api/fourriere/saisies/retours-non-lus/route.ts
//
// GET — retours du Parquet arrivés par mail que le robot n'a pas su attribuer à
// un état de frais (« N° illisible », page non reconnue), pas encore traités à
// la main. File « Pages à attribuer » de l'écran États de frais (P2, préversion
// ma_journee, Olivier 11/11/2026). Accès : admin / superadmin / module fourrière.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] }).ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const depuis = new Date(Date.now() - 180 * 864e5).toISOString()
  const { data, error } = await sb.from('saisie_mail_events')
    .select('id, subject, from_addr, received_at, outcome')
    .eq('kind', 'retour_signe').is('revu_at', null).gte('received_at', depuis)
    .order('received_at', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // « N non reconnu(s) » avec N ≥ 1 : au moins une page que le robot n'a pas attribuée.
  const items = (data || []).filter((e: any) => /(^|\D)([1-9]\d*) non reconnu/.test(String(e.outcome || '')))
    .map((e: any) => ({ ...e, nonLues: Number(String(e.outcome).match(/([1-9]\d*) non reconnu/)?.[1] || 0) }))
  return NextResponse.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } })
}
