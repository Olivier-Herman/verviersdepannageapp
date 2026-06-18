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

  // Dedup par NUMERO DE DOSSIER (Olivier 2026-06-18). Le n° VAB est "X/Y" :
  //   - X (7 chiffres, AVANT le "/") = numero de DOSSIER, stable entre actions
  //   - Y = numero de MISSION, qui CHANGE a chaque nouvelle action
  // Avant on dedoublonnait sur l AssignmentId (~ mission Y) -> chaque action
  // reimportait le meme dossier (doublons). Desormais : si le DOSSIER (X) est
  // deja connu cote VD Soft, on ne reimporte pas.
  const dossierKey = (s: string | null | undefined) => String(s || '').split('/')[0].trim()

  const { data: existing } = await sb
    .from('incoming_missions')
    .select('dossier_number')
    .ilike('source', 'vab')
    .not('dossier_number', 'is', null)
    .limit(10000)
  const existingDossiers = new Set(
    (existing || []).map(e => dossierKey(e.dossier_number)).filter(Boolean)
  )

  const items: VabPreviewItem[] = missions.map(m => ({
    missionNumber:   m.missionNumber,
    detailHref:      m.detailHref,
    status:          m.status,
    plate:           m.plate,
    fromLocation:    m.fromLocation,
    toLocation:      m.toLocation,
    alreadyImported: existingDossiers.has(dossierKey(m.missionNumber)),
  }))

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

  // Dedup intra-lot : si le scan liste deux actions du MEME dossier (X), on n en
  // importe qu une seule (sinon doublon dans le meme batch).
  const seenDossiers = new Set<string>()
  const toImport = items.filter(i => {
    if (i.alreadyImported || !i.detailHref) return false
    const dk = dossierKey(i.missionNumber)
    if (dk && seenDossiers.has(dk)) return false
    if (dk) seenDossiers.add(dk)
    return true
  })
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
