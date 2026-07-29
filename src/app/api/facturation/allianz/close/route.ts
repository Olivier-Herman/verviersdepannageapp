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
  const isInternal = !!process.env.NEXTAUTH_SECRET && req.headers.get('x-internal-secret') === process.env.NEXTAUTH_SECRET
  const session = isInternal ? null : await getServerSession(authOptions)
  if (!isInternal && !checkAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
  const distanceKm  = body.distanceKm != null && Number.isFinite(Number(body.distanceKm)) ? Number(body.distanceKm) : undefined
  const towsoftNum  = body.towsoftNum ? String(body.towsoftNum) : null
  if (distanceKm == null && !towsoftNum) {
    return NextResponse.json({ error: 'distanceKm ou towsoftNum requis' }, { status: 400 })
  }

  const result = await closeAllianzAssignment({
    caseId,
    assignmentId,
    providedService,
    receivedIso,
    distanceKm,
    towsoftNum,
    plate:             body.plate ? String(body.plate) : null,
    towsoftDossier:    body.towsoftDossier ? String(body.towsoftDossier) : null,
    mileage:           body.mileage ? String(body.mileage) : undefined,
    finalSubCaseCause: body.finalSubCaseCause ? String(body.finalSubCaseCause) : undefined,
    destination:       body.destination || undefined,
    tariffLat:         body.tariffLat != null ? Number(body.tariffLat) : null,
    tariffLng:         body.tariffLng != null ? Number(body.tariffLng) : null,
    tariffZip:         body.tariffZip ? String(body.tariffZip) : null,
    dryRun:            !!body.dryRun,
  })

  // Olivier 2026-06-19 : si la clôture Hexalite a réussi (réel), on passe la
  // fiche VD Soft liée en AUTO-FACTURATION pour clôturer notre dossier
  // (équivalent de l'action /api/missions/invoice method=auto). Best-effort :
  // n'impacte pas la réponse de clôture Hexalite si ça échoue.
  const vdsoftMissionId = body.vdsoftMissionId ? String(body.vdsoftMissionId) : null
  if (result.ok && !body.dryRun && vdsoftMissionId) {
    try {
      const { createAdminClient } = await import('@/lib/supabase')
      const { releaseParcAndShift } = await import('@/lib/parc/release')
      const sb = createAdminClient()
      const userId = session ? (session.user as any).id || null : null
      const now = new Date().toISOString()
      const { error: updErr } = await sb.from('incoming_missions').update({
        status:         'completed',
        invoice_method: 'auto',
        invoiced_at:    now,
        invoiced_by:    userId,
        auto_invoiced:  isInternal,   // cron → compte dans « Système (auto) » ; manuel → attribué à l'user
        updated_at:     now,
      }).eq('id', vdsoftMissionId)
      if (updErr) throw new Error(updErr.message)
      try { await releaseParcAndShift(sb, vdsoftMissionId) } catch { /* hors parc : ok */ }
      await sb.from('mission_logs').insert({
        mission_id: vdsoftMissionId, actor_id: userId, action: 'invoiced',
        notes: 'Auto-facturation (clôture Allianz Hexalite)',
        metadata: { method: 'auto', allianz: true, assignmentId },
      }).then(() => {}, () => {})
      ;(result as any).vdsoft_autofactured = true
    } catch (e: any) {
      ;(result as any).vdsoft_autofacture_error = e?.message || 'échec auto-facturation VD Soft'
    }
  }

  const status = result.ok ? 200 : 502
  return NextResponse.json(result, { status })
}
