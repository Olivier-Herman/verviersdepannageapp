// src/app/api/admin/routing-usage/route.ts
//
// Compteur des calculs d'itinéraire et d'adresse des 14 derniers jours
// (table routing_usage, src/lib/routing/usage.ts). Superadmin. Olivier 02/10/2026.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  const roles: string[] = Array.isArray(u?.roles) ? u.roles : []
  if (!u || (u.role !== 'superadmin' && !roles.includes('superadmin'))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)
  const { data, error } = await createAdminClient()
    .from('routing_usage').select('day, provider, service, origin, calls, failures')
    .gte('day', since).order('day', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, rows: data || [] })
}
