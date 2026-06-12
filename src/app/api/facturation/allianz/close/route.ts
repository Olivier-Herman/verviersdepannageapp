// src/app/api/facturation/allianz/close/route.ts
//
// POST /api/facturation/allianz/close
//   { assignmentId, caseId, providedService?, receivedIso, distanceKm,
//     mileage?, finalSubCaseCause?, destination?, tariffLat?, tariffLng?,
//     tariffZip?, dryRun? }
//
// Olivier 2026-06-12 : autoclôture d une mission Allianz (Hexalite).
// dryRun=true : GET tarifs uniquement + renvoie le payload qui SERAIT soumis
// (aucune écriture). Sinon : affectation manuelle + tarifs + soumission.
//
// Acces : admin / superadmin / module facturation.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { closeAllianzAssignment, ALLIANZ_PROVIDED_SERVICE } from '@/lib/allianz/closure'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

function checkAccess(session: any): boolean {
  if (!session) return false
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  return ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!checkAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const assignmentId = String(body.assignmentId || '').trim()
  const caseId       = String(body.caseId || '').trim()
  if (!assignmentId || !caseId) {
    return NextResponse.json({ error: 'assignmentId et caseId requis' }, { status: 400 })
  }

  // providedService : explicite, sinon mappé depuis mission_type VD Soft, sinon 'T'
  let providedService = String(body.providedService || '').trim()
  if (!providedService && body.missionType) {
    providedService = ALLIANZ_PROVIDED_SERVICE[String(body.missionType).toLowerCase()] || 'T'
  }
  if (!providedService) providedService = 'T'

  const receivedIso = String(body.receivedIso || '').trim() || new Date().toISOString()
  const distanceKm  = Number(body.distanceKm)
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return NextResponse.json({ error: 'distanceKm invalide' }, { status: 400 })
  }

  const result = await closeAllianzAssignment({
    caseId,
    assignmentId,
    providedService,
    receivedIso,
    distanceKm,
    mileage:           body.mileage ? String(body.mileage) : undefined,
    finalSubCaseCause: body.finalSubCaseCause ? String(body.finalSubCaseCause) : undefined,
    destination:       body.destination || undefined,
    tariffLat:         body.tariffLat != null ? Number(body.tariffLat) : null,
    tariffLng:         body.tariffLng != null ? Number(body.tariffLng) : null,
    tariffZip:         body.tariffZip ? String(body.tariffZip) : null,
    dryRun:            !!body.dryRun,
  })

  const status = result.ok ? 200 : 502
  return NextResponse.json(result, { status })
}
