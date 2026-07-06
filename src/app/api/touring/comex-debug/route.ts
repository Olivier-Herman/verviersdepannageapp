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

    // Détail de la 1re mission (adresses complètes) — best effort
    let firstDetail: any = null
    if (missions[0]) {
      try {
        const d = await getComexMissionDetail(comex, { CID_DOS: missions[0].CID_DOS, CID_SEQ_ACTION: missions[0].CID_SEQ_ACTION })
        const c = d?.content || d || {}
        firstDetail = {
          plaque:   c.NUM_PLAQUE, vin: c.NUM_CHASSIS,
          from:     [c.RUE, c.NUM_RUE, c.CP, c.LOC].filter(Boolean).join(' '),
          from_nom: c.NOM, from_tel: c.NTEL,
          to:       [c.TO_RUE, c.TO_NUM_RUE, c.TO_CP, c.TO_LOC].filter(Boolean).join(' '),
          to_nom:   c.TO_NOM,
          societe:  c.SOC_NOM, tva: c.SOC_NUMTVA,
          panne:    { cause: c.COD_PANNE_CAUSE, desc: c.COD_PANNE_DESC, result: c.COD_PANNE_RESULT },
        }
      } catch (e: any) { firstDetail = { error: e.message } }
    }

    return NextResponse.json({ ok: true, login: comex.login, total: missions.length, preview, firstDetail })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
