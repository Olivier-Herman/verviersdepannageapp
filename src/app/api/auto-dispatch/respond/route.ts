// src/app/api/auto-dispatch/respond/route.ts
//
// POST /api/auto-dispatch/respond { attempt_id, action, response_min?, reason? }
//
// Le chauffeur repond a une notif auto-dispatch.
// Actions :
//   - 'accept'         : prend la mission (assigned_to + status='assigned')
//   - 'available_in'   : "Dispo dans X min" (mission scheduled, sera assignee
//                        en mode "differe" — le dispatcher voit l'ETA reel)
//   - 'unavailable'    : "Pas dispo" avec motif (intervention police, etc.)
//                        → skipToNext immediatement

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { skipToNext }        from '@/lib/auto-dispatch/orchestrator'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const body = await req.json() as {
    attempt_id?:    string
    action?:        'accept' | 'available_in' | 'unavailable'
    response_min?:  number  // pour 'available_in'
    reason?:        string  // pour 'unavailable'
  }
  if (!body.attempt_id || !body.action) {
    return NextResponse.json({ error: 'attempt_id et action requis' }, { status: 400 })
  }

  const sb = createAdminClient()

  // 1. Verify attempt existe et appartient au user connecte
  const { data: attempt } = await sb
    .from('dispatch_attempts_log')
    .select('id, mission_id, driver_id, status, attempt_order')
    .eq('id', body.attempt_id)
    .maybeSingle()
  if (!attempt) return NextResponse.json({ error: 'Tentative introuvable' }, { status: 404 })
  if (attempt.driver_id !== userId) {
    return NextResponse.json({ error: 'Cette tentative ne vous est pas adressee' }, { status: 403 })
  }
  if (['accepted', 'refused', 'unavailable', 'timeout', 'skipped'].includes(attempt.status)) {
    return NextResponse.json({ error: `Tentative deja close (status=${attempt.status})` }, { status: 409 })
  }

  const now = new Date().toISOString()

  // 2. Action
  if (body.action === 'accept' || body.action === 'available_in') {
    const responseMin = body.action === 'available_in' ? (body.response_min || 0) : 0

    // Update attempt
    await sb.from('dispatch_attempts_log').update({
      status:        'accepted',
      responded_at:  now,
      response_min:  responseMin,
      updated_at:    now,
    }).eq('id', attempt.id)

    // Assign mission
    await sb.from('incoming_missions').update({
      assigned_to: userId,
      status:      'assigned',
      assigned_at: now,
      updated_at:  now,
    }).eq('id', attempt.mission_id)

    // Cancel autres tentatives en cours pour cette mission
    await sb.from('dispatch_attempts_log').update({
      status:     'skipped',
      updated_at: now,
    })
    .eq('mission_id', attempt.mission_id)
    .neq('id', attempt.id)
    .in('status', ['pending', 'push_sent', 'call_1_sent', 'call_2_sent'])

    return NextResponse.json({ ok: true, accepted: true, response_min: responseMin })
  }

  if (body.action === 'unavailable') {
    // Skip → passer au suivant via orchestrator
    // On a besoin de la liste candidates restante. On re-derive depuis driver-eta.
    const { data: mission } = await sb
      .from('incoming_missions')
      .select('id, dossier_number, incident_city')
      .eq('id', attempt.mission_id)
      .single()
    const missionLabel = `Mission ${mission?.dossier_number || attempt.mission_id.slice(0, 8)}${mission?.incident_city ? ' — ' + mission.incident_city : ''}`

    // Marque attempt comme unavailable
    await sb.from('dispatch_attempts_log').update({
      status:               'unavailable',
      not_available_reason: body.reason || null,
      responded_at:         now,
      updated_at:           now,
    }).eq('id', attempt.id)

    // Recharge la liste candidate via driver-eta (filtree par déjà-essayés)
    const baseUrl = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
    const cookieHeader = req.headers.get('cookie') || ''
    const etaRes = await fetch(`${baseUrl}/api/missions/${attempt.mission_id}/driver-eta`, {
      headers: { cookie: cookieHeader },
    })
    const etaData = etaRes.ok ? await etaRes.json() : { drivers: [] }
    const allCandidates = (etaData.drivers || []).filter((d: any) => d.eta_total_min != null)

    // Exclure les drivers deja essayes
    const { data: tried } = await sb
      .from('dispatch_attempts_log')
      .select('driver_id')
      .eq('mission_id', attempt.mission_id)
    const triedIds = new Set((tried || []).map(t => t.driver_id))

    const remaining = allCandidates.filter((d: any) => !triedIds.has(d.id))

    // Lookup phones
    if (remaining.length === 0) {
      // Plus de chauffeurs → escalade via skipToNext (qui appellera escalateToDispatcherOnDuty)
      await skipToNext({
        attemptId:    attempt.id,
        missionId:    attempt.mission_id,
        reason:       'unavailable',
        nextDrivers:  [],
        missionLabel,
      })
      return NextResponse.json({ ok: true, escalated: true })
    }

    const phoneIds = remaining.map((d: any) => d.id)
    const { data: phones } = await sb.from('users').select('id, phone').in('id', phoneIds)
    const phoneById = new Map((phones || []).map(p => [p.id, p.phone as string | null]))

    const nextDrivers = remaining.map((d: any) => ({
      id:    d.id,
      name:  d.name,
      phone: phoneById.get(d.id) || null,
      isInMission: d.status === 'on_mission',
    }))

    const res = await skipToNext({
      attemptId:    attempt.id,
      missionId:    attempt.mission_id,
      reason:       'unavailable',
      nextDrivers,
      missionLabel,
    })

    return NextResponse.json({ ok: res.ok, next_attempt_id: res.nextAttemptId, error: res.error })
  }

  return NextResponse.json({ error: `Action inconnue: ${body.action}` }, { status: 400 })
}
