// src/app/api/missions/create/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToRole }    from '@/lib/push'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const supabase = createAdminClient()

  const { data: actor } = await supabase
    .from('users')
    .select('id, name')
    .eq('email', session.user.email!)
    .single()

  const now = new Date().toISOString()

  // Adresse principale = première destination
  const primaryIncident    = body.destinations?.[0]
  const primaryDestination = body.destinations?.[1]

  // Champs Police-specifiques (optionnels). Le dispatcher peut encoder
  // une mission police directement (source=police_snc / sia_couvert / police_avp ...)
  // avec scenario/balisage/destination connus. Le chauffeur les modifie ensuite
  // depuis sa fiche si besoin.
  const isSnc       = body.source === 'police_snc' || body.source === 'sia_couvert'
  const isAvp       = body.source === 'police_avp'
  const sncScenario = isSnc && ['dsp', 'rem_client', 'rem_depot', 'rem_direct'].includes(body.snc_scenario)
    ? body.snc_scenario
    : null

  // Normalisation mission_type : le frontend envoie DSP/REM/REM+REL/REL/
  // Transport/DPR. La BDD stocke le format canonical (remorquage/depannage/
  // relivraison/transport/trajet_vide). Mapping unique ici.
  // Olivier 2026-05-25 : sinon le Select 'Type de mission' dans la fiche
  // dispatch reste vide (options en lowercase ne matchent pas REM upper).
  function normalizeMissionType(t: string | null | undefined): string | null {
    const v = (t || '').trim().toLowerCase()
    if (!v) return null
    if (v === 'rem' || v === 'rem+rel' || v === 'remorquage') return 'remorquage'
    if (v === 'rel' || v === 'relivraison') return 'relivraison'
    if (v === 'dsp' || v === 'depannage' || v === 'reparation_place') return 'depannage'
    if (v === 'transport') return 'transport'
    if (v === 'dpr' || v === 'trajet_vide' || v === 'deplacement_pour_rien') return 'trajet_vide'
    return v  // valeur deja canonical ou inconnue : laisse tel quel
  }
  const normalizedMissionType = normalizeMissionType(body.mission_type)

  const { data: mission, error } = await supabase
    .from('incoming_missions')
    .insert({
      external_id:          `MAN_${Date.now()}`,
      source:               body.source              || 'prive',
      source_format:        'manual',
      source_email_id:      `manual_${Date.now()}`,
      mission_type:         normalizedMissionType,
      // incident_type : champ semantique distinct (panne, accident, pneu, etc.).
      // Plus copie depuis mission_type (Olivier 2026-05-25 : DSP/REM/etc.
      // affichait "REM" en label incident, ce qui n a aucun sens).
      incident_type:        body.incident_type        || null,
      // incident_description = description specifique de l incident (saisie
      // dans le champ "Description / Details" sous Type d intervention).
      // Olivier 2026-05-26 : plus de copie depuis remarks_general (qui est
      // un champ dedie aux remarques internes dispatch).
      incident_description: body.description          || null,
      dossier_number:       body.dossier_number      || null,
      // Client facturé
      billed_to_name:       body.billed_to_name,
      billed_to_id:         body.billed_to_id        || null,
      // Client assisté
      client_name:          body.assisted_name        || body.billed_to_name,
      client_phone:         body.assisted_phone,
      // Véhicule
      vehicle_plate:        body.vehicle_plate,
      vehicle_brand:        body.vehicle_brand,
      vehicle_model:        body.vehicle_model,
      vehicle_vin:          body.vehicle_vin,
      vehicle_fuel:         body.vehicle_fuel,
      vehicle_gearbox:      body.vehicle_gearbox,
      vehicle_class:        body.vehicle_class === 'moto' ? 'moto' : 'car',
      // Adresses (première = incident, deuxième = destination principale)
      incident_address:     primaryIncident?.address,
      incident_city:        primaryIncident?.city,
      incident_lat:         primaryIncident?.lat      || null,
      incident_lng:         primaryIncident?.lng      || null,
      incident_country:     'BE',
      destination_name:     primaryDestination?.label,
      destination_address:  primaryDestination?.address,
      destination_lat:      primaryDestination?.lat   || null,
      destination_lng:      primaryDestination?.lng   || null,
      // Toutes les destinations en jsonb
      destinations:         body.destinations         || [],
      // Avertissements
      warnings:             body.warnings             || [],
      // Montant a encaisser saisi par le dispatcher (forfait negocie pour
      // Appel Prive, ou montant attendu pour autres sources avec encaissement
      // chauffeur direct). Olivier 2026-05-25 : le frontend envoyait deja
      // ce champ mais l API l ignorait.
      amount_to_collect:    body.amount_to_collect    != null
                              ? Number(body.amount_to_collect)
                              : null,
      // Remarques
      remarks_general:      body.remarks_general,
      remarks_billing:      body.remarks_billing,
      // RDV
      rdv_at:               body.rdv_at               || null,
      incident_at:          body.rdv_at               || now,
      received_at:          now,
      intervention_date:    body.rdv_at               || now,
      // Olivier 2026-05-25 : "si je l ai creee, c est pas pour confirmer ma
      // creation". Une mission creee manuellement depuis le formulaire dispatch
      // saute l etape "new" (qui demande une confirmation par le dispatcher)
      // et passe direct en 'dispatching' (a assigner a un chauffeur).
      status:               'dispatching',
      dispatch_mode:        'manual',
      parse_confidence:     1.0,
      // Police-specifiques
      police_blocked:       isAvp ? true : Boolean(body.police_blocked),
      snc_scenario:         sncScenario,
      snc_requires_balisage: isSnc ? Boolean(body.snc_requires_balisage) : false,
      parsed_data: {
        confidence:          1.0,
        created_manually_by: actor?.name,
        odoo_partner_id:     body.odoo_partner_id     || null,
        odoo_vehicle_id:     body.odoo_vehicle_id     || null,
        distance_km:         body.distance_km         || null,
        duration_min:        body.duration_min        || null,
        departure_depot_id:  body.departure_depot_id  || null,
      }
    })
    .select('id, external_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('mission_logs').insert({
    mission_id: mission.id,
    actor_id:   actor?.id || null,
    action:     'received',
    notes:      `Mission créée manuellement par ${actor?.name || 'dispatcher'}`,
    metadata:   { source: body.source, manual: true }
  })

  const typeLabel = body.mission_type === 'REM'       ? '🚛 Remorquage'
                  : body.mission_type === 'DSP'       ? '🔧 Dépannage'
                  : body.mission_type === 'Transport' ? '🚐 Transport'
                  : body.mission_type === 'DPR'       ? '📍 Déplacement vide'
                  : body.mission_type === 'VR'        ? '🚗 Véhicule remplacement'
                  : '📋 Mission'

  const vehicle = [body.vehicle_brand, body.vehicle_model, body.vehicle_plate]
    .filter(Boolean).join(' ')

  // Push warnings urgents si présents
  const warningPush = body.warnings?.length
    ? ` ⚠️ ${body.warnings.join(', ')}`
    : ''

  await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
    title: `${typeLabel} — ${(body.source || 'MANUEL').toUpperCase()}`,
    body:  (vehicle || body.assisted_name || body.billed_to_name || 'Nouvelle mission') + warningPush,
    url:   `/dispatch/${mission.id}`,
    tag:   `mission-${mission.id}`,
    icon:  '/icons/apple-touch-icon.png'
  })

  return NextResponse.json({ ok: true, mission_id: mission.id, external_id: mission.external_id })
}
