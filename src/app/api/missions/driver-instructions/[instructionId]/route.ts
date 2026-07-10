// src/app/api/missions/driver-instructions/[instructionId]/route.ts
//
// PATCH  → accusé de lecture chauffeur : { acknowledge: true } pose
//          acknowledged_at = now (au clic « OK » du pop-up). Le chauffeur assigné
//          (ou le staff) peut accuser.
// DELETE → suppression d'une instruction (dispatch/admin/superadmin ou créateur).
//
// Olivier 2026-07-10.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function getActor() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const sb = createAdminClient()
  const { data } = await sb.from('users').select('id, role, roles').eq('email', session.user.email).maybeSingle()
  return data ?? null
}

export async function PATCH(req: Request, { params }: { params: { instructionId: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (!body?.acknowledge) return NextResponse.json({ error: 'Rien à faire' }, { status: 400 })

  const sb = createAdminClient()
  // Vérifie que l'acteur est bien le chauffeur assigné à la mission (ou staff).
  const { data: instr } = await sb.from('mission_driver_instructions')
    .select('id, mission_id, acknowledged_at').eq('id', params.instructionId).maybeSingle()
  if (!instr) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  // Idempotent : déjà accusé → on ne réécrit pas l'horodatage.
  if (instr.acknowledged_at) return NextResponse.json({ ok: true, already: true })

  const { data: mission } = await sb.from('incoming_missions')
    .select('assigned_to').eq('id', instr.mission_id).maybeSingle()
  const roles: string[] = Array.isArray((actor as any).roles) ? (actor as any).roles : (actor.role ? [actor.role] : [])
  const isStaff = roles.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))
  if (mission?.assigned_to !== actor.id && !isStaff) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const { error } = await sb.from('mission_driver_instructions')
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: actor.id })
    .eq('id', params.instructionId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: { instructionId: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { error } = await sb.from('mission_driver_instructions')
    .delete().eq('id', params.instructionId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
