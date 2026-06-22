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
      destination_name, destination_address, redelivery_address,
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
    .or('parse_confidence.is.null,parse_confidence.gte.0.3,assigned_to.not.is.null')
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
    // Olivier 2026-06-18 : onglet "À Relivrer" = TOUS les vehicules en zone K,
    // meme sans adresse de relivraison encore saisie. (Avant on filtrait sur
    // redelivery_address/destination_address non null, ce qui masquait les K
    // en attente d'adresse — alors qu'ils doivent etre visibles pour qu'on
    // pense a saisir l'adresse.)
    query = query
      .eq('status', 'parked')
      .eq('parc_zone_key', 'K')
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

  // Olivier 2026-06-22 : 'À Relivrer' = véhicules parked zone K SANS REL enfant
  // déjà créée. Quand une relivraison est liée (ex. acceptée depuis Kaze), le
  // parent REM doit SORTIR de l'onglet À Relivrer (sinon il reste affiché alors
  // que la REL est déjà en cours). On calcule l'ensemble des parents zone K qui
  // ont une REL enfant active → exclus de la liste ET du compteur.
  const { data: parkedIdsRows } = await supabase
    .from('incoming_missions')
    .select('id')
    .eq('status', 'parked').eq('parc_zone_key', 'K')
    .not('external_id', 'like', 'PROCESSING_%').not('external_id', 'like', 'UNKNOWN_SENDER_%')
    .or('parse_confidence.is.null,parse_confidence.gte.0.3,assigned_to.not.is.null')
    .is('archived_at', null)
  const parkedIds = (parkedIdsRows || []).map(r => r.id)
  const parkedWithChild = new Set<string>()
  if (parkedIds.length > 0) {
    const { data: kids } = await supabase
      .from('incoming_missions')
      .select('parent_mission_id')
      .in('parent_mission_id', parkedIds)
      .not('status', 'in', '("cancelled","ignored")')
    for (const kk of (kids || [])) if (kk.parent_mission_id) parkedWithChild.add(kk.parent_mission_id)
  }
  const parkedActiveCount = parkedIds.filter(id => !parkedWithChild.has(id)).length

  // Liste visible : sur l'onglet À Relivrer, on retire les parents déjà reliés.
  let visibleMissions = (status === 'parked')
    ? (missions || []).filter(m => !parkedWithChild.has(m.id))
    : (missions || [])

  // Onglet À Relivrer : ordonner par PROXIMITÉ géographique des adresses de
  // relivraison (tournée "plus proche voisin" depuis le dépôt) → les véhicules
  // à relivrer dans le même secteur se retrouvent côte à côte dans la liste,
  // ce qui facilite le regroupement d'une tournée. Olivier 2026-06-22.
  if (status === 'parked' && visibleMissions.length > 1) {
    const GKEY = process.env.GOOGLE_GEOCODING || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

    // 0) Lire les coords de relivraison en cache (requête séparée + try/catch :
    //    tant que la migration redelivery_lat/lng n'est pas appliquée, ce bloc
    //    no-op proprement au lieu de casser tout /api/missions/list).
    let coordsOk = true
    try {
      const { data: coordRows, error: coordErr } = await supabase
        .from('incoming_missions')
        .select('id, redelivery_lat, redelivery_lng')
        .in('id', visibleMissions.map(m => m.id))
      if (coordErr) { coordsOk = false }
      else {
        const cmap = new Map((coordRows || []).map(r => [r.id, r]))
        for (const m of visibleMissions) {
          const c = cmap.get(m.id)
          ;(m as any).redelivery_lat = c?.redelivery_lat ?? null
          ;(m as any).redelivery_lng = c?.redelivery_lng ?? null
        }
      }
    } catch { coordsOk = false }

    // 1) Géocoder + mettre en cache les adresses de relivraison sans coords.
    //    Plafonné à 12/chargement : le cache fait que les suivants sont gratuits.
    //    (coordsOk faux = migration pas encore appliquée → on saute le tri,
    //     la liste reste rendue normalement, no-op propre.)
    if (coordsOk && GKEY) {
      const toGeo = visibleMissions
        .filter(m => (m as any).redelivery_address &&
          ((m as any).redelivery_lat == null || (m as any).redelivery_lng == null))
        .slice(0, 12)
      for (const m of toGeo) {
        try {
          const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent((m as any).redelivery_address)}&key=${GKEY}&language=fr&region=be`
          const j = await (await fetch(url)).json()
          const loc = j.results?.[0]?.geometry?.location
          if (loc?.lat != null && loc?.lng != null) {
            ;(m as any).redelivery_lat = loc.lat
            ;(m as any).redelivery_lng = loc.lng
            await supabase.from('incoming_missions')
              .update({ redelivery_lat: loc.lat, redelivery_lng: loc.lng })
              .eq('id', m.id)
          }
        } catch { /* best effort */ }
      }
    }

    // 2) Tournée plus proche voisin depuis le dépôt par défaut (Pepinster).
    //    Distance équirectangulaire au carré : suffisant pour ORDONNER (pas
    //    besoin de haversine, on ne compare que des distances entre elles).
    const DEPOT = { lat: 50.5703357, lng: 5.8216501 }
    const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const dLat = a.lat - b.lat
      const dLng = (a.lng - b.lng) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
      return dLat * dLat + dLng * dLng
    }
    const hasCoord = (m: any) => m.redelivery_lat != null && m.redelivery_lng != null
    const pool = visibleMissions.filter(hasCoord)
    const without = visibleMissions.filter(m => !hasCoord(m)) // en attente d'adresse → fin
    const ordered: typeof visibleMissions = []
    let cursor = DEPOT
    while (pool.length) {
      let bi = 0, bd = Infinity
      for (let i = 0; i < pool.length; i++) {
        const c = { lat: Number((pool[i] as any).redelivery_lat), lng: Number((pool[i] as any).redelivery_lng) }
        const d = dist(cursor, c)
        if (d < bd) { bd = d; bi = i }
      }
      const next = pool.splice(bi, 1)[0]
      ordered.push(next)
      cursor = { lat: Number((next as any).redelivery_lat), lng: Number((next as any).redelivery_lng) }
    }
    visibleMissions = [...ordered, ...without]
  }

  // Enrichissement : auto-dispatch status actif (1 attempt par mission max)
  // → permet au dispatcher de voir 'En cours d assignation a Franck' /
  //   'Tentative d appel a Franck' sur les cards et liste.
  const missionIds = visibleMissions.map(m => m.id)
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

    for (const m of visibleMissions) {
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
    for (const m of visibleMissions) {
      if (derogSet.has(m.id)) (m as any).has_pending_derogation = true
    }
  }

  // Compteurs par statut (exclu les archivees pour coherence avec la liste).
  // Olivier 2026-06-18 PERF : avant, on chargeait TOUTES les missions non
  // archivees (table qui grossit chaque jour) pour compter en JS → scan complet
  // a chaque load/realtime/poll = 10-20s d'attente. Desormais : 7 requetes
  // COUNT (head:true) en parallele, qui ne transferent AUCUNE ligne et
  // s'appuient sur les index. Cout quasi constant quelle que soit la taille.
  const countBy = (apply: (q: any) => any) => {
    let q = supabase
      .from('incoming_missions')
      .select('*', { count: 'exact', head: true })
      .not('external_id', 'like', 'PROCESSING_%')
      .not('external_id', 'like', 'UNKNOWN_SENDER_%')
      .or('parse_confidence.is.null,parse_confidence.gte.0.3,assigned_to.not.is.null')
      .is('archived_at', null)
    return apply(q)
  }

  // 'À Relivrer' (parked) : compteur calculé plus haut (parkedActiveCount) en
  // excluant les parents ayant déjà une REL enfant active.
  const [cNew, cDisp, cAssigned, cInProg, cCompleted, cErrors] = await Promise.all([
    countBy(q => q.eq('status', 'new')),
    countBy(q => q.eq('status', 'dispatching')),
    countBy(q => q.in('status', ['assigned', 'accepted'])),
    countBy(q => q.in('status', ['in_progress', 'delivering'])),
    countBy(q => q.in('status', ['completed', 'to_invoice'])),
    countBy(q => q.eq('status', 'parse_error')),
  ])

  const counters = {
    new:         cNew.count       || 0,
    dispatching: cDisp.count      || 0,
    assigned:    cAssigned.count  || 0,
    in_progress: cInProg.count    || 0,
    parked:      parkedActiveCount,
    completed:   cCompleted.count || 0,
    errors:      cErrors.count    || 0,
  }

  return NextResponse.json({ missions: visibleMissions, counters })
}
