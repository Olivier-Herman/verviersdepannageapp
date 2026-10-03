// src/app/api/sam/conversations/route.ts
//
// Lecture des conversations Sam / Sonic terminées (Olivier 03/10/2026).
//   ?mission_id=…  conversations liées à une mission
//   ?mine=1        les miennes (chauffeur)
//   ?all=1         toutes (superadmin seulement), 200 dernières
// Droits : superadmin tout ; bureau et dispatch les conversations liées à une
// mission (jamais celles du profil) ; un chauffeur seulement les siennes.
// Chaque conversation renvoyée est journalisée (qui, quand).

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
const OFFICE_ROLES = ['admin', 'dispatcher']   // bureau et dispatch

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, role, roles, active').eq('email', email).maybeSingle()
  if (!me?.active) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const roles: string[] = [me.role, ...(Array.isArray(me.roles) ? me.roles : [])].filter(Boolean)
  const isSuper = roles.includes('superadmin')
  const isOffice = isSuper || roles.some(r => OFFICE_ROLES.includes(r))

  const url = new URL(req.url)
  const missionId = url.searchParams.get('mission_id')
  let q = sb.from('sam_conversations').select('id, user_id, mission_id, agent, canal, started_at, ended_at, end_reason, summary, purged_at').not('ended_at', 'is', null)
  if (url.searchParams.get('all') === '1') {
    if (!isSuper) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    q = q.order('ended_at', { ascending: false }).limit(200)
  } else if (missionId) {
    q = q.eq('mission_id', missionId)
    if (!isOffice) q = q.eq('user_id', me.id)              // un chauffeur : seulement les siennes
    q = q.order('started_at')
  } else if (url.searchParams.get('mine') === '1') {
    q = q.eq('user_id', me.id).order('ended_at', { ascending: false }).limit(50)
  } else return NextResponse.json({ error: 'Paramètre manquant' }, { status: 400 })

  const { data: convs, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const list = convs || []
  const ids = list.map(c => c.id)
  const { data: msgs } = ids.length ? await sb.from('sam_messages').select('conversation_id, at, role, agent, canal, texte, texte_fr, photo').in('conversation_id', ids).order('id') : { data: [] as any[] }
  const userIds = Array.from(new Set(list.map(c => c.user_id)))
  const { data: users } = userIds.length ? await sb.from('users').select('id, name').in('id', userIds) : { data: [] as any[] }
  const name = new Map((users || []).map((u: any) => [u.id, u.name]))
  if (ids.length) await sb.from('sam_conversation_reads').insert(ids.map(id => ({ conversation_id: id, user_id: me.id })))
  return NextResponse.json({
    ok: true,
    conversations: list.map(c => ({ ...c, chauffeur: name.get(c.user_id) || null, messages: (msgs || []).filter((m: any) => m.conversation_id === c.id) })),
  })
}
