// src/app/api/stats/touring-deroulement/route.ts
//
// Tableau « Déroulement Touring » : pour chaque mission COMEX (active + récemment
// clôturée, telles que COMEX les liste), on lit les HEURES DE POINTAGE que COMEX
// détient (= celles que Touring reçoit) : premier appel, accepté, en route, sur
// place, fin. + les délais SLA. Olivier 2026-08-06.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { loginComex, listComexMissions, getComexMissionDetail } from '@/lib/touring/comex'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const CONC = 5   // detail/get en parallèle, par lots

function diffMin(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null
  const t1 = new Date(a).getTime(), t2 = new Date(b).getTime()
  if (isNaN(t1) || isNaN(t2)) return null
  return Math.round((t2 - t1) / 60000)
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('role, roles').eq('email', session.user.email).maybeSingle()
  const roles = [(me as any)?.role, ...((me as any)?.roles || [])].filter(Boolean) as string[]
  if (!roles.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  try {
    const comex = await loginComex('dispatch')
    const missions = await listComexMissions(comex)

    const rows: any[] = []
    for (let i = 0; i < missions.length; i += CONC) {
      const batch = missions.slice(i, i + CONC)
      const out = await Promise.all(batch.map(async m => {
        let d: any = {}
        try {
          const r: any = await getComexMissionDetail(comex, { CID_DOS: m.CID_DOS, CID_SEQ_ACTION: m.CID_SEQ_ACTION })
          d = r?.content || r || {}
        } catch { /* row partielle */ }
        const send      = d.D_SEND || (m as any).D_SEND || null
        const accepte   = d.D_ACCEPT || null
        const enRoute   = d.D_START || null
        const surPlace  = d.D_ARRIVE || null
        const acceptDelai   = diffMin(send, accepte)
        const enRouteDelai  = diffMin(accepte, enRoute)
        const surPlaceDelai = diffMin(accepte, surPlace)
        return {
          cidDos: m.CID_DOS, seq: m.CID_SEQ_ACTION, plate: (m as any).NUM_PLAQUE || d.NUM_PLAQUE || '',
          loc: (m as any).LOC || d.LOC || '', gar: (m as any).LIB_GAR || d.LIB_GAR || '',
          statut: m.COD_STATUT_MTR,
          creation:     d.D_CREATION || (m as any).D_CREATION || null,
          premierAppel: d.DH_1R_APPEL || null,
          send, accepte, enRoute, surPlace, fin: d.D_FIN || null,
          acceptDelai, enRouteDelai, surPlaceDelai,
          acceptOk:   acceptDelai   == null ? null : acceptDelai   <= 7,
          enRouteOk:  enRouteDelai  == null ? null : enRouteDelai  <= 10,
          surPlaceOk: surPlaceDelai == null ? null : surPlaceDelai <= 45,
        }
      }))
      rows.push(...out)
    }
    // tri : plus récent (création) d'abord
    rows.sort((a, b) => String(b.creation || '').localeCompare(String(a.creation || '')))
    return NextResponse.json({ rows, at: new Date().toISOString() })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur COMEX' }, { status: 502 })
  }
}
