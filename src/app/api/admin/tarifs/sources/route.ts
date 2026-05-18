// src/app/api/admin/tarifs/sources/route.ts
//
// GET /api/admin/tarifs/sources
// Retourne la liste dynamique des sources connues (mission_sources +
// incoming_missions.source distinctes). Utilise par TarifsClient pour
// peupler les dropdowns et onglets sans hardcoder.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function requireSuperadmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const role  = (session.user as any).role  || ''
  const roles = (session.user as any).roles || [role]
  const allRoles: string[] = Array.isArray(roles) ? roles : [roles]
  if (!allRoles.includes('superadmin')) return null
  return session
}

export async function GET() {
  const session = await requireSuperadmin()
  if (!session) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const sb = createAdminClient()

  const [{ data: mapped }, { data: missionsSampled }] = await Promise.all([
    sb.from('mission_sources').select('source, label'),
    // Pour les sources qui n existent pas encore dans mission_sources mais
    // qui apparaissent en pratique dans les missions (cas legacy).
    sb.from('incoming_missions').select('source').not('source', 'is', null).limit(5000),
  ])

  const sourceMap = new Map<string, string>()
  for (const m of mapped || []) {
    const key = (m.source || '').toLowerCase().trim()
    if (key) sourceMap.set(key, m.label || key)
  }
  for (const m of missionsSampled || []) {
    const key = (m.source || '').toLowerCase().trim()
    if (key && !sourceMap.has(key)) sourceMap.set(key, key)
  }
  // Toujours inclure "autre" comme fallback
  if (!sourceMap.has('autre')) sourceMap.set('autre', 'Autre')

  const sources = Array.from(sourceMap.entries())
    .map(([source, label]) => ({ source, label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return NextResponse.json({ ok: true, sources })
}
