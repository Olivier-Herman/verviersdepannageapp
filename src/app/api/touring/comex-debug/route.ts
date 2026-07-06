// src/app/api/touring/comex-debug/route.ts
//
// Debug superadmin : vérifie que la connexion COMEX + la lecture des missions
// fonctionnent en runtime (login → rest/Mission/list → détail de la 1re).
// Lecture seule, ne modifie RIEN côté Touring.
//
// GET /api/touring/comex-debug

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { loginComex, listComexMissions, getComexMissionDetail } from '@/lib/touring/comex'
import { mapComexToMission } from '@/lib/touring/map-mission'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = session.user as any
  const roles: string[] = Array.isArray(u.roles) ? u.roles : (u.role ? [u.role] : [])
  if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const comex = await loginComex('dispatch')
    const missions = await listComexMissions(comex)

    // Aperçu compact (les champs clés du parsing)
    const preview = missions.slice(0, 10).map(m => ({
      dossier:  m.CID_DOS,
      seq:      m.CID_SEQ_ACTION,
      statut:   m.COD_STATUT_MTR,
      type:     m.LIB_GAR,
      plaque:   m.NUM_PLAQUE,
      vehicule: [m.LIB_MARQUE, m.LIB_MODELE].filter(Boolean).join(' '),
      from:     [m.CP, m.LOC].filter(Boolean).join(' '),
      to:       [m.TO_CP, m.TO_LOC].filter(Boolean).join(' '),
      siabis:   m.FL_ZONE_SIABIS,
      cree:     m.D_CREATION,
    }))

    // DRY-RUN : mappe la 1re mission NON terminée (statut ≠ 07) vers la fiche
    // VD Soft qui SERAIT créée — AUCUNE écriture BDD. Sert à vérifier le parsing.
    let dryRunFiche: any = null
    const firstActive = missions.find(m => m.COD_STATUT_MTR !== '07') || missions[0]
    if (firstActive) {
      try {
        const d = await getComexMissionDetail(comex, { CID_DOS: firstActive.CID_DOS, CID_SEQ_ACTION: firstActive.CID_SEQ_ACTION })
        const detail = d?.content || d || {}
        dryRunFiche = mapComexToMission({ detail, status: 'new' })
      } catch (e: any) { dryRunFiche = { error: e.message } }
    }

    // Répartition des statuts (pour repérer le code "à valider" quand il apparaîtra)
    const statuts: Record<string, number> = {}
    for (const m of missions) statuts[m.COD_STATUT_MTR] = (statuts[m.COD_STATUT_MTR] || 0) + 1

    return NextResponse.json({
      ok: true, login: comex.login, total: missions.length,
      statuts,                     // ex {"04":2,"06":1,"07":16} — un code inconnu = "à valider"
      preview, dryRunFiche,        // dryRunFiche = fiche VD Soft mappée (non insérée)
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
