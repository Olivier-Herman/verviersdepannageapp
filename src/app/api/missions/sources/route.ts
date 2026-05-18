// src/app/api/missions/sources/route.ts
//
// GET /api/missions/sources
// Liste les sources connues pour usage dispatcher (dropdown fiche mission).
// Accessible a tout utilisateur authentifie (dispatcher / admin / superadmin).
// Combine mission_sources (mappings) + sources distinctes vues dans
// incoming_missions + sources canoniques hardcoded en fallback.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const KNOWN_SOURCES: Record<string, string> = {
  touring:               'Touring',
  allianz:               'Allianz',
  ethias:                'Ethias',
  vivium:                'Vivium',
  axa:                   'AXA',
  ardenne:               'Ardenne Assistance',
  mondial:               'Mondial Assistance',
  vab:                   'VAB',
  appel_police_accident: 'Appel Police - Accident',
  prive:                 'Privé',
  garage:                'Garage',
  autre:                 'Autre',
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()

  const [{ data: mapped }, { data: missionsSampled }] = await Promise.all([
    sb.from('mission_sources').select('source, label'),
    sb.from('incoming_missions').select('source').not('source', 'is', null).limit(5000),
  ])

  const sourceMap = new Map<string, string>()
  for (const [key, label] of Object.entries(KNOWN_SOURCES)) sourceMap.set(key, label)
  for (const m of mapped || []) {
    const key = (m.source || '').toLowerCase().trim()
    if (key) sourceMap.set(key, m.label || key)
  }
  for (const m of missionsSampled || []) {
    const key = (m.source || '').toLowerCase().trim()
    if (key && !sourceMap.has(key)) sourceMap.set(key, key)
  }

  const sources = Array.from(sourceMap.entries())
    .map(([source, label]) => ({ source, label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return NextResponse.json({ ok: true, sources })
}
