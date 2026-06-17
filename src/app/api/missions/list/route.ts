// src/app/api/missions/list/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'new'
  const source = searchParams.get('source') || ''
  // Mode carte : charge toutes les missions actives (new + dispatching + assigned +
  // in_progress + parked) indépendamment de l'onglet, avec une limite plus haute.
  const mapMode = searchParams.get('view') === 'map'

  const sortParam = searchParams.get('sort')
  const sortField: 'intervention_date' | 'received_at' =
    sortParam === 'received_at' ? 'received_at' : 'intervention_date'

  const supabase = createAdminClient()

  // Récupérer les missions
  let query = supabase
    .from('incoming_missions')
    .select(`
      id, mission_number, external_id, dossier_number, source, source_format,
      mission_type, incident_type, incident_description,
      client_name, client_phone,
      assisted_name, assisted_phone,
      vehicle_plate, vehicle_brand, vehicle_model,
      incident_address, incident_city, incident_country,
      incident_lat, incident_lng,
      destination_name, destination_address,
      amount_guaranteed, incident_at, received_at, intervention_date,
      status, dispatch_mode,
      assigned_to, assigned_at, accepted_at,
      parse_confidence,
      invoice_method, invoice_number,
      requested_by_garage_id,
      assigned_user:users!assigned_to(id, name, avatar_url)
    `)
    .order(sortField, { ascending: false, nullsFirst: false })
    // .range() au lieu de .limit() pour eviter un bug Supabase JS observe
    // sur /api/watch/missions/today (combo select-long + order + limit
    // filtrait incorrectement a 1 row au lieu de 3). .range utilise un
    // Range header HTTP plus predictible.
    .range(0, mapMode ? 499 : 99)

  // Filtrer les entrées parasites (corps vides, PROCESSING, etc.)
  query = query
    .not('external_id', 'like', 'PROCESSING_%')
    .not('external_id', 'like', 'UNKNOWN_SENDER_%')
    .or('parse_confidence.is.null,parse_confidence.gt.0.3')
    // Exclure les missions archivees (auto-archivees 7j apres facturation).
    // Recherche globale ratisse partout, c'est le seul endroit ou on les voit.
    .is('archived_at', null)

  if (mapMode) {
    // Vue carte : missions actives à partir de "En attente" (les "En commande"
    // sont exclues car leurs adresses ne sont géocodées qu'à l'ouverture de la
    // fiche — donc affichage carte non pertinent à ce stade).
    query = query.in('status', ['dispatching', 'assigned', 'accepted', 'in_progress', 'parked', 'delivering'])
  } else if (status === 'new') {
    query = query.eq('status', 'new')
  } else if (status === 'dispatching') {
    query = query.eq('status', 'dispatching')
  } else if (status === 'assigned') {
    query = query.in('status', ['assigned', 'accepted'])
  } else if (status === 'in_progress') {
    query = query.in('status', ['in_progress', 'delivering'])
  } else if (status === 'parked') {
    // Olivier 2026-05-28 : onglet "À Relivrer" du Dispatch = uniquement les
    // vehicules en zone K avec une adresse de relivraison definie.
    // Sans adresse, le vehicule reste en zone K mais n apparait PAS dans
    // l onglet (Olivier 2026-06-08 fix : avant le filtre laissait passer les
    // K sans adresse, ce qui polluait l onglet). Quand le bureau saisit
    // l adresse, la mission apparait alors dans cet onglet.
    query = query
      .eq('status', 'parked')
      .eq('parc_zone_key', 'K')
      .or('redelivery_address.not.is.null,destination_address.not.is.null')
  } else if (status === 'completed') {
    // Inclure aussi 'to_invoice' : ce sont des missions cloturees cote
    // chauffeur, en attente de validation employe facturation. Le tampon
    // sur la card distingue visuellement le sous-statut facturation.
    query = query.in('status', ['completed', 'to_invoice'])
  } else if (status === 'all') {
    query = query.not('status', 'in', '("parse_error","ignored")')
  }

  if (source) query = query.eq('source', source)

  const { data: missions, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Enrichissement : auto-dispatch status actif (1 attempt par mission max)
  // → permet au dispatcher de voir 'En cours d assignation a Franck' /
  //   'Tentative d appel a Franck' sur les cards et liste.
  const missionIds = (missions || []).map(m => m.id)
  if (missionIds.length > 0) {
    const { data: activeAttempts } = await supabase
      .from('dispatch_attempts_log')
      .select('mission_id, driver_id, status, attempt_order, driver:users!dispatch_attempts_log_driver_id_fkey(name)')
      .in('mission_id', missionIds)
      .in('status', ['pending', 'push_sent', 'call_1_sent', 'call_2_sent'])
      .order('attempt_order', { ascending: false })

    // Garde uniquement le plus recent par mission (le bouger en map)
    const byMission = new Map<string, any>()
    for (const att of activeAttempts || []) {
      if (!byMission.has(att.mission_id)) byMission.set(att.mission_id, att)
    }

    for (const m of missions || []) {
      const att = byMission.get(m.id)
      if (!att) continue
      const driverName = (att.driver as any)?.name || '?'
      let label = ''
      switch (att.status) {
        case 'pending':
        case 'push_sent':
          label = `En cours d'assignation à ${driverName}`
          break
        case 'call_1_sent':
          label = `Tentative d'appel à ${driverName}`
          break
        case 'call_2_sent':
          label = `2e tentative d'appel à ${driverName}`
          break
      }
      ;(m as any).auto_dispatch_status = label
      ;(m as any).auto_dispatch_attempt_status = att.status
      ;(m as any).auto_dispatch_driver_name = driverName
    }

    // Derogations paiement pending : flag sur la card pour signaler au dispatcher
    const { data: pendingDerogs } = await supabase
      .from('payment_derogations')
      .select('mission_id')
      .in('mission_id', missionIds)
      .eq('status', 'pending')
    const derogSet = new Set((pendingDerogs || []).map(d => d.mission_id))
    for (const m of missions || []) {
      if (derogSet.has(m.id)) (m as any).has_pending_derogation = true
    }
  }

  // Compteurs par statut (exclu les archivees pour coherence avec la liste)
  // On selectionne aussi parc_zone_key pour compter uniquement les vehicules
  // en zone K dans l onglet "En parc" (cf filter ligne 73-82).
  const { data: counts } = await supabase
    .from('incoming_missions')
    .select('status, parc_zone_key, redelivery_address, destination_address')
    .not('external_id', 'like', 'PROCESSING_%')
    .not('external_id', 'like', 'UNKNOWN_SENDER_%')
    .or('parse_confidence.is.null,parse_confidence.gt.0.3')
    .is('archived_at', null)

  const counters = {
    new:         counts?.filter(m => m.status === 'new').length         || 0,
    dispatching: counts?.filter(m => m.status === 'dispatching').length || 0,
    assigned:    counts?.filter(m => ['assigned','accepted'].includes(m.status)).length || 0,
    in_progress: counts?.filter(m => ['in_progress','delivering'].includes(m.status)).length || 0,
    // Olivier 2026-06-08 : compteur 'À Relivrer' aligne sur le filtre du tab :
    // zone K + adresse de relivraison renseignee (sinon le badge mentait).
    parked:      counts?.filter(m =>
      m.status === 'parked'
      && (m as any).parc_zone_key === 'K'
      && (((m as any).redelivery_address && String((m as any).redelivery_address).trim())
        || ((m as any).destination_address && String((m as any).destination_address).trim()))
    ).length || 0,
    completed:   counts?.filter(m => ['completed','to_invoice'].includes(m.status)).length || 0,
    errors:      counts?.filter(m => m.status === 'parse_error').length || 0,
  }

  return NextResponse.json({ missions, counters })
}
