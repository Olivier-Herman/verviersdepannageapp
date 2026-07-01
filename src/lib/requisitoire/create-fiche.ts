// src/lib/requisitoire/create-fiche.ts
//
// Crée une fiche mission à partir d'un réquisitoire capturé quand AUCUNE fiche
// existante ne correspond (véhicule saisi arrivé avant la création de la fiche).
// La fiche est créée en source 'police_saisie', placée directement en PARC J,
// bloquée (police_blocked), préremplie avec les infos lues, puis le réquisitoire
// y est annexé (attachRequisitoire → requisitoire_* + move mail).
//
// Non disponible pour une levée de saisie (elle lève une saisie existante).
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import { requisitoireIncidentAt, provisionalPlate, type RequisitoireExtract } from './extract'
import { attachRequisitoire } from './attach'

export async function createFicheFromIntake(
  sb: any,
  intakeId: string,
  actorId: string | null,
): Promise<{ ok: true; mission_id: string; mission_number: number | null; mailMoved: boolean } | { ok: false; error: string }> {
  const { data: intake, error: iErr } = await sb
    .from('requisitoire_intake').select('*').eq('id', intakeId).maybeSingle()
  if (iErr)    return { ok: false, error: iErr.message }
  if (!intake) return { ok: false, error: 'Document introuvable' }
  if (intake.status === 'attached') return { ok: false, error: 'Déjà rattaché' }
  if (intake.doc_type === 'levee_saisie') {
    return { ok: false, error: 'Création de fiche indisponible pour une levée (elle lève une saisie existante).' }
  }

  const ex = (intake.extracted || {}) as RequisitoireExtract
  const now = new Date().toISOString()
  // incident_at = date/heure du réquisitoire si lisible (heure locale BE), sinon maintenant.
  const incidentAt = requisitoireIncidentAt(ex) || now

  const { data: mission, error } = await sb
    .from('incoming_missions')
    .insert({
      external_id:       `REQ_${intakeId}`,
      source:            'police_saisie',
      source_format:     'requisitoire_auto',
      source_email_id:   `requisitoire_${intakeId}`,
      mission_type:      'remorquage',
      dossier_number:    ex.pv_number || null,
      // Pas de plaque sur le réquisitoire → immatriculation provisoire à compléter
      // (marque + 5 derniers du châssis).
      vehicle_plate:     ex.plaque || provisionalPlate(ex.marque, ex.vin) || null,
      vehicle_brand:     ex.marque || null,
      vehicle_model:     ex.modele || null,
      vehicle_vin:       ex.vin || null,
      vehicle_class:     'car',
      incident_address:  ex.adresse || null,
      incident_country:  'BE',
      incident_at:       incidentAt,
      received_at:       now,
      intervention_date: incidentAt,
      status:            'parked',
      parc_zone_key:     'J',
      parked_at:         now,
      dispatch_mode:     'manual',
      parse_confidence:  1.0,
      police_blocked:    true,
    })
    .select('id, mission_number')
    .single()

  if (error) return { ok: false, error: error.message }

  // Annexe le réquisitoire à la nouvelle fiche (+ requisitoire_* + move mail).
  const att = await attachRequisitoire(sb, intakeId, mission.id, actorId)
  if (!att.ok) return { ok: false, error: att.error }

  return { ok: true, mission_id: mission.id, mission_number: mission.mission_number ?? null, mailMoved: att.mailMoved }
}
