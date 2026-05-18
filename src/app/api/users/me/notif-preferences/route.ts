// src/app/api/users/me/notif-preferences/route.ts
//
// GET  → retourne les notif_preferences du user connecte (default {} si vide)
// POST → met a jour les preferences (merge avec l existant). Body : { key: bool }
//
// Cles reconnues : dispatch_new_mission, driver_assigned, driver_modified,
// cash_transfer, derogation_request, alert_admin. Voir lib/push.ts NotifType.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ALLOWED_KEYS = [
  'dispatch_new_mission',
  'driver_assigned',
  'driver_modified',
  'cash_transfer',
  'derogation_request',
  'alert_admin',
]

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data } = await sb
    .from('users')
    .select('notif_preferences, role, roles, is_driver')
    .eq('email', session.user.email)
    .maybeSingle()
  if (!data) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  // Determine quels toggles afficher selon le profil du user :
  // - dispatch_*  : visible si role ∈ {admin, superadmin, dispatcher} OU dans roles[]
  // - driver_*    : visible si role = 'driver' OU 'chauffeur' dans roles OU is_driver
  // (rétro-compat : tout est visible si pas determinable)
  const roles: string[] = Array.isArray(data.roles) ? data.roles : []
  const isDispatcher = ['admin', 'superadmin', 'dispatcher'].includes(data.role) ||
    roles.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))
  const isDriver = data.role === 'driver' || roles.includes('driver') || roles.includes('chauffeur') || data.is_driver === true

  return NextResponse.json({
    ok: true,
    preferences: data.notif_preferences || {},
    profile: { isDispatcher, isDriver },
  })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as Record<string, unknown>
  // Filtre les cles autorisees et coerce en bool
  const updates: Record<string, boolean> = {}
  for (const k of ALLOWED_KEYS) {
    if (k in body) updates[k] = Boolean(body[k])
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Aucune cle reconnue' }, { status: 400 })
  }

  const sb = createAdminClient()
  // Lit l existant pour merge
  const { data: user } = await sb
    .from('users')
    .select('id, notif_preferences')
    .eq('email', session.user.email)
    .maybeSingle()
  if (!user) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  const merged = { ...(user.notif_preferences || {}), ...updates }

  const { error } = await sb
    .from('users')
    .update({ notif_preferences: merged })
    .eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, preferences: merged })
}
