// src/app/api/admin/parc/settings/route.ts
//
// PATCH /api/admin/parc/settings
// Body: { canvas_height_px }
// Met a jour la hauteur du canvas du plan du parc.
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

export async function PATCH(req: Request) {
  const user = await ensureAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const height = Number(body.canvas_height_px)
  if (!Number.isInteger(height) || height < 400 || height > 8000) {
    return NextResponse.json({ error: 'canvas_height_px doit etre entre 400 et 8000' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('parc_settings')
    .update({ canvas_height_px: height, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
