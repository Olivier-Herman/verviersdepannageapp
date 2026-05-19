// src/app/api/parc/merge/[groupUuid]/route.ts
//
// DELETE /api/parc/merge/[groupUuid]
// Defusionne un groupe : supprime toutes ses lignes parc_slot_groups.
// Si une mission est placee sur le primary, elle reste sur ce slot
// (qui redevient un slot normal). Les ex-members redeviennent libres.
//
// Permissions : admin/superadmin ou module 'fourriere'.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: Request, { params }: { params: { groupUuid: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const normalized = roles.map(r => String(r ?? '').toLowerCase())
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const isAdmin = normalized.includes('admin') || normalized.includes('superadmin')
  if (!isAdmin && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Accès réservé aux gestionnaires fourrière.' }, { status: 403 })
  }

  const groupUuid = String(params.groupUuid || '').trim()
  if (!groupUuid) return NextResponse.json({ error: 'group_uuid requis' }, { status: 400 })

  const sb = createAdminClient()
  const { error, count } = await sb
    .from('parc_slot_groups')
    .delete({ count: 'exact' })
    .eq('group_uuid', groupUuid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, removed: count ?? 0 })
}
