// src/app/api/admin/vab/state/route.ts
//
// GET (superadmin, READ-ONLY) — état courant de la/les mission(s) VAB : détail +
// inventaire des boutons/targets/champs (dumpVabActions). Alimente la console VAB.
// Olivier 2026-08-08.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { loginVab, listVabMissions, fetchVabMissionDetail, dumpVabActions } from '@/lib/vab/scraper'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const roles = Array.isArray(user?.roles) ? user.roles : [user?.role].filter(Boolean)
  if (!roles?.includes('superadmin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const sess = await loginVab()
    const list = await listVabMissions(sess)
    const missions: any[] = []
    for (const m of list.missions) {
      if (!m.detailHref) continue
      const detail = await fetchVabMissionDetail(sess, m.detailHref, m.missionNumber)
      const dump = await dumpVabActions(sess, m.detailHref)
      missions.push({ missionNumber: m.missionNumber, detailHref: m.detailHref, detail: ('error' in (detail as any)) ? null : detail, dump })
    }
    return NextResponse.json({ ok: true, count: list.missions.length, missions })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
