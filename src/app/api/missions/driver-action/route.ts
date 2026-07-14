// src/app/api/missions/driver-action/route.ts
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { rpcFsm, getFsmStageId, FLEET_STATES, updateVehicleState, FSM_FIELDS, attachPhotosToFsmTask } from '@/lib/odoo-fsm'
import { updateOdooDossierForMission } from '@/lib/missions/odoo-dossier'
import { withOdooActor }       from '@/lib/odoo'
import { isRelEligibleSource } from '@/lib/missions/rel-eligible'
import { isRemorquage }        from '@/lib/missions/mission-types'
import { getDefaultParcZone }  from '@/lib/missions/parc-default'

export const maxDuration = 60   // hook PDF via waitUntil peut prendre 30s+

// Mapping action chauffeur → stage FSM Odoo. null = pas de changement de stage.
const ACTION_TO_FSM_STAGE: Record<string, string | null> = {
  accept:            'Assigné',
  on_way:            'En route',
  on_site:           'Sur place',
  load_vehicle:      'En route vers destination',
  depart_stop:       'En route vers destination',
  arrive_stop:       'Arrivé à destination',
  start_delivery:    'En route vers destination',
  complete_delivery: 'Terminé',
  park:              'Mise en parc',
  completed:         'Terminé',
}

type DriverAction = 'accept' | 'on_way' | 'on_site' | 'completed' | 'park' | 'load_vehicle'
  | 'start_delivery' | 'arrive_stop' | 'complete_delivery'
  | 'change_type' | 'update_address' | 'update_stops'

const ACTION_MAP: Record<string, { status?: string; timestampField?: string; logMessage: string }> = {
  accept:           { status: 'accepted',    timestampField: 'accepted_at',   logMessage: 'Mission acceptée par le chauffeur' },
  on_way:           { status: 'in_progress', timestampField: 'on_way_at',     logMessage: 'Chauffeur en route' },
  on_site:          { status: 'in_progress', timestampField: 'on_site_at',    logMessage: 'Chauffeur sur place' },
  // REM : chargement du véhicule sur le camion. Déclenche le passage au statut
  // 'delivering' (= en route vers destination) et l'état fleet "Chargé sur camion".
  load_vehicle:     { status: 'delivering',  timestampField: 'loaded_at',     logMessage: 'Véhicule chargé sur le camion' },
  // completed / complete_delivery : mission cloturee cote chauffeur, en attente
  // validation par l'employe facturation (statut 'to_invoice').
  completed:        { status: 'to_invoice',  timestampField: 'completed_at',  logMessage: 'Mission terminée — à facturer' },
  park:             { status: 'parked',      timestampField: 'parked_at',     logMessage: 'Véhicule mis en dépôt' },
  start_delivery:   { status: 'delivering',  timestampField: 'delivering_at', logMessage: 'Livraisons en cours' },
  arrive_stop:      {                                                          logMessage: 'Arrivée à un stop' },
  depart_stop:      {                                                          logMessage: 'En route vers un stop' },
  complete_delivery:{ status: 'to_invoice',  timestampField: 'completed_at',  logMessage: 'Livraisons terminées — à facturer' },
  change_type:      {                                                          logMessage: 'Type de mission modifié' },
  save_photos:      {                                                          logMessage: 'Photos sauvegardées' },
  update_address:   {                                                          logMessage: 'Adresse modifiée' },
  update_stops:     {                                                          logMessage: 'Stops mis à jour' },
  mark_photo_category: {                                                       logMessage: 'Categorie photo couverte' },
  set_amount_to_collect: {                                                     logMessage: 'Montant à encaisser défini par le chauffeur' },
}

const ALLOWED: Record<string, string[]> = {
  assigned:    ['accept', 'set_amount_to_collect'],
  accepted:    ['on_way', 'mark_photo_category', 'set_amount_to_collect'],
  in_progress: ['on_site', 'completed', 'park', 'start_delivery', 'load_vehicle', 'change_type', 'update_address', 'update_stops', 'save_photos', 'arrive_stop', 'depart_stop', 'mark_photo_category', 'set_amount_to_collect'],
  // Olivier 2026-07-03 : une mission mise en parc n'est PLUS clôturable/modifiable
  // par le chauffeur (elle attend la relivraison / la reprise par le bureau).
  // 'completed' retiré → évite le cas "mise en parc → saute en terminé" (double
  // action / bouton Terminer resté accessible). La relivraison passe par
  // start_delivery → complete_delivery, pas par 'completed' depuis parked.
  parked:      ['start_delivery', 'change_type', 'save_photos', 'mark_photo_category', 'set_amount_to_collect'],
  // Olivier 2026-06-18 : update_address autorisé en livraison (REL). Le chauffeur
  // doit pouvoir corriger l'adresse de relivraison une fois en route (ex: client
  // change de garage). Avant : "Action 'update_address' non permise depuis 'delivering'".
  delivering:  ['arrive_stop', 'depart_stop', 'complete_delivery', 'completed', 'park', 'update_address', 'update_stops', 'save_photos', 'change_type', 'mark_photo_category', 'set_amount_to_collect'],
}

interface Stop {
  id: string; type: string; label: string; address: string
  lat: number | null; lng: number | null; arrived_at: string | null; sort_order: number
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    mission_id:    string
    action:        string
    new_type?:     string
    field?:        string
    value?:        string
    lat?:          number | null
    lng?:          number | null
    stops?:        Stop[]
    category?:     string    // pour action 'mark_photo_category'
    closing_data?: {
      final_mission_type?:    string
      mileage?:               number
      destination_address?:   string
      stops?:                 Stop[]
      photo_urls?:            string[]
      signature?:             string
      signature_data?:        string
      signature_name?:        string
      recipient_signature?:   string         // REM : signature destinataire (optionnelle)
      closing_notes?:         string
      payment_method?:        string
      amount_collected?:      number
      closing_mode?:          string
      depot?:                 { id?: string; name?: string } | null
      discharge_motif?:       string
      discharge_name?:        string
      discharge_sig?:         string
      discharge_data?:        { motif: string; name: string; sig: string }[]
      dpr_motif?:             string         // DPR : id du motif typé
      dpr_motif_label?:       string         // DPR : libellé human-readable (ou texte libre si "autre")
      dpr_converted_from_rem?: boolean       // DPR issu d un refus REM (avant chargement)
    }
    park_data?: {
      stage_id?:   number
      stage_name?: string
      notes?:      string
      // Zone suggeree par le chauffeur lors de la depose. Pour Police Accident,
      // selon les reponses Roulant + Bon sens, on suggere 'A' ou 'Transit'.
      // Le personnel parc affecte ensuite la rangee + slot precis a l inventaire.
      zone_key?:        string         // ex 'A', 'Transit', 'K1', ...
      is_rollable?:     boolean
      is_right_direction?: boolean
      key_location?:    string         // emplacement de la clé (Olivier 2026-06-18)
    }
    park_address?:       string
    park_lat?:           number | null
    park_lng?:           number | null
    redelivery_address?: string
    stop_id?:            string
    photo_urls?:         string[]
    amount?:             number | string
  }

  const { mission_id, action, closing_data, park_data } = body

  if (!mission_id || !action || !ACTION_MAP[action]) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: actor } = await supabase
    .from('users').select('id, name, current_truck_id').eq('email', session.user.email!).single()
  if (!actor) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 })

  const { data: mission, error: fetchError } = await supabase
    .from('incoming_missions')
    .select('id, status, assigned_to, external_id, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, amount_to_collect, source, extra_addresses, driver_photos, odoo_task_id, odoo_vehicle_id, mission_type, photo_categories_covered, kaze_job_id, dossier_number, client_signature, snc_scenario, destination_address, redelivery_address, truck_id, intervention_date, received_at, completed_at, invoice_number, invoice_odoo_id, odoo_quote_id')
    .eq('id', mission_id).single()

  if (fetchError || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  if (mission.assigned_to !== actor.id) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // Modification de clôture par le chauffeur : ré-exécuter 'completed' sur une
  // mission déjà clôturée (to_invoice/completed) est autorisé < 6h après la
  // clôture ET si la mission n'est PAS encore facturée. Olivier 2026-07-01.
  const RECLOSE_WINDOW_MS = 6 * 60 * 60 * 1000
  const isReclose = action === 'completed' && ['to_invoice', 'completed'].includes(mission.status)
  if (isReclose) {
    const within6h = (mission as any).completed_at && (Date.now() - new Date((mission as any).completed_at).getTime()) < RECLOSE_WINDOW_MS
    if (!within6h) return NextResponse.json({ error: 'La clôture n’est modifiable que dans les 6h.' }, { status: 422 })
    const invoiced = !!((mission as any).invoice_number || (mission as any).invoice_odoo_id || (mission as any).odoo_quote_id)
    if (invoiced) return NextResponse.json({ error: 'Mission déjà facturée : clôture non modifiable.' }, { status: 422 })
  }

  // Une mission déjà mise en parc ne se clôture pas côté chauffeur (message clair
  // plutôt que « action non permise »). La suite du workflow (relivraison /
  // facturation) est reprise par le dispatch / le bureau.
  if (['completed', 'complete_delivery'].includes(action) && mission.status === 'parked') {
    return NextResponse.json({ error: 'Mission déjà mise en parc — la clôture se fait après relivraison, pas ici.' }, { status: 422 })
  }

  // save_photos est toujours permis (pas de changement de statut). La ré-clôture
  // bypasse la garde ALLOWED (validée ci-dessus par la fenêtre 6h + non facturée).
  if (action !== 'save_photos' && !isReclose) {
    const allowed = ALLOWED[mission.status] ?? []
    if (!allowed.includes(action)) {
      return NextResponse.json({ error: `Action '${action}' non permise depuis '${mission.status}'` }, { status: 422 })
    }
  }

  const mapping = ACTION_MAP[action]
  const now     = new Date().toISOString()

  const updatePayload: Record<string, unknown> = { updated_at: now }
  if (mapping.status)         updatePayload.status     = mapping.status
  if (mapping.timestampField) updatePayload[mapping.timestampField] = now
  // Ré-clôture : garder la date de clôture d'origine (fenêtre 6h non réinitialisée).
  if (isReclose) delete updatePayload.completed_at

  // Sources internes sans facturation (ex. Car Parts & Recycling) : la mission
  // clôturée par le chauffeur est archivée directement (completed), pas envoyée
  // en facturation. Olivier 2026-06-29.
  if (updatePayload.status === 'to_invoice') {
    const { sourceSkipsFacturation } = await import('@/lib/missions/source-flags')
    if (await sourceSkipsFacturation(mission.source, supabase)) {
      updatePayload.status = 'completed'
    }
  }

  // Olivier 2026-06-01 : copie automatique de la depanneuse en service du
  // chauffeur sur la mission, dès l'acceptation ou la première action. C'est
  // ce truck_id qui sert au matching amendes plus tard. On le copie une fois,
  // jamais ecrase (les changements de truck en cours de mission gardent la
  // valeur d'origine — c'est avec ce camion qu'on a roule).
  if (!mission.truck_id && (actor as any).current_truck_id
      && ['accept', 'on_way', 'on_site', 'load_vehicle', 'park'].includes(action)) {
    updatePayload.truck_id = (actor as any).current_truck_id
  }

  // ── Sauvegarder photos en DB ────────────────────────────────────────────
  // Array.isArray (et pas .length) : une liste VIDE doit persister aussi, sinon
  // supprimer la DERNIÈRE photo ne l'enlevait pas de la fiche. Olivier 2026-07-14.
  if (action === 'save_photos' && Array.isArray(body.photo_urls)) {
    updatePayload.driver_photos = body.photo_urls
  }

  // ── Changer type DSP↔REM ────────────────────────────────────────────────
  if (action === 'change_type' && body.new_type) {
    updatePayload.mission_type = body.new_type
  }

  // ── Modifier adresse ─────────────────────────────────────────────────────
  // Olivier 2026-06-17 : on écrit TOUJOURS lat/lng (même à null) quand l'adresse
  // change. Avant, lat/lng n'étaient mis à jour que si fournis → si le chauffeur
  // tapait une nouvelle adresse sans choisir de suggestion Google, les ANCIENNES
  // coordonnées restaient et la navigation y renvoyait (gUrl privilégie lat/lng).
  // En mettant null, gUrl retombe sur l'adresse texte (géocodée par Waze/Maps).
  if (action === 'update_address' && body.field && body.value) {
    if (body.field === 'incident') {
      updatePayload.incident_address = body.value
      updatePayload.incident_lat = body.lat ?? null
      updatePayload.incident_lng = body.lng ?? null
    } else if (body.field === 'destination') {
      updatePayload.destination_address = body.value
      updatePayload.destination_lat = body.lat ?? null
      updatePayload.destination_lng = body.lng ?? null
    }
  }

  // ── Mettre à jour les stops ──────────────────────────────────────────────
  if (action === 'update_stops' && body.stops) {
    updatePayload.extra_addresses = body.stops
  }

  // ── Definir/modifier le montant a encaisser (geste 5-taps cache sur dossier)
  // Cas : mission envoyee sans paiement mais le client doit finalement payer
  // (decouverte sur place). Le chauffeur ajoute le montant via UI cachee.
  if (action === 'set_amount_to_collect' && body.amount !== undefined && body.amount !== null) {
    const n = typeof body.amount === 'string' ? parseFloat(body.amount) : Number(body.amount)
    if (Number.isNaN(n) || n < 0) {
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })
    }
    updatePayload.amount_to_collect = n
  }

  // ── Marquer une categorie photo comme couverte (multi-device) ───────────
  // Persiste en BDD (text[]) au lieu de localStorage local au device.
  if (action === 'mark_photo_category' && body.category) {
    const current = Array.isArray((mission as any).photo_categories_covered)
      ? (mission as any).photo_categories_covered as string[]
      : []
    if (!current.includes(body.category)) {
      updatePayload.photo_categories_covered = [...current, body.category]
    } else {
      // Categorie deja couverte : pas de write inutile, on retourne OK.
      return NextResponse.json({ mission, ok: true, noop: true })
    }
  }

  // ── Dépôt en parc ────────────────────────────────────────────────────────
  if (action === 'park') {
    if (park_data?.stage_id)   updatePayload.park_stage_id   = park_data.stage_id
    if (park_data?.stage_name) updatePayload.park_stage_name = park_data.stage_name
    // Olivier 2026-06-22 « catalog strict » : la zone de mise en parc vient du
    // parc par défaut de la source (Administration → Sources de mission), source
    // de vérité unique. Repli sur la zone envoyée par l'app si le catalog n'en
    // définit pas. (Serveur autoritaire → correct même sur d'anciens builds.)
    const catalogZone = await getDefaultParcZone(mission.source, supabase)
    const parkZone = catalogZone || park_data?.zone_key || null
    if (parkZone) updatePayload.parc_zone_key = parkZone
    if (park_data?.key_location) updatePayload.key_location  = park_data.key_location
    // Roulant / non roulant — obligatoire (demande Axel 2026-07-05).
    if (park_data?.is_rollable != null) updatePayload.is_rollable = park_data.is_rollable
    // Note : la bascule destination<->relivraison + adresse du parc est faite
    // de maniere centralisee plus bas (cf bloc "mise en parc" avant la
    // conversion REM+REL), pour couvrir aussi le depot via complete_delivery.
    if (closing_data) {
      if (closing_data.final_mission_type) updatePayload.mission_type    = closing_data.final_mission_type
      if (closing_data.mileage != null)    updatePayload.vehicle_mileage = closing_data.mileage
      if (closing_data.photo_urls?.length) updatePayload.driver_photos   = closing_data.photo_urls
      if (closing_data.closing_notes)      updatePayload.closing_notes   = closing_data.closing_notes
      if (closing_data.signature)          updatePayload.client_signature = closing_data.signature
      if (closing_data.recipient_signature) updatePayload.recipient_signature = closing_data.recipient_signature
      if (closing_data.discharge_data?.length) updatePayload.discharge_data = closing_data.discharge_data
      if (closing_data.discharge_motif)    updatePayload.discharge_motif = closing_data.discharge_motif
      if (closing_data.discharge_name)     updatePayload.discharge_name  = closing_data.discharge_name
      if (closing_data.discharge_sig)      updatePayload.discharge_sig   = closing_data.discharge_sig
      if (closing_data.dpr_motif)          updatePayload.dpr_motif       = closing_data.dpr_motif
      if (closing_data.dpr_motif_label)    updatePayload.dpr_motif_label = closing_data.dpr_motif_label
      if (closing_data.dpr_converted_from_rem) updatePayload.dpr_converted_from_rem = closing_data.dpr_converted_from_rem
    }
  }

  // ── Démarrage livraisons ─────────────────────────────────────────────────
  if (action === 'start_delivery' && closing_data) {
    if (closing_data.final_mission_type)  updatePayload.mission_type        = closing_data.final_mission_type
    if (closing_data.mileage != null)     updatePayload.vehicle_mileage     = closing_data.mileage
    if (closing_data.destination_address) updatePayload.destination_address = closing_data.destination_address
    if (closing_data.photo_urls?.length)  updatePayload.driver_photos       = closing_data.photo_urls
    if (closing_data.signature)           updatePayload.client_signature    = closing_data.signature
    if (closing_data.signature_data)      updatePayload.client_signature    = closing_data.signature_data
    if (closing_data.signature_name)      updatePayload.client_signature_name = closing_data.signature_name
    if (closing_data.closing_notes)       updatePayload.closing_notes       = closing_data.closing_notes
    if (closing_data.closing_mode)        updatePayload.dispatch_mode       = closing_data.closing_mode
    if (closing_data.discharge_motif)     updatePayload.discharge_motif     = closing_data.discharge_motif
    if (closing_data.discharge_name)      updatePayload.discharge_name      = closing_data.discharge_name
    if (closing_data.discharge_sig)       updatePayload.discharge_sig       = closing_data.discharge_sig
    if (closing_data.stops?.length)       updatePayload.extra_addresses     = closing_data.stops
  }

  // ── En route vers un stop ────────────────────────────────────────────────
  if (action === 'depart_stop' && body.stop_id) {
    const currentStops: Stop[] = (mission.extra_addresses as Stop[]) || []
    updatePayload.extra_addresses = currentStops.map(s =>
      s.id === body.stop_id ? { ...s, on_way_at: now } : s
    )
    // Pas de changement de statut automatique
  }

  // ── Arrivée à un stop ────────────────────────────────────────────────────
  if (action === 'arrive_stop' && body.stop_id) {
    const currentStops: Stop[] = (mission.extra_addresses as Stop[]) || []
    updatePayload.extra_addresses = currentStops.map(s => s.id === body.stop_id ? { ...s, arrived_at: now } : s)
    // Pas de changement de statut automatique — le chauffeur décide via Terminer
  }

  // ── Fin des livraisons ───────────────────────────────────────────────────
  if (action === 'complete_delivery' && closing_data) {
    if (closing_data.closing_notes) updatePayload.closing_notes = closing_data.closing_notes
    if (closing_data.closing_mode === 'depot' && closing_data.depot) {
      updatePayload.status = 'parked'; updatePayload.parked_at = now
      updatePayload.park_stage_name = closing_data.depot.name || 'Dépôt'
      delete updatePayload.completed_at
    }
  }

  // ── Clôture directe (DSP/DPR) ────────────────────────────────────────────
  if (action === 'completed' && closing_data) {
    if (closing_data.final_mission_type)      updatePayload.mission_type          = closing_data.final_mission_type
    if (closing_data.mileage != null)         updatePayload.vehicle_mileage       = closing_data.mileage
    if (closing_data.destination_address)     updatePayload.destination_address   = closing_data.destination_address
    if (closing_data.photo_urls?.length)      updatePayload.driver_photos         = closing_data.photo_urls
    if (closing_data.signature)               updatePayload.client_signature      = closing_data.signature
    if (closing_data.signature_data)          updatePayload.client_signature      = closing_data.signature_data
    if (closing_data.signature_name)          updatePayload.client_signature_name = closing_data.signature_name
    if (closing_data.closing_notes)           updatePayload.closing_notes         = closing_data.closing_notes
    if (closing_data.payment_method)          updatePayload.payment_method        = closing_data.payment_method
    if (closing_data.amount_collected != null) updatePayload.amount_collected     = closing_data.amount_collected
    if (closing_data.discharge_data?.length)  updatePayload.discharge_data        = closing_data.discharge_data
    if (closing_data.discharge_motif)         updatePayload.discharge_motif       = closing_data.discharge_motif
    if (closing_data.discharge_name)          updatePayload.discharge_name        = closing_data.discharge_name
    if (closing_data.discharge_sig)           updatePayload.discharge_sig         = closing_data.discharge_sig
  }

  // Olivier 2026-06-12 : regle metier mise en parc.
  //   - L adresse du parc devient la destination de la mission.
  //   - Si une destination etait prevue, elle bascule en adresse de relivraison
  //     (sauf si une relivraison est deja definie).
  // Robuste cote serveur : si le client n envoie pas park_address, on resout
  // l adresse du parc via le depot choisi puis le depot par defaut.
  if (updatePayload.status === 'parked') {
    let parcAddress = (body.park_address || '').trim() || null
    if (!parcAddress) {
      const depotId = (park_data as any)?.depot_id
                   || (closing_data as any)?.depot?.id
                   || (mission as any).depot_depart_id
      if (depotId) {
        const { data: d } = await supabase.from('depots').select('address').eq('id', depotId).maybeSingle()
        parcAddress = (d?.address || '').trim() || null
      }
      if (!parcAddress) {
        const { data: d } = await supabase.from('depots').select('address').eq('is_default', true).eq('active', true).maybeSingle()
        parcAddress = (d?.address || '').trim() || null
      }
    }
    // Destination prevue (avant ecrasement) : explicite du client, sinon celle de la mission
    const plannedDest  = (body.redelivery_address || '').trim() || ((mission as any).destination_address || '').trim()
    const alreadyReliv = ((mission as any).redelivery_address || '').trim()
    if (!alreadyReliv && plannedDest && (!parcAddress || plannedDest !== parcAddress)) {
      updatePayload.redelivery_address = plannedDest
    }
    if (parcAddress) updatePayload.destination_address = parcAddress
  }

  // Olivier 2026-05-28 : auto-conversion REM -> REM+REL au moment du parked
  // si :
  //   - source eligible a la relivraison
  //   - ET adresse de relivraison deja connue (destination_address ou
  //     redelivery_address). Sans adresse, on attend qu elle soit saisie
  //     (au prochain PATCH /api/missions/[id], la conversion sera faite la).
  if (updatePayload.status === 'parked' && isRemorquage(mission.mission_type)) {
    const hasAddr = !!((mission as any).redelivery_address || (mission as any).destination_address || updatePayload.redelivery_address)
    if (hasAddr && isRelEligibleSource(mission.source, (mission as any).snc_scenario)) {
      updatePayload.mission_type = 'REM+REL'
    }
  }

  // Olivier 2026-06-14 : pour une SAISIE, l'entrée parc = date d'intervention
  // (le gardiennage saisie est compté depuis l'intervention, pas la mise en
  // dépôt). On cale donc parked_at sur intervention_date dès qu'on passe en parc.
  if (updatePayload.status === 'parked' && mission.source === 'police_saisie') {
    const interv = (mission as any).intervention_date || (mission as any).received_at
    if (interv) updatePayload.parked_at = interv
  }

  const { data: updated, error: updateError } = await supabase
    .from('incoming_missions').update(updatePayload).eq('id', mission_id).select().single()

  if (updateError) {
    console.error('[driver-action]', updateError)
    return NextResponse.json({ error: 'Erreur mise à jour' }, { status: 500 })
  }

  // ── Encaissement automatique ─────────────────────────────────────────────
  if (action === 'completed' && closing_data?.amount_collected && closing_data.amount_collected > 0) {
    await supabase.from('interventions').insert({
      driver_id: actor.id, plate: mission.vehicle_plate || '',
      brand_text: mission.vehicle_brand || '', model_text: mission.vehicle_model || '',
      amount: closing_data.amount_collected, payment_mode: closing_data.payment_method || 'cash',
      client_name: updated.client_name || '',
      notes: `Mission ${mission.external_id || mission_id.slice(0, 8)} — ${mission.source || ''}`,
      mission_id, auto_created: true, synced_to_odoo: false,
    })
  }

  await supabase.from('mission_logs').insert({
    mission_id, actor_id: actor.id, action, notes: mapping.logMessage,
    metadata: { action, status: mapping.status || mission.status },
  })

  // ── Lieu de pointage GPS ──────────────────────────────────────────────────
  // Olivier 2026-06-16 : si le chauffeur a transmis sa position au moment du
  // pointage, on l'enregistre comme marqueur sur la carte trajet (kind=action).
  // Le point d'acceptation (kind='accept') en fait partie. Best-effort.
  if (typeof body.lat === 'number' && typeof body.lng === 'number'
      && ['accept', 'on_way', 'on_site', 'load_vehicle', 'park', 'completed',
          'start_delivery', 'complete_delivery'].includes(action)) {
    try {
      await supabase.from('mission_position_pings').insert({
        mission_id, driver_id: actor.id, lat: body.lat, lng: body.lng, kind: action,
      })
    } catch { /* télémétrie non critique */ }
  }

  // ── Filet OCR VIN/plaque à la MISE EN PARC (background) ────────────────────
  // Le chauffeur redirige aussitôt après la mise en parc : pas de moment de
  // confirmation fiable. On OCR les photos côté serveur (Claude Haiku) et on
  // COMPLÈTE uniquement les champs VIDES (jamais d'écrasement) → la fiche parc
  // part complète pour l'inventaire. Repli plaque = 5 derniers du VIN si aucune
  // plaque lisible. Olivier 2026-07-13.
  if (action === 'park') {
    const plateEmpty = !((mission.vehicle_plate || '').trim())
    const vinEmpty   = !(((mission as any).vehicle_vin || '').trim())
    const parkPhotos: string[] = (closing_data?.photo_urls?.length ? closing_data.photo_urls : mission.driver_photos) || []
    if ((plateEmpty || vinEmpty) && parkPhotos.length > 0) {
      const ocrBg = (async () => {
        try {
          const { detectVehicleFromImages } = await import('@/lib/ocr/vehicle-detect')
          const { plate, vin } = await detectVehicleFromImages(parkPhotos.slice(0, 6))
          const upd: Record<string, any> = {}
          if (vinEmpty   && vin?.value)   upd.vehicle_vin   = vin.value
          if (plateEmpty && plate?.value) upd.vehicle_plate = plate.value
          // Repli : aucune plaque lisible mais VIN connu → 5 derniers du châssis.
          if (plateEmpty && !upd.vehicle_plate) {
            const knownVin = (vin?.value || (mission as any).vehicle_vin || '').trim()
            if (knownVin.length >= 5) upd.vehicle_plate = knownVin.slice(-5)
          }
          if (Object.keys(upd).length > 0) {
            upd.updated_at = new Date().toISOString()
            await supabase.from('incoming_missions').update(upd).eq('id', mission_id)
            await supabase.from('mission_logs').insert({
              mission_id, actor_id: actor.id, action: 'vehicle_ocr_autofill',
              notes: `VIN/plaque complété(s) auto depuis les photos à la mise en parc : ${Object.entries(upd).filter(([k]) => k !== 'updated_at').map(([k, v]) => `${k}=${v}`).join(', ')}`,
              metadata: { source: 'park_ocr', filled: upd },
            }).then(() => {}, () => {})
          }
        } catch (e: any) {
          console.warn('[driver-action] park OCR exception:', e?.message)
        }
      })()
      try { const { waitUntil } = await import('@vercel/functions'); waitUntil(ocrBg) }
      catch { await ocrBg }
    }
  }

  // ── Propagation Kaze : note + avancement workflow ─────────────────────────
  // BACKGROUND via waitUntil : on ne bloque PAS la reponse HTTP de driver-action
  // pour que l UI chauffeur reagisse instantanement (les operations Kaze
  // prennent 2-10s, donc inacceptable en synchrone).
  //
  // waitUntil garde la fonction Vercel alive jusqu a ce que la Promise
  // resolve, meme apres le NextResponse.json() au caller.
  if ((mission as any).kaze_job_id) {
    // Donnees envoyees au hook Kaze : on inclut driver_photos + client_signature
    // pour la v3 (upload des vrais fichiers cote Kaze au lieu de PNG blanc).
    // Pour les actions terminales (completed/complete_delivery/park), on prend
    // aussi les URLs eventuellement mises a jour dans le payload de cloture.
    const photosFromBody = (closing_data?.photo_urls?.length
      ? closing_data.photo_urls
      : null) || mission.driver_photos || []
    const sigFromBody = closing_data?.signature
                     || closing_data?.signature_data
                     || (mission as any).client_signature
                     || null

    const missionLite = {
      id:               mission.id,
      kaze_job_id:      (mission as any).kaze_job_id,
      vehicle_plate:    mission.vehicle_plate,
      vehicle_brand:    mission.vehicle_brand,
      vehicle_model:    mission.vehicle_model,
      dossier_number:   (mission as any).dossier_number,
      driver_photos:    Array.isArray(photosFromBody) ? photosFromBody : null,
      client_signature: sigFromBody,
    }

    const kazeBackground = (async () => {
      try {
        const { notifyKazeOfAction, advanceKazeMissionForAction } = await import('@/lib/kaze/outbound')

        // 1) Note temps reel (rapide, ~200ms)
        const noteResult = await notifyKazeOfAction(missionLite, action)
        if (!noteResult.ok) {
          console.warn('[driver-action] kaze note failed:', noteResult.error)
        }

        // 2) Avancement progressif workflow Kaze
        // - on_way        → navigation_to (status=started)
        // - on_site       → photo_arrival
        // - load_vehicle  → cri
        // - park / complete_delivery / completed → workshop_signature (full close)
        const advanceResult = await advanceKazeMissionForAction(missionLite, action)
        if (!advanceResult.ok) {
          console.warn('[driver-action] kaze advance failed:', advanceResult.error)
        }

        // Olivier 2026-06-18 : tracer le résultat Kaze dans l'historique de la
        // fiche (visible au dispatch) — sinon les échecs d'avancement Kaze sont
        // silencieux (console only) et impossibles à diagnostiquer sans les logs.
        const ok = (advanceResult.ok !== false)
        await supabase.from('mission_logs').insert({
          mission_id: mission_id,
          actor_id:   actor.id,
          action:     ok ? 'kaze_synced' : 'kaze_sync_error',
          notes:      ok
            ? `Kaze ↗ ${action} : workflow avancé${advanceResult.status ? ` (statut ${advanceResult.status})` : ''}${noteResult.ok ? '' : ' · note KO'}`
            : `Kaze ↗ ${action} : échec avancement workflow — ${advanceResult.error || 'erreur inconnue'}`,
          metadata:   { action, advance_ok: advanceResult.ok, advance_status: advanceResult.status ?? null, advance_error: advanceResult.error ?? null, note_ok: noteResult.ok, note_error: noteResult.error ?? null },
        }).then(() => {}, () => {})
      } catch (e: any) {
        console.warn('[driver-action] kaze hooks exception:', e?.message)
        await supabase.from('mission_logs').insert({
          mission_id: mission_id,
          actor_id:   actor.id,
          action:     'kaze_sync_error',
          notes:      `Kaze ↗ ${action} : exception — ${e?.message || 'inconnue'}`,
          metadata:   { action, exception: e?.message ?? null },
        }).then(() => {}, () => {})
      }
    })()

    // Utilise waitUntil de Vercel pour que la fonction reste alive
    // pendant que le background tourne, sans bloquer la response HTTP.
    try {
      const { waitUntil } = await import('@vercel/functions')
      waitUntil(kazeBackground)
    } catch {
      // Hors Vercel (local dev) : on attend quand meme pour ne pas perdre
      // l execution. En prod Vercel waitUntil est dispo.
      await kazeBackground
    }
  }

  // ── Propagation Touring COMEX : en route / sur place (background, gaté) ────────
  // on_way  → onRoad (05) · on_site → onSpot (06), avec l'HEURE RÉELLE du pointage.
  // Idempotent + SLA gérés dans lib/touring/sync. Gaté par TOURING_COMEX_MODE=import
  // (sinon no-op → on reste sur le mail/parse actuel). Olivier 2026-07-06.
  if (mission.source === 'touring' && (action === 'on_way' || action === 'on_site')) {
    const touringBackground = (async () => {
      try {
        const { syncTouringOnRoad, syncTouringOnSpot } = await import('@/lib/touring/sync')
        const now = new Date()
        if (action === 'on_way') await syncTouringOnRoad(supabase, mission_id, { at: now, actorId: actor.id })
        else                     await syncTouringOnSpot(supabase, mission_id, { at: now, actorId: actor.id })
      } catch (e: any) {
        console.warn('[driver-action] touring sync exception:', e?.message)
      }
    })()
    try {
      const { waitUntil } = await import('@vercel/functions')
      waitUntil(touringBackground)
    } catch { await touringBackground }
  }

  // ── Propagation Odoo : stage FSM + état véhicule (best effort, non bloquant) ──
  if (mission.odoo_task_id) {
    const stageName = ACTION_TO_FSM_STAGE[action]
    try {
      const odooUpdate: Record<string, any> = {}
      if (stageName) {
        const stageId = await getFsmStageId(stageName)
        if (stageId) odooUpdate.stage_id = stageId
      }
      // Sécurité : à la 1re action chauffeur (accept), on (re)pousse son nom et son id Supabase
      // sur le task. Couvre le cas où /api/missions/assign aurait été skippé ou échoué.
      if (action === 'accept') {
        odooUpdate[FSM_FIELDS.chauffeur_name] = actor.name || ''
        odooUpdate[FSM_FIELDS.chauffeur_id]   = actor.id
      }
      // Cas particuliers : chauffeur a chargé le véhicule → "Chargé sur camion"
      if (action === 'load_vehicle' || action === 'depart_stop' || action === 'start_delivery') {
        if (mission.odoo_vehicle_id) {
          await updateVehicleState(mission.odoo_vehicle_id, FLEET_STATES.charge_sur_camion).catch(() => {})
        }
      }
      // Mise en parc → état véhicule = TRANSIT (zone de relivraison) quel que soit
      // le parc physique choisi par le chauffeur. Le dispatcher pourra ensuite
      // déclencher la REL via le bouton Relivrer sur la fiche.
      if (action === 'park' && mission.odoo_vehicle_id) {
        await updateVehicleState(mission.odoo_vehicle_id, FLEET_STATES.transit).catch(() => {})
      }
      // Mission terminée → état véhicule = Terminé (sauf si déjà mis en parc avant)
      if ((action === 'completed' || action === 'complete_delivery') && mission.odoo_vehicle_id) {
        // On ne force pas si la mission est de type REM (le parc est la position finale)
        const isDsp = ['depannage', 'reparation_place', 'trajet_vide'].includes((mission.mission_type || '').toLowerCase())
        if (isDsp) {
          await updateVehicleState(mission.odoo_vehicle_id, FLEET_STATES.termine).catch(() => {})
        }
      }
      if (Object.keys(odooUpdate).length > 0) {
        await rpcFsm('project.task', 'write', [[mission.odoo_task_id], odooUpdate])
      }
      console.log(`[FSM] Action chauffeur ${action} → stage "${stageName || '(inchangé)'}" sur task #${mission.odoo_task_id}`)
    } catch (e: any) {
      console.error('[FSM] Propagation action chauffeur échouée (non bloquant):', e.message)
    }

    // Upload photos vers la FSM en pièces jointes (idempotent grâce au dédup par filename)
    if (action === 'save_photos' || action === 'completed' || action === 'complete_delivery') {
      const photoUrls: string[] = action === 'save_photos'
        ? (body.photo_urls || [])
        : (closing_data?.photo_urls || updated.driver_photos || [])
      if (photoUrls.length > 0) {
        attachPhotosToFsmTask(mission.odoo_task_id, photoUrls).catch(e => {
          console.error('[FSM] Upload photos échoué (non bloquant):', e.message)
        })
      }
    }
  }

  // Sync Odoo des modifs métier (best effort, non bloquant)
  // Les actions chauffeur qui changent des données réutilisées dans Odoo
  // (adresses, stops, véhicule) doivent se propager au helpdesk + task FSM.
  // Olivier 2026-06-04 : wrap dans withOdooActor pour utiliser la cle API
  // personnelle du chauffeur (tracabilite Odoo).
  if (['update_address', 'update_stops', 'change_type'].includes(action)) {
    withOdooActor(actor.id, () => updateOdooDossierForMission(mission_id)).catch(e => {
      console.error('[Odoo sync] driver-action échoué:', e.message)
    })
  }

  // Mission cloturee → genere et attache le PDF resume aux cibles Odoo dispo
  // (helpdesk + vehicle ; invoice viendra a la facturation).
  // waitUntil garantit que la promise survit au return de la fonction Vercel.
  if (action === 'completed' || action === 'complete_delivery') {
    const { waitUntil } = await import('@vercel/functions')
    waitUntil(
      import('@/lib/missions/attach-mission-pdf').then(({ attachMissionPdf }) =>
        attachMissionPdf(mission_id, { targets: ['helpdesk', 'vehicle'] })
      ).catch(e => {
        console.error('[mission-pdf] driver-action attach échoué (non bloquant):', e.message)
      })
    )
  }

  // Olivier 2026-06-02 : notif garage si mission source=garage
  try {
    const { notifyGarageOfMissionEvent } = await import('@/lib/notifications/garage')
    const newStatus = (updated as any)?.status
    if (action === 'on_way') {
      await notifyGarageOfMissionEvent(mission_id, 'on_way')
    } else if (newStatus === 'to_invoice' || newStatus === 'completed') {
      await notifyGarageOfMissionEvent(mission_id, 'completed')
    }
  } catch (e) { /* silent */ }

  // Olivier 2026-06-07 : si le chauffeur met en parc zone K (file d attente
  // relivraison), imprime auto une etiquette REL. Non bloquant.
  if (action === 'park' && (updated as any)?.parc_zone_key === 'K') {
    try {
      const { reprintLabelForMission } = await import('@/lib/missions/reprint-label-helper')
      await reprintLabelForMission({ kind: 'uuid', value: mission_id })
    } catch (e: any) {
      console.warn(`[driver-action] REL print KO mission=${mission_id}:`, e?.message)
    }
  }

  return NextResponse.json({ ok: true, mission: updated })
}
