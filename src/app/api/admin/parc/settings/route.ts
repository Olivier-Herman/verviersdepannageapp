// src/app/api/admin/parc/settings/route.ts
//
// PATCH /api/admin/parc/settings
// Body: { canvas_height_px?, ville_destruction_email? }
//   Met a jour les settings du parc fourriere.
//   - canvas_height_px : hauteur canvas du plan visuel (400-8000)
//   - ville_destruction_email : destinataire rapport destruction AVP (Ville de Verviers)
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
  const updates: Record<string, any> = { updated_at: new Date().toISOString() }

  if (body.canvas_height_px !== undefined) {
    const height = Number(body.canvas_height_px)
    if (!Number.isInteger(height) || height < 400 || height > 8000) {
      return NextResponse.json({ error: 'canvas_height_px doit etre entre 400 et 8000' }, { status: 400 })
    }
    updates.canvas_height_px = height
  }

  if (body.ville_destruction_email !== undefined) {
    const email = String(body.ville_destruction_email || '').trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'ville_destruction_email doit etre un email valide' }, { status: 400 })
    }
    updates.ville_destruction_email = email || null
  }

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: 'Au moins un champ a mettre a jour' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('parc_settings')
    .update(updates)
    .eq('id', 1)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
