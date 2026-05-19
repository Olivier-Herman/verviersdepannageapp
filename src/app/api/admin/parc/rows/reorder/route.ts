// src/app/api/admin/parc/rows/reorder/route.ts
//
// POST /api/admin/parc/rows/reorder
// Body: { zone_key, ordered_ids: [id1, id2, id3, ...] }
//
// Renumerote les row_number d une zone selon l ordre fourni. La
// fonction SQL reorder_parc_rows() gere l atomicite et synchronise
// les missions (incoming_missions.parc_row_number).
//
// Acces : admin / superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function ensureAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const ok = ['admin', 'superadmin'].some(r => roles.includes(r) || user.role === r)
  return ok ? user : null
}

export async function POST(req: Request) {
  const user = await ensureAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const zoneKey   = String(body.zone_key || '').trim()
  const orderedIds: number[] = Array.isArray(body.ordered_ids) ? body.ordered_ids.map((x: unknown) => Number(x)) : []

  if (!zoneKey || orderedIds.length === 0 || orderedIds.some((n: number) => !Number.isInteger(n))) {
    return NextResponse.json({ error: 'zone_key et ordered_ids (array d entiers) requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { error } = await sb.rpc('reorder_parc_rows', {
    p_zone_key:    zoneKey,
    p_ordered_ids: orderedIds,
  })

  if (error) {
    console.error('[reorder] RPC erreur:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
