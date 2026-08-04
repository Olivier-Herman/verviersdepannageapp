// src/app/api/admin/mecano/conversations/route.ts
//
// Supervision « La tête à Matthieu » (superadmin) :
//   GET            → liste des conversations (groupées) + résumé
//   GET ?id=<conv> → fil complet d'une conversation
// Superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'superadmin') return NextResponse.json({ error: 'Superadmin uniquement' }, { status: 403 })
  const sb = createAdminClient()
  const id = new URL(req.url).searchParams.get('id')

  if (id) {
    const { data } = await sb.from('mecano_messages')
      .select('role, content, attachments, images_count, created_at, user_name, brand, model, mission_id')
      .eq('conversation_id', id).order('created_at')
    return NextResponse.json({ messages: data || [] })
  }

  // Liste : on agrège les derniers messages en conversations.
  const { data: rows } = await sb.from('mecano_messages')
    .select('conversation_id, user_id, user_name, brand, model, mission_id, role, content, created_at')
    .order('created_at', { ascending: false }).limit(2000)

  const byConv = new Map<string, any>()
  for (const m of (rows || []) as any[]) {
    let c = byConv.get(m.conversation_id)
    if (!c) { c = { conversation_id: m.conversation_id, user_id: m.user_id, user_name: m.user_name, brand: m.brand, model: m.model, mission_id: m.mission_id, count: 0, last_at: m.created_at, first_at: m.created_at, last_user_msg: null }; byConv.set(m.conversation_id, c) }
    c.count++
    if (m.created_at < c.first_at) c.first_at = m.created_at
    if (!c.last_user_msg && m.role === 'user') c.last_user_msg = m.content
    if (!c.brand && m.brand) c.brand = m.brand
    if (!c.user_name && m.user_name) c.user_name = m.user_name
    if (!c.user_id && m.user_id) c.user_id = m.user_id
  }
  let convs = [...byConv.values()].sort((a, b) => (a.last_at < b.last_at ? 1 : -1))

  // Vrai nom du chauffeur (le user_name stocké est le SURNOM Matthieu, ex. « Gros »,
  // partagé → inutilisable pour identifier). On joint sur user_id.
  const userIds = [...new Set(convs.map(c => c.user_id).filter(Boolean))]
  if (userIds.length) {
    const { data: us } = await sb.from('users').select('id, name, email').in('id', userIds)
    const byUid = new Map((us || []).map((u: any) => [u.id, u]))
    convs = convs.map(c => {
      const u = c.user_id ? byUid.get(c.user_id) : null
      return { ...c, user_real: u?.name || null, user_email: u?.email || null }
    })
  }

  // Statut mission (active/archivée) pour celles rattachées à une mission.
  const missionIds = [...new Set(convs.map(c => c.mission_id).filter(Boolean))]
  if (missionIds.length) {
    const { data: ms } = await sb.from('incoming_missions').select('id, status, mission_number, vehicle_plate').in('id', missionIds)
    const byId = new Map((ms || []).map((x: any) => [x.id, x]))
    const ARCHIVED = ['parked', 'completed', 'to_invoice', 'cancelled', 'invoiced']
    convs = convs.map(c => {
      const mm = c.mission_id ? byId.get(c.mission_id) : null
      return { ...c, mission_number: mm?.mission_number || null, plate: mm?.vehicle_plate || null, mission_status: mm?.status || null, archived: mm ? ARCHIVED.includes(mm.status) : false }
    })
  }
  return NextResponse.json({ conversations: convs.slice(0, 100) })
}
