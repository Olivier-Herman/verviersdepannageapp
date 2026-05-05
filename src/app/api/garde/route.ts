// src/app/api/garde/route.ts
//
// Liste les chauffeurs (towsoft_name renseigne) avec leur planning courant.
// PATCH : met a jour les 2 toggles schedule_day / schedule_night d'un user.
// Accessible aux dispatchers, admins et superadmins (pas seulement superadmin).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

const ALLOWED_ROLES = ['dispatcher', 'admin', 'superadmin']

async function checkAccess() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const u = session.user as any
  const userRoles: string[] = Array.isArray(u.roles) ? u.roles : (u.role ? [u.role] : [])
  const ok = userRoles.some(r => ALLOWED_ROLES.includes(r))
  return ok ? session : null
}

export async function GET() {
  const session = await checkAccess()
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('users')
    .select('id, name, towsoft_name, schedule_day, schedule_night, active')
    .eq('active', true)
    .not('towsoft_name', 'is', null)
    .neq('towsoft_name', '')
    .order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function PATCH(req: Request) {
  const session = await checkAccess()
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json()
  const { user_id, schedule_day, schedule_night } = body
  if (!user_id) return NextResponse.json({ error: 'user_id requis' }, { status: 400 })

  const updates: Record<string, any> = {}
  if (typeof schedule_day   === 'boolean') updates.schedule_day   = schedule_day
  if (typeof schedule_night === 'boolean') updates.schedule_night = schedule_night
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Aucun champ a mettre a jour' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { error } = await sb.from('users').update(updates).eq('id', user_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
