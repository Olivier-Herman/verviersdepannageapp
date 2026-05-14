// src/app/api/cron/vab-poll/route.ts
//
// Cron toutes les 5 min : login VAB COMET → liste les missions visibles
// → pour chaque mission pas encore en BDD (dedup par AssignmentId), scrape
// la page detail + INSERT dans incoming_missions.
//
// Equivalent automatise du bouton "Import VAB" cote UI, mais sans intervention
// humaine. Garantit que les nouvelles missions VAB apparaissent dans /dispatch
// en moins de 5 min sans avoir a cliquer.

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { loginVab, listVabMissions, fetchVabMissionDetail } from '@/lib/vab/scraper'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const session = await loginVab()
    const { missions, debug } = await listVabMissions(session)

    if (missions.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, debug })
    }

    const sb = createAdminClient()

    // Dedup par AssignmentId (= external_id en BDD pour les missions VAB)
    const assignmentIds = missions
      .map(m => m.detailHref?.match(/[?&]AssignmentId=(\d+)/i)?.[1])
      .filter((x): x is string => !!x)

    const { data: existing } = assignmentIds.length > 0
      ? await sb
          .from('incoming_missions')
          .select('external_id')
          .ilike('source', 'vab')
          .in('external_id', assignmentIds)
      : { data: [] as { external_id: string }[] }

    const existingSet = new Set((existing || []).map(e => e.external_id))

    const toImport = missions.filter(m => {
      const aid = m.detailHref?.match(/[?&]AssignmentId=(\d+)/i)?.[1]
      return aid && !existingSet.has(aid) && m.detailHref
    })

    if (toImport.length === 0) {
      console.log(`[cron vab-poll] OK, total=${missions.length}, deja_importees=${existingSet.size}, nouvelles=0`)
      return NextResponse.json({ ok: true, total: missions.length, already: existingSet.size, new: 0 })
    }

    let success = 0
    let failed = 0
    const errors: Array<{ missionNumber: string; error: string }> = []

    for (const item of toImport) {
      if (!item.detailHref) continue
      try {
        const detail = await fetchVabMissionDetail(session, item.detailHref, item.missionNumber)
        if ('error' in detail) {
          failed++
          errors.push({ missionNumber: item.missionNumber, error: detail.error })
          continue
        }

        // Parse date intervention
        let interventionIso: string | null = null
        if (detail.interventionAt) {
          const m = detail.interventionAt.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/)
          if (m) interventionIso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+02:00`
        }

        const aidMatch = item.detailHref.match(/[?&]AssignmentId=(\d+)/i)
        const assignmentId = aidMatch ? aidMatch[1] : null
        const fullDossier = detail.dossierNumber
          ? `${detail.missionNumber}/${detail.dossierNumber}`
          : detail.missionNumber

        const { error: insertErr } = await sb.from('incoming_missions').insert({
          external_id:        assignmentId || detail.missionNumber,
          dossier_number:     fullDossier,
          source:             'vab',
          status:             'new',
          mission_type:       detail.taskType?.toLowerCase().includes('remorquage') ? 'remorquage'
                            : detail.taskType?.toLowerCase().includes('panne')      ? 'depannage'
                            : detail.taskType?.toLowerCase().includes('livraison')  ? 'depannage'
                            : null,
          incident_type:      detail.codesDePanne,
          incident_description: detail.codesDePanne,
          client_name:        detail.clientName,
          client_phone:       detail.clientPhone,
          vehicle_plate:      detail.vehiclePlate?.replace(/\s/g, '').toUpperCase() || null,
          vehicle_brand:      detail.vehicleBrand,
          vehicle_model:      detail.vehicleModel,
          vehicle_vin:        detail.vehicleVin,
          incident_address:   [detail.fromStreet, detail.fromZip, detail.fromCity].filter(Boolean).join(', ') || null,
          incident_city:      detail.fromCity,
          destination_name:   detail.toName,
          destination_address: [detail.toStreet, detail.toZip, detail.toCity].filter(Boolean).join(', ') || null,
          parse_confidence:   0.95,
          received_at:        new Date().toISOString(),
          intervention_date:  interventionIso || new Date().toISOString(),
        })

        if (insertErr) {
          failed++
          errors.push({ missionNumber: item.missionNumber, error: `INSERT: ${insertErr.message}` })
        } else {
          success++
        }
      } catch (e: any) {
        failed++
        errors.push({ missionNumber: item.missionNumber, error: e.message || 'Erreur' })
      }
    }

    console.log(`[cron vab-poll] OK total=${missions.length} deja=${existingSet.size} attempted=${toImport.length} success=${success} failed=${failed}`)

    return NextResponse.json({
      ok: true,
      total:    missions.length,
      already:  existingSet.size,
      attempted: toImport.length,
      success,
      failed,
      errors: errors.slice(0, 10),
    })
  } catch (e: any) {
    console.error('[cron vab-poll]', e.message)
    return NextResponse.json({ error: e.message || 'Erreur cron VAB' }, { status: 500 })
  }
}
