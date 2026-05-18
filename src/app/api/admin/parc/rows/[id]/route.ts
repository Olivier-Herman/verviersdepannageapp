// src/app/api/admin/parc/rows/[id]/route.ts
//
// PATCH  /api/admin/parc/rows/:id   -> { capacity } met a jour la capacite
// DELETE /api/admin/parc/rows/:id   -> supprime (refus si des vehicules y sont)
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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await ensureAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const capacity = Number(body.capacity)
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return NextResponse.json({ error: 'capacity (int > 0) requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data: updated, error } = await sb
    .from('parc_rows')
    .update({ capacity, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ row: updated })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const user = await ensureAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()

  // Recuperer la ligne pour connaitre zone_key + row_number
  const { data: row } = await sb
    .from('parc_rows')
    .select('zone_key, row_number')
    .eq('id', params.id)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Ligne introuvable' }, { status: 404 })

  // Verifier qu'aucun vehicule n'est sur cette ligne
  const { count } = await sb
    .from('incoming_missions')
    .select('id', { count: 'exact', head: true })
    .eq('parc_zone_key', row.zone_key)
    .eq('parc_row_number', row.row_number)
  if ((count || 0) > 0) {
    return NextResponse.json({
      error: `Impossible de supprimer : ${count} vehicule(s) sur cette ligne. Deplace-les d'abord.`,
    }, { status: 409 })
  }

  const { error } = await sb.from('parc_rows').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
