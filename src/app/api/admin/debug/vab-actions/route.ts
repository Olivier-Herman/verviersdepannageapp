// src/app/api/admin/debug/vab-actions/route.ts
//
// GET /api/admin/debug/vab-actions  (superadmin, READ-ONLY, aucune action VAB)
// Cartographie la/les mission(s) VAB dispo : identité (plaque/type) + inventaire
// des boutons/__EVENTTARGET (Accept, Start, En route, Sur place, CheckVIN,
// Contrat, clôture…). Sert à préparer le flux de clôture AVANT de déclencher
// quoi que ce soit (VAB est irréversible). Olivier 2026-08-08.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { loginVab, listVabMissions, fetchVabMissionDetail, dumpVabActions } from '@/lib/vab/scraper'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  // Accès : superadmin OU secret interne (pilotage additif depuis un script de
  // capture, comme les crons). Lecture seule, aucune action VAB. Olivier 2026-08-09.
  const internalOk = !!process.env.NEXTAUTH_SECRET && req.headers.get('x-internal-secret') === process.env.NEXTAUTH_SECRET
  if (!internalOk) {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const user = session.user as any
    const roles = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
    if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const report: any = { ts: new Date().toISOString() }
  try {
    const sess = await loginVab()
    const list = await listVabMissions(sess)
    report.missionCount = list.missions.length

    report.missions = []
    for (const m of list.missions) {
      if (!m.detailHref) { report.missions.push({ missionNumber: m.missionNumber, note: 'pas de detailHref' }); continue }
      const detail = await fetchVabMissionDetail(sess, m.detailHref, m.missionNumber)
      const actions = await dumpVabActions(sess, m.detailHref)
      report.missions.push({
        missionNumber: m.missionNumber,
        detailHref:    m.detailHref,
        detail:        detail && !('error' in detail) ? detail : { error: (detail as any)?.error },
        buttonTexts:   actions.buttonTexts,
        actions:       actions.actions,       // { label, target(__EVENTTARGET), arg, tag, name, id }
        formAction:    actions.formAction,
        hiddenNames:   actions.hiddenNames,
      })
    }
    return NextResponse.json(report)
  } catch (e: any) {
    report.error = e?.message || String(e)
    return NextResponse.json(report, { status: 500 })
  }
}
