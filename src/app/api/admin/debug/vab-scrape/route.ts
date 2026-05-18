// src/app/api/admin/debug/vab-scrape/route.ts
//
// GET /api/admin/debug/vab-scrape
// Endpoint admin debug : lance le scraper VAB synchrone et retourne tout
// (login OK, liste missions, detail premiere mission). A utiliser pour
// comprendre pourquoi le cron VAB ne ramene plus de missions.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { loginVab, listVabMissions, fetchVabMissionDetail } from '@/lib/vab/scraper'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const roles = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const report: any = { step: 'start', timestamp: new Date().toISOString() }

  try {
    report.step = 'login'
    const sessionCookies = await loginVab()
    report.login = { ok: true, cookieLen: sessionCookies.cookieHeader?.length || 0 }

    report.step = 'list'
    const listRes = await listVabMissions(sessionCookies)
    report.list = {
      ok: true,
      count: listRes.missions.length,
      debug: listRes.debug,
      missions: listRes.missions.map(m => ({
        missionNumber: m.missionNumber,
        detailHref:    m.detailHref?.slice(0, 100),
        hasDetail:     !!m.detailHref,
      })),
    }

    // Detail premiere mission (preuve que fetchVabMissionDetail fonctionne)
    if (listRes.missions.length > 0 && listRes.missions[0].detailHref) {
      report.step = 'detail-first'
      const first = listRes.missions[0]
      const detail = await fetchVabMissionDetail(sessionCookies, first.detailHref!, first.missionNumber)
      report.firstDetail = detail
    }

    report.step = 'done'
    return NextResponse.json(report)
  } catch (e: any) {
    report.error = e.message || String(e)
    report.stack = e.stack?.slice(0, 1000)
    return NextResponse.json(report, { status: 500 })
  }
}
