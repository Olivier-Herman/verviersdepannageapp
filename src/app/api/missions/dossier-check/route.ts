// src/app/api/missions/vab-dossier-check/route.ts
//
// POST { mission_ids: string[] }
//   → détecte les dossiers (préfixe avant '/') partagés par des VÉHICULES
//     différents = probable erreur d'encodage. Toutes sources, groupé par source.
//   Réponse : { conflicts: { [mission_id]: { prefix, others:[{mission_number,plate}] } } }
//
// Utilisé par le module Facturation (lot) et la fiche mission (dispatch).
// Accès : staff (admin/superadmin/dispatcher) ou module facturation. Olivier 2026-07-28.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { dossierPrefix, findDossierConflicts, type DossierKey } from '@/lib/missions/dossier-consistency'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role: string = user?.role || ''
  const modules: string[] = Array.isArray(user?.modules) ? user.modules : []
  const ok = ['admin', 'superadmin', 'dispatcher'].includes(role) || modules.includes('facturation')
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.mission_ids) ? body.mission_ids.map(String) : []
  if (ids.length === 0) return NextResponse.json({ conflicts: {} })

  const sb = createAdminClient()
  const { data: mine } = await sb
    .from('incoming_missions')
    .select('id, dossier_number, source')
    .in('id', ids)

  // Clé (source, préfixe) de chaque mission ayant un dossier.
  const byMissionKey = new Map<string, { source: string; prefix: string }>()
  const keys: DossierKey[] = []
  for (const m of (mine || [])) {
    const pre = dossierPrefix(m.dossier_number)
    if (!pre) continue
    const source = (m.source || '').toLowerCase()
    byMissionKey.set(m.id, { source, prefix: pre })
    keys.push({ source, prefix: pre })
  }

  const conflictsByKey = await findDossierConflicts(sb, keys)

  const conflicts: Record<string, { prefix: string; type: string; others: { mission_number: number | null; plate: string | null }[] }> = {}
  for (const [missionId, { source, prefix }] of byMissionKey) {
    const conf = conflictsByKey.get(`${source}::${prefix}`)
    if (!conf) continue
    conflicts[missionId] = {
      prefix,
      type: conf.type,
      others: conf.missions
        .filter(x => x.id !== missionId)
        .map(x => ({ mission_number: x.mission_number, plate: x.plate })),
    }
  }

  return NextResponse.json({ conflicts })
}
