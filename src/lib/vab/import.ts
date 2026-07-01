// src/lib/vab/import.ts
//
// Helper partagé pour l import VAB. Appelé par :
//   - /api/cron/vab-poll  (cron auto toutes les 5 min, mode send)
//   - /api/vab/import     (bouton "Import VAB" dispatch, mode preview ou send)
//
// Garantit un mapping unique VAB COMET → incoming_missions. Avant : 2 endpoints
// avec mapping dupliqué qui drifte (bug du 2026-05-18 où assisted_name +
// vehicle_fuel manquaient sur le bouton manuel).

import { createAdminClient } from '@/lib/supabase'
import { loginVab, listVabMissions, fetchVabMissionDetail } from './scraper'
import { sendPushToRole, sendPushToUser } from '@/lib/push'

export type VabImportMode = 'preview' | 'send'

export interface VabPreviewItem {
  missionNumber:   string
  detailHref:      string | null
  status:          string | null
  plate:           string | null
  fromLocation:    string | null
  toLocation:      string | null
  alreadyImported: boolean
}

export interface VabImportResult {
  ok:       boolean
  mode:     VabImportMode
  total:    number       // nombre de missions visibles sur VAB
  already:  number       // deja en BDD
  newCount: number       // total - already (pour UI)
  attempted: number      // nombre tentees a importer (mode send uniquement)
  success:  number       // nombre inserees avec succes
  failed:   number
  items?:   VabPreviewItem[]
  results?: Array<{ missionNumber: string; ok: boolean; error?: string }>
  debug?:   string
}

export async function runVabImport(opts: { mode: VabImportMode }): Promise<VabImportResult> {
  const mode = opts.mode

  const session = await loginVab()
  const { missions, debug } = await listVabMissions(session)

  const sb = createAdminClient()

  // Dedup par AssignmentId (= external_id en BDD pour les missions VAB)
  const assignmentIds = missions
    .map(m => m.detailHref?.match(/[?&]AssignmentId=(\d+)/i)?.[1])
    .filter((x): x is string => !!x)

  const { data: existing } = assignmentIds.length > 0
    ? await sb.from('incoming_missions')
        .select('external_id')
        .ilike('source', 'vab')
        .in('external_id', assignmentIds)
    : { data: [] as { external_id: string }[] }

  const existingSet = new Set((existing || []).map(e => e.external_id))

  const items: VabPreviewItem[] = missions.map(m => {
    const aid = m.detailHref?.match(/[?&]AssignmentId=(\d+)/i)?.[1] || null
    return {
      missionNumber:   m.missionNumber,
      detailHref:      m.detailHref,
      status:          m.status,
      plate:           m.plate,
      fromLocation:    m.fromLocation,
      toLocation:      m.toLocation,
      alreadyImported: aid ? existingSet.has(aid) : false,
    }
  })

  const already = items.filter(i => i.alreadyImported).length

  if (mode === 'preview') {
    return {
      ok:        true,
      mode:      'preview',
      total:     items.length,
      already,
      newCount:  items.length - already,
      attempted: 0,
      success:   0,
      failed:    0,
      items,
      debug,
    }
  }

  // Mode send : scrape detail + insert
  const { data: vabCat } = await sb
    .from('mission_source_catalog')
    .select('default_billed_to_id, default_billed_to_name')
    .eq('key', 'vab')
    .maybeSingle()
  const defaultBilledToId   = vabCat?.default_billed_to_id || null
  const defaultBilledToName = vabCat?.default_billed_to_name || null

  const toImport = items.filter(i => !i.alreadyImported && i.detailHref)
  const results: Array<{ missionNumber: string; ok: boolean; error?: string }> = []
  let success = 0, failed = 0

  for (const item of toImport) {
    if (!item.detailHref) {
      results.push({ missionNumber: item.missionNumber, ok: false, error: 'detailHref manquant' })
      failed++
      continue
    }
    try {
      const detail = await fetchVabMissionDetail(session, item.detailHref, item.missionNumber)
      if ('error' in detail) {
        results.push({ missionNumber: item.missionNumber, ok: false, error: detail.error })
        failed++
        continue
      }

      // Parse date intervention "14-05-2026 17:00:00" → ISO
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

      const desiredType = detail.taskType?.toLowerCase().includes('remorquage') ? 'remorquage'
                        : detail.taskType?.toLowerCase().includes('panne')      ? 'depannage'
                        : detail.taskType?.toLowerCase().includes('livraison')  ? 'depannage'
                        : 'depannage'
      const destAddr = [detail.toStreet, detail.toZip, detail.toCity].filter(Boolean).join(', ') || null

      // ── Anti-doublon / enrichissement par DOSSIER (Olivier 2026-07-01) ──────
      // Le dossier VAB = la valeur AVANT le "/" (dossier stable). La valeur APRÈS
      // le "/" est la référence de l'ACTION. Quand un dépannage devient un
      // remorquage, VAB crée une NOUVELLE action (nouvel AssignmentId + nouvelle
      // réf) sur le MÊME dossier → avant, on créait un doublon. Désormais, si une
      // fiche existe déjà pour ce dossier de base, on l'ENRICHIT (type → remorquage
      // + destination/garage) au lieu d'insérer une 2e fiche.
      const dossierBase = (fullDossier.split('/')[0] || fullDossier).trim()
      if (dossierBase && dossierBase.length >= 4) {
        const { data: existingRows } = await sb.from('incoming_missions')
          .select('id, mission_type, destination_name, destination_address, status, assigned_to, mission_number')
          .ilike('source', 'vab')
          .or(`dossier_number.ilike.${dossierBase}/%,dossier_number.eq.${dossierBase}`)
          .not('status', 'in', '("ignored","cancelled")')
          .order('created_at', { ascending: false })
        const fiche = (existingRows || [])[0] || null
        if (fiche) {
          const wasUpgrade = fiche.mission_type !== 'remorquage' && desiredType === 'remorquage'
          const upd: Record<string, any> = {}
          if (wasUpgrade) upd.mission_type = 'remorquage'
          if (detail.toName && !fiche.destination_name)    upd.destination_name    = detail.toName
          if (destAddr      && !fiche.destination_address)  upd.destination_address = destAddr
          const destAdded = !!(upd.destination_name || upd.destination_address)

          if (Object.keys(upd).length > 0) {
            upd.updated_at = new Date().toISOString()
            await sb.from('incoming_missions').update(upd).eq('id', fiche.id)
            const destTxt = upd.destination_address || upd.destination_name || fiche.destination_address || fiche.destination_name || ''
            await sb.from('mission_logs').insert({
              mission_id: fiche.id,
              action:     wasUpgrade ? 'mission_type_escalated_rem' : 'rem_destination_completed',
              notes:      wasUpgrade
                ? `VAB : dépannage requalifié en REMORQUAGE (nouvelle action VAB).${destTxt ? ` Destination : ${destTxt}.` : ''}`
                : `VAB : destination remorquage complétée (nouvelle action VAB).${destTxt ? ` Destination : ${destTxt}.` : ''}`,
              metadata:   { external_id: assignmentId, dossier_base: dossierBase, previous_type: fiche.mission_type, previous_status: fiche.status },
            })
            if (fiche.assigned_to && (wasUpgrade || destAdded)) {
              await sendPushToUser(fiche.assigned_to, {
                title: wasUpgrade ? '🔀 Dépannage devenu remorquage' : '📍 Destination de remorquage',
                body:  wasUpgrade
                  ? `Ta mission #${fiche.mission_number ?? ''} passe en REMORQUAGE.${destTxt ? ' Destination : ' + destTxt : ''}`.trim()
                  : `Mission #${fiche.mission_number ?? ''} : destination = ${destTxt}`.trim(),
                url:   `/mission/${fiche.id}`,
              })
            }
            if (wasUpgrade) {
              await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
                title: '🔀 Dépannage → Remorquage (VAB)',
                body:  `Mission #${fiche.mission_number ?? ''} requalifiée en remorquage par VAB.`,
                url:   '/dispatch',
              })
            }
            console.log(`[VAB] Dossier ${dossierBase} : fiche ${fiche.id} enrichie (${wasUpgrade ? 'REM' : 'destination'})`)
          }
          // Fiche existante trouvée → on n'insère JAMAIS de doublon.
          results.push({ missionNumber: item.missionNumber, ok: true })
          success++
          continue
        }
      }

      // Construction de l adresse d intervention (rue + code postal + ville
      // + texte libre type "ENFACE N5" ou autoroute si dispo)
      const addressParts: string[] = []
      if (detail.fromStreet) addressParts.push(detail.fromStreet)
      if (detail.fromZip || detail.fromCity) {
        addressParts.push([detail.fromZip, detail.fromCity].filter(Boolean).join(' '))
      }
      let incidentAddress = addressParts.filter(Boolean).join(', ') || null
      if (detail.fromLocationFreeText && incidentAddress) {
        incidentAddress = `${incidentAddress} — ${detail.fromLocationFreeText}`
      } else if (detail.fromLocationFreeText && !incidentAddress) {
        incidentAddress = detail.fromLocationFreeText
      }

      const { error: insertErr } = await sb.from('incoming_missions').insert({
        external_id:        assignmentId || detail.missionNumber,
        dossier_number:     fullDossier,
        source:             'vab',
        source_format:      'vab-scraper',
        status:             'new',
        // Olivier 2026-06-04 : defaut DSP (depannage) si type non identifie
        // depuis taskType, pour eviter les missions sans mission_type qui
        // bloquent l affichage / le dispatch.
        mission_type:       detail.taskType?.toLowerCase().includes('remorquage') ? 'remorquage'
                          : detail.taskType?.toLowerCase().includes('panne')      ? 'depannage'
                          : detail.taskType?.toLowerCase().includes('livraison')  ? 'depannage'
                          : 'depannage',
        incident_type:      detail.codesDePanne,
        incident_description: detail.codesDePanne,
        // Sémantique VD Soft : client_name = "personne sur place" (lu partout
        // dans l app : DispatchClient, DetailClient "Client assisté"...). Pour
        // VAB pre-acceptation, l assurance (detail.clientName) est vide -> on
        // utilise fromName comme client_name principal. On preserve aussi
        // assisted_name pour traçabilite.
        client_name:        detail.clientName || detail.fromName,
        client_phone:       detail.clientPhone || detail.fromPhone,
        assisted_name:      detail.fromName,
        assisted_phone:     detail.fromPhone,
        vehicle_plate:      detail.vehiclePlate?.replace(/\s/g, '').toUpperCase() || null,
        vehicle_brand:      detail.vehicleBrand,
        vehicle_model:      detail.vehicleModel,
        vehicle_vin:        detail.vehicleVin,
        vehicle_fuel:       detail.vehicleFuel,
        incident_address:   incidentAddress,
        incident_city:      detail.fromCity,
        destination_name:   detail.toName,
        destination_address: [detail.toStreet, detail.toZip, detail.toCity].filter(Boolean).join(', ') || null,
        parse_confidence:   0.95,
        raw_content:        detail.rawSnippet || null,
        received_at:        new Date().toISOString(),
        intervention_date:  interventionIso || new Date().toISOString(),
        ...(defaultBilledToId ? {
          billed_to_id:   defaultBilledToId,
          billed_to_name: defaultBilledToName,
        } : {}),
      })

      if (insertErr) {
        results.push({ missionNumber: item.missionNumber, ok: false, error: `INSERT: ${insertErr.message}` })
        failed++
      } else {
        results.push({ missionNumber: item.missionNumber, ok: true })
        success++
      }
    } catch (e: any) {
      results.push({ missionNumber: item.missionNumber, ok: false, error: e.message || 'Erreur' })
      failed++
    }
  }

  return {
    ok:        true,
    mode:      'send',
    total:     items.length,
    already,
    newCount:  items.length - already,
    attempted: toImport.length,
    success,
    failed,
    items,
    results,
    debug,
  }
}
