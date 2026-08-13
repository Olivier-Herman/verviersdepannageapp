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
  success:  number       // inserted + merged (tout ce qui a "abouti")
  inserted?: number      // nouvelles fiches creees dans le dispatch
  merged?:   number      // fusionnees dans une fiche existante (relivraison, REM…)
  skipped?:  number      // sautees (ex: pas de lien detail VAB)
  failed:   number
  items?:   VabPreviewItem[]
  results?: Array<{ missionNumber: string; ok: boolean; action?: 'inserted' | 'merged' | 'skipped' | 'failed'; mergedInto?: string; error?: string }>
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

  // Une mission VAB est « déjà importée » si son AssignmentId est l'external_id
  // d'une fiche VAB, OU s'il figure dans vab_assignment_ids (action secondaire
  // rattachée à une fiche existante : relivraison, dépannage→remorquage…). Sans
  // le second critère, ces actions réapparaissaient en boucle « à importer ».
  const existingSet = new Set<string>()
  if (assignmentIds.length > 0) {
    const [byExt, byArr] = await Promise.all([
      sb.from('incoming_missions').select('external_id, vab_assignment_ids').ilike('source', 'vab').in('external_id', assignmentIds),
      sb.from('incoming_missions').select('external_id, vab_assignment_ids').ilike('source', 'vab').overlaps('vab_assignment_ids', assignmentIds),
    ])
    for (const row of [...(byExt.data || []), ...(byArr.data || [])]) {
      if (row.external_id) existingSet.add(row.external_id)
      for (const a of ((row as any).vab_assignment_ids || [])) existingSet.add(a)
    }
  }

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

  // On garde AUSSI les missions sans detailHref pour les REPORTER (sautées) au
  // lieu de les faire disparaître silencieusement (« OK mais rien n'arrive »).
  const toImport = items.filter(i => !i.alreadyImported)
  const results: Array<{ missionNumber: string; ok: boolean; action?: 'inserted' | 'merged' | 'skipped' | 'failed'; mergedInto?: string; error?: string }> = []
  let inserted = 0, merged = 0, skipped = 0, failed = 0

  for (const item of toImport) {
    if (!item.detailHref) {
      results.push({ missionNumber: item.missionNumber, ok: false, action: 'skipped', error: 'Pas de lien de détail VAB (detailHref manquant) — à traiter manuellement' })
      skipped++
      continue
    }
    try {
      const detail = await fetchVabMissionDetail(session, item.detailHref, item.missionNumber)
      if ('error' in detail) {
        results.push({ missionNumber: item.missionNumber, ok: false, action: 'failed', error: `Détail VAB illisible : ${detail.error}` })
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
        // Olivier 2026-07-06 : on n'enrichit QUE des fiches ACTIVES. Une nouvelle
        // action VAB sur un dossier dont la fiche est déjà terminée (completed /
        // to_invoice) ou annulée/ignorée doit créer une NOUVELLE fiche, pas être
        // avalée dans l'ancienne (sinon la mission n'arrive jamais dans le dispatch).
        const FICHE_COLS = 'id, mission_type, destination_name, destination_address, redelivery_address, status, assigned_to, mission_number, vab_assignment_ids, vehicle_plate'
        const incomingPlate = detail.vehiclePlate?.replace(/\s/g, '').toUpperCase() || null
        const { data: existingRows } = await sb.from('incoming_missions')
          .select(FICHE_COLS)
          .ilike('source', 'vab')
          .or(`dossier_number.ilike.${dossierBase}/%,dossier_number.eq.${dossierBase}`)
          .not('status', 'in', '("ignored","cancelled","completed","to_invoice")')
          .order('created_at', { ascending: false })
        let fiche: any = (existingRows || [])[0] || null

        // Garde-fou PLAQUE : un même dossier VAB peut porter une action sur un
        // AUTRE véhicule (2e voiture). Dans ce cas ce n'est pas une suite, c'est
        // une mission à part → elle mérite sa fiche. Olivier 2026-08-13.
        if (fiche && incomingPlate && fiche.vehicle_plate && fiche.vehicle_plate !== incomingPlate) fiche = null

        // Repli PAR PLAQUE : VAB ouvre parfois un dossier DIFFÉRENT pour le
        // remorquage qui suit un dépannage (vu en réel : 8316292 → 8315113,
        // 8326166 → 8327858). Le rapprochement par dossier ne peut alors rien
        // voir, et une 2e fiche atterrissait dans l'écran de commande, qu'un
        // humain annulait à la main. Même plaque + fiche encore ouverte = c'est
        // la suite de la même intervention. Olivier 2026-08-13.
        if (!fiche && incomingPlate) {
          const { data: byPlate } = await sb.from('incoming_missions')
            .select(FICHE_COLS)
            .ilike('source', 'vab')
            .eq('vehicle_plate', incomingPlate)
            .not('status', 'in', '("ignored","cancelled","completed","to_invoice")')
            .gte('received_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
            .order('created_at', { ascending: false }).limit(1)
          fiche = (byPlate || [])[0] || null
          if (fiche) console.log(`[VAB] ${incomingPlate} : suite rattachée par PLAQUE (dossiers différents) → fiche ${fiche.id}`)
        }

        if (fiche) {
          const wasUpgrade = fiche.mission_type !== 'remorquage' && desiredType === 'remorquage'
          const upd: Record<string, any> = {}
          if (wasUpgrade) upd.mission_type = 'remorquage'
          if (detail.toName && !fiche.destination_name)    upd.destination_name    = detail.toName
          if (destAddr      && !fiche.destination_address)  upd.destination_address = destAddr

          // Véhicule DÉJÀ en parc requalifié en remorquage : la destination VAB
          // est l'adresse de RELIVRAISON (là où relivrer depuis le parc). C'est
          // ce champ (redelivery_address) que lit la carte Relivraison — pas
          // destination_address (= le parc une fois garé). Olivier 2026-07-06.
          // À défaut d'adresse complète, on met au moins le nom du garage pour
          // que le dispatcher ait un point de départ à compléter.
          const relivTarget = destAddr || detail.toName || null
          if (fiche.status === 'parked' && relivTarget && !(fiche as any).redelivery_address) {
            upd.redelivery_address = relivTarget
          }

          const destAdded = !!(upd.destination_name || upd.destination_address || upd.redelivery_address)
          // Un AssignmentId encore inconnu sur une fiche du même véhicule est déjà
          // un changement en soi : c'est une nouvelle action VAB sur cette
          // intervention. Sans ça, on créait une 2e fiche que le dispatch
          // annulait à la main (vu 5× en 90 jours). Olivier 2026-08-13.
          const curIds: string[] = Array.isArray((fiche as any).vab_assignment_ids) ? (fiche as any).vab_assignment_ids : []
          const newAssignment = !!assignmentId && !curIds.includes(assignmentId)
          const realChange = wasUpgrade || destAdded || newAssignment

          // On ne FUSIONNE (rattacher à la fiche existante sans créer de fiche) QUE
          // si c'est une vraie escalation du MÊME dossier : dépannage→remorquage,
          // complétion destination / adresse de relivraison. Sinon (rien à
          // enrichir) c'est une action DISTINCTE du même n° de dossier (ex : 2e
          // véhicule / action sans fiche) → elle mérite sa PROPRE fiche : on tombe
          // dans l'INSERT ci-dessous au lieu de l'avaler en no-op. Olivier 2026-07-06.
          if (realChange) {
            if (assignmentId) {
              const curAids: string[] = Array.isArray((fiche as any).vab_assignment_ids) ? (fiche as any).vab_assignment_ids : []
              if (!curAids.includes(assignmentId)) upd.vab_assignment_ids = [...curAids, assignmentId]
            }
            upd.updated_at = new Date().toISOString()
            await sb.from('incoming_missions').update(upd).eq('id', fiche.id)

            const relivTxt = upd.redelivery_address || ''
            const destTxt  = upd.destination_address || upd.destination_name || fiche.destination_address || fiche.destination_name || relivTxt || ''
            await sb.from('mission_logs').insert({
              mission_id: fiche.id,
              action:     wasUpgrade ? 'mission_type_escalated_rem' : 'rem_destination_completed',
              notes:      wasUpgrade
                ? `VAB : dépannage requalifié en REMORQUAGE (nouvelle action VAB).${destTxt ? ` Destination : ${destTxt}.` : ''}${relivTxt ? ` Adresse de relivraison : ${relivTxt}.` : ''}`
                : `VAB : destination remorquage complétée (nouvelle action VAB).${destTxt ? ` Destination : ${destTxt}.` : ''}${relivTxt ? ` Adresse de relivraison : ${relivTxt}.` : ''}`,
              metadata:   { external_id: assignmentId, dossier_base: dossierBase, previous_type: fiche.mission_type, previous_status: fiche.status },
            })
            if (fiche.assigned_to) {
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

            results.push({ missionNumber: item.missionNumber, ok: true, action: 'merged', mergedInto: fiche.mission_number != null ? `#${fiche.mission_number}` : undefined })
            merged++
            continue
          }
          // Pas d'escalation réelle → on ne fusionne pas : on laisse l'INSERT créer
          // une nouvelle fiche pour cette action distincte.
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
        // Mémorise l'AssignmentId pour la dédup future (fin de la boucle d'import).
        vab_assignment_ids: assignmentId ? [assignmentId] : [],
        ...(defaultBilledToId ? {
          billed_to_id:   defaultBilledToId,
          billed_to_name: defaultBilledToName,
        } : {}),
      })

      if (insertErr) {
        results.push({ missionNumber: item.missionNumber, ok: false, action: 'failed', error: `INSERT: ${insertErr.message}` })
        failed++
      } else {
        results.push({ missionNumber: item.missionNumber, ok: true, action: 'inserted' })
        inserted++
      }
    } catch (e: any) {
      results.push({ missionNumber: item.missionNumber, ok: false, action: 'failed', error: e.message || 'Erreur' })
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
    success:   inserted + merged,
    inserted,
    merged,
    skipped,
    failed,
    items,
    results,
    debug,
  }
}
