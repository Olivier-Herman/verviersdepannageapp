// src/app/api/vab/import/route.ts
//
// POST /api/vab/import?mode=preview|send
//
// Preview : liste les missions visibles sur comet.vab.be et flagge celles
//           qui existent deja en BDD (via external_id).
// Send    : pour chaque mission non encore importee, recupere les details
//           depuis VAB COMET et INSERT directement dans incoming_missions
//           (source=vab, status=new). Plus rapide et fiable que l'envoi
//           mail + cron parse.
//
// Acces : admin / superadmin / dispatcher uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { loginVab, listVabMissions, fetchVabMissionDetail } from '@/lib/vab/scraper'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

interface PreviewItem {
  missionNumber: string
  detailHref:    string | null
  status:        string | null
  plate:         string | null
  fromLocation:  string | null
  toLocation:    string | null
  alreadyImported: boolean
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  const hasAccess = ['admin', 'superadmin', 'dispatcher'].includes(role)
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') === 'send' ? 'send' : 'preview'

  try {
    const session = await loginVab()
    const { missions, debug } = await listVabMissions(session)

    const sb = createAdminClient()

    // Strategy de dedup simple et fiable :
    // external_id en BDD = AssignmentId VAB (unique par sous-tache).
    // Deux lignes VAB avec meme missionNumber mais AssignmentId differents
    // = deux missions distinctes en BDD (correct car ce sont 2 sous-taches).
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

    const items: PreviewItem[] = missions.map(m => {
      const aid = m.detailHref?.match(/[?&]AssignmentId=(\d+)/i)?.[1] || null
      return {
        missionNumber: m.missionNumber,
        detailHref:    m.detailHref,
        status:        m.status,
        plate:         m.plate,
        fromLocation:  m.fromLocation,
        toLocation:    m.toLocation,
        alreadyImported: aid ? existingSet.has(aid) : false,
      }
    })

    if (mode === 'preview') {
      return NextResponse.json({
        ok: true,
        mode: 'preview',
        total: items.length,
        new:   items.filter(i => !i.alreadyImported).length,
        items,
        debug,
      })
    }

    // Lookup client par defaut source VAB
    const { data: vabCat } = await sb
      .from('mission_source_catalog')
      .select('default_billed_to_id, default_billed_to_name')
      .eq('key', 'vab')
      .maybeSingle()
    const defaultBilledToId   = vabCat?.default_billed_to_id || null
    const defaultBilledToName = vabCat?.default_billed_to_name || null

    // ── Mode send : scrape detail + insert direct en BDD ────────────
    const toImport = items.filter(i => !i.alreadyImported && i.detailHref)
    const results: Array<{ missionNumber: string; ok: boolean; error?: string; debug?: string }> = []

    for (const item of toImport) {
      if (!item.detailHref) {
        results.push({ missionNumber: item.missionNumber, ok: false, error: 'detailHref manquant' })
        continue
      }
      try {
        const detail = await fetchVabMissionDetail(session, item.detailHref, item.missionNumber)
        if ('error' in detail) {
          results.push({ missionNumber: item.missionNumber, ok: false, error: detail.error })
          continue
        }

        // Parse date intervention "14-05-2026 17:00:00" → ISO
        let interventionIso: string | null = null
        if (detail.interventionAt) {
          const m = detail.interventionAt.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/)
          if (m) {
            interventionIso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+02:00`
          }
        }

        // AssignmentId depuis l'URL = identifiant unique stable VAB
        const aidMatch = item.detailHref.match(/[?&]AssignmentId=(\d+)/i)
        const assignmentId = aidMatch ? aidMatch[1] : null

        // dossier_number = "missionNumber/taskNumber" (lisible) si dispo,
        // sinon juste missionNumber. detail.dossierNumber contient taskNumber.
        const fullDossier = detail.dossierNumber
          ? `${detail.missionNumber}/${detail.dossierNumber}`
          : detail.missionNumber

        // Map VAB fields → incoming_missions schema
        const insertPayload = {
          // external_id = AssignmentId : unique par sous-tache, sert a la dedup
          external_id:        assignmentId || detail.missionNumber,
          // dossier_number = "8293644/34496031" : numero complet visible par user
          dossier_number:     fullDossier,
          source:             'vab',
          status:             'new',
          mission_type:       detail.taskType?.toLowerCase().includes('remorquage') ? 'remorquage'
                            : detail.taskType?.toLowerCase().includes('panne')      ? 'depannage'
                            : detail.taskType?.toLowerCase().includes('livraison')  ? 'depannage'
                            : null,
          incident_type:      detail.codesDePanne,  // ex: "Accident de voiture"
          incident_description: detail.codesDePanne,
          // Client (assistance) = "Général" sur VAB
          client_name:        detail.clientName,
          client_phone:       detail.clientPhone,
          // Vehicule
          vehicle_plate:      detail.vehiclePlate?.replace(/\s/g, '').toUpperCase() || null,
          vehicle_brand:      detail.vehicleBrand,
          vehicle_model:      detail.vehicleModel,
          vehicle_vin:        detail.vehicleVin,
          // Lieu intervention = "Emplacement de" (depart)
          incident_address:   [detail.fromStreet, detail.fromZip, detail.fromCity].filter(Boolean).join(', ') || null,
          incident_city:      detail.fromCity,
          // Destination = "Emplacement à"
          destination_name:    detail.toName,
          destination_address: [detail.toStreet, detail.toZip, detail.toCity].filter(Boolean).join(', ') || null,
          // Meta
          parse_confidence:    0.95,
          received_at:         new Date().toISOString(),
          intervention_date:   interventionIso || new Date().toISOString(),
          // Client a facturer par defaut (configure dans /admin/sources)
          ...(defaultBilledToId ? {
            billed_to_id:   defaultBilledToId,
            billed_to_name: defaultBilledToName,
          } : {}),
        }

        const { error: insertErr } = await sb
          .from('incoming_missions')
          .insert(insertPayload)
        if (insertErr) {
          results.push({ missionNumber: item.missionNumber, ok: false, error: `INSERT: ${insertErr.message}` })
          continue
        }
        results.push({ missionNumber: item.missionNumber, ok: true })
      } catch (e: any) {
        results.push({ missionNumber: item.missionNumber, ok: false, error: e.message || 'Erreur' })
      }
    }

    const success = results.filter(r => r.ok).length
    const failed  = results.filter(r => !r.ok).length

    return NextResponse.json({
      ok: true,
      mode: 'send',
      total:   items.length,
      already: items.filter(i => i.alreadyImported).length,
      attempted: toImport.length,
      success,
      failed,
      results,
      debug,
    })
  } catch (e: any) {
    console.error('[api/vab/import]', e.message)
    return NextResponse.json({ error: e.message || 'Erreur import VAB' }, { status: 500 })
  }
}
