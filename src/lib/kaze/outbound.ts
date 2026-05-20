// src/lib/kaze/outbound.ts
//
// Helpers pour pousser les transitions chauffeur de VD Soft vers Kaze
// (notification IMA Benelux en temps reel).
//
// V1 : on ajoute une NOTE sur le job Kaze a chaque action chauffeur.
//      Simple, fiable, et suffisant pour qu IMA voie l avancement
//      dans son interface sans qu on doive mapper chaque cell du
//      workflow (10 etapes, ids parfois UUIDs internes).
//
// V2 (plus tard) : mapper chaque action vers une cell specifique du
//      workflow IMA (PUT /jobs/:id/cells/:cell_id.json) pour cocher
//      les etapes officiellement + uploader les photos.

import { addNote }            from '@/lib/kaze/client'

interface MissionLite {
  id:                   string
  kaze_job_id?:         string | null
  vehicle_plate?:       string | null
  vehicle_brand?:       string | null
  vehicle_model?:       string | null
  dossier_number?:      string | null
}

/**
 * Map une action chauffeur en message FR a poster sur le job Kaze.
 * Format : ligne courte qui apparait dans l historique IMA.
 */
function actionLabel(action: string, mission: MissionLite, extra?: Record<string, any>): string | null {
  const vehLine = [mission.vehicle_brand, mission.vehicle_model, mission.vehicle_plate]
    .filter(Boolean).join(' ')

  switch (action) {
    case 'on_way':
      return `🚛 Chauffeur en route vers le lieu d'intervention.${vehLine ? ` Véhicule : ${vehLine}.` : ''}`

    case 'on_site':
      return `📍 Chauffeur arrivé sur le lieu d'intervention.`

    case 'load_vehicle':
      return `🔧 Véhicule chargé sur le camion.`

    case 'park':
      return `🅿️ Véhicule déposé en dépôt Verviers Dépannage. En attente de relivraison.`

    case 'start_delivery':
      return `🚚 Départ vers le lieu de livraison.`

    case 'depart_stop':
      return `➡️ Départ vers ${extra?.stop_label || 'étape suivante'}.`

    case 'arrive_stop':
      return `🏁 Arrivée à ${extra?.stop_label || 'étape'}.`

    case 'complete_delivery':
      return `✅ Livraison effectuée. Mission terminée côté Verviers.`

    case 'completed':
      return `✅ Mission terminée — à facturer.`

    case 'change_type':
      return `📋 Type de mission changé en ${extra?.new_type || '?'}.`

    case 'update_address':
      return `📍 Adresse "${extra?.field || ''}" mise à jour : ${extra?.value || ''}.`

    default:
      return null
  }
}

/**
 * Notifie Kaze d une action chauffeur via une note.
 * Non bloquant : ne throw jamais, juste console.warn si echec.
 * Ignore si la mission n a pas de kaze_job_id (pas une mission Kaze).
 */
export async function notifyKazeOfAction(
  mission: MissionLite,
  action:  string,
  extra?:  Record<string, any>,
): Promise<{ ok: boolean; sent: boolean; error?: string }> {
  if (!mission.kaze_job_id) {
    return { ok: true, sent: false }   // pas une mission Kaze, rien a faire
  }

  const label = actionLabel(action, mission, extra)
  if (!label) {
    return { ok: true, sent: false }   // action sans message Kaze
  }

  try {
    await addNote(mission.kaze_job_id, label)
    console.log(`[kaze-outbound] Note envoyee a Kaze (${mission.kaze_job_id}): ${label.slice(0, 80)}`)
    return { ok: true, sent: true }
  } catch (e: any) {
    console.warn(`[kaze-outbound] addNote echoue (${mission.kaze_job_id}):`, e?.message)
    return { ok: false, sent: false, error: e?.message }
  }
}

/**
 * Cloture complete d une mission Kaze : on remplit chaque step du workflow IMA
 * (PNG blanc pour photos/signatures, options "Je peux intervenir" pour les
 * selects) jusqu a status="completed". A appeler quand le chauffeur valide la
 * cloture cote VD Soft (action 'completed' ou 'complete_delivery').
 *
 * Non bloquant : si Kaze plante on log mais on n empeche pas la cloture VD Soft.
 */
export async function closeKazeMissionIfApplicable(
  mission: MissionLite,
): Promise<{ ok: boolean; status: string | null; error?: string }> {
  if (!mission.kaze_job_id) {
    return { ok: true, status: null }
  }

  try {
    const { closeKazeJob } = await import('@/lib/kaze/close-job')
    const r = await closeKazeJob(mission.kaze_job_id)
    if (r.ok) {
      console.log(`[kaze-outbound] Mission Kaze ${mission.kaze_job_id} closed → ${r.status} (steps: ${r.steps_done.join(', ')})`)
    } else {
      console.warn(`[kaze-outbound] Mission Kaze ${mission.kaze_job_id} close failed at ${r.steps_done.length} steps : ${r.error}`)
    }
    return { ok: r.ok, status: r.status, error: r.error }
  } catch (e: any) {
    console.warn(`[kaze-outbound] closeKazeJob exception (${mission.kaze_job_id}):`, e?.message)
    return { ok: false, status: null, error: e?.message }
  }
}
