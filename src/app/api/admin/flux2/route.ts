// src/app/api/admin/flux2/route.ts
//
// Grille d'activation du flux 2 : chauffeurs × assistances. Superadmin uniquement.
//   GET  → chauffeurs, assistances (catalogue) et cases cochées
//   POST → coche/décoche UNE case { driverId, assistanceKey, enabled }
// Olivier 2026-08-11.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { invalidateFlux2Cache } from '@/lib/cloture/gating'

export const dynamic = 'force-dynamic'

/** Assistances proposées : celles pour lesquelles une transformation existe ou
 *  viendra. On n'expose pas les 30 sources du catalogue — cocher « garage » ou
 *  « unknown » n'aurait aucun sens tant qu'aucune clôture n'est branchée derrière. */
const SUPPORTED = ['touring', 'vab', 'kaze', 'allianz', 'axa', 'mondial', 'prive'] as const

async function guard() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, role, roles').eq('email', session.user.email).maybeSingle()
  const roles = [(me as any)?.role, ...((me as any)?.roles || [])].filter(Boolean) as string[]
  if (!roles.includes('superadmin')) return { error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  return { sb, me }
}

export async function GET() {
  const g = await guard(); if ('error' in g) return g.error
  const { sb } = g

  const [{ data: drivers }, { data: cat }, { data: grid }] = await Promise.all([
    sb.from('users').select('id, name, email, role, roles, is_active')
      .or('role.in.(driver,chauffeur),roles.ov.{driver,chauffeur}')
      .order('name'),
    sb.from('mission_source_catalog').select('key, label').in('key', SUPPORTED as any),
    sb.from('flux2_activation').select('driver_id, assistance_key, enabled'),
  ])

  const labels = new Map((cat || []).map((c: any) => [c.key, c.label]))
  const assistances = SUPPORTED.map(k => ({ key: k, label: labels.get(k) || k }))
  const enabled: Record<string, boolean> = {}
  for (const r of (grid || []) as any[]) if (r.enabled) enabled[`${r.driver_id}|${r.assistance_key}`] = true

  return NextResponse.json({
    assistances,
    drivers: (drivers || []).filter((d: any) => d.is_active !== false)
      .map((d: any) => ({ id: d.id, name: d.name || d.email })),
    enabled,
  })
}

export async function POST(req: Request) {
  const g = await guard(); if ('error' in g) return g.error
  const { sb, me } = g

  const b = await req.json().catch(() => ({}))
  const driverId = String(b?.driverId || '')
  const key      = String(b?.assistanceKey || '')
  const enabled  = !!b?.enabled
  if (!driverId || !(SUPPORTED as readonly string[]).includes(key)) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
  }

  const { error } = await sb.from('flux2_activation').upsert(
    { driver_id: driverId, assistance_key: key, enabled, updated_at: new Date().toISOString(), updated_by: (me as any)?.id },
    { onConflict: 'driver_id,assistance_key' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  invalidateFlux2Cache()
  return NextResponse.json({ ok: true })
}
