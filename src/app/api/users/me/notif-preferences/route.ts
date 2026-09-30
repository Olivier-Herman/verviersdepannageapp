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

// Nouveau systeme : 1 toggle par role (Olivier 2026-06-02). Les anciennes
// clefs per-categorie restent acceptees en retro-compat (mais l UI n en
// expose plus).
const ALLOWED_KEYS = [
  // Nouveau systeme par role
  'role_driver',
  'role_dispatcher',
  'role_finance',
  // Retro-compat
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
  const { data, error } = await sb
    .from('users')
    .select('notif_preferences, role, roles')
    .eq('email', session.user.email)
    .maybeSingle()
  if (error || !data) {
    console.error('[notif-preferences] User select error:', error?.message)
    return NextResponse.json({ error: 'User introuvable' }, { status: 404 })
  }

  // Determine quels toggles afficher selon le profil du user :
  // - dispatch_*  : visible si role ∈ {admin, superadmin, dispatcher} OU dans roles[]
  // - driver_*    : visible si role = 'driver' OU 'chauffeur' dans roles
  // Olivier 2026-06-02 : retire le champ is_driver qui n existe pas en BDD
  // (causait erreur 42703 → API 404 → tous les toggles conditionnels masques)
  const roles: string[] = Array.isArray(data.roles) ? data.roles : []
  const isDispatcher = ['admin', 'superadmin', 'dispatcher'].includes(data.role) ||
    roles.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))
  const isDriver = data.role === 'driver' || roles.includes('driver') || roles.includes('chauffeur')
  // Finance : visible si l user a un module finance ou est admin/dispatcher
  // (en pratique tous les roles peuvent recevoir des notifs de transfert
  // de caisse, donc on l affiche pour tout le monde par defaut)
  const isFinance = true

  return NextResponse.json({
    ok: true,
    preferences: data.notif_preferences || {},
    profile: { isDispatcher, isDriver, isFinance },
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
