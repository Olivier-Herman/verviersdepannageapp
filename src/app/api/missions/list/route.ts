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
  // Onglet « À Relivrer » : sous-zone de relivraison à afficher (K = relivraison,
  // K1 = en attente d'adresse). Défaut K. Olivier 2026-07-13.
  const relZone = searchParams.get('relZone') === 'K1' ? 'K1' : 'K'
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
      amount_guaranteed, incident_at, received_at, intervention_date, rdv_at,
      status, dispatch_mode,
      assigned_to, assigned_at, accepted_at,
      parse_confidence,
      invoice_method, invoice_number,
      requested_by_garage_id,
      kaze_cancelled_after_accept,
      is_rollable,
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

  // Seuil RDV : au-delà de +12h, une intervention planifiée va dans l'onglet RDV.
  const RDV_THRESHOLD = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()

  if (mapMode) {
    // Vue carte : missions actives à partir de "En attente" (les "En commande"
    // sont exclues car leurs adresses ne sont géocodées qu'à l'ouverture de la
    // fiche — donc affichage carte non pertinent à ce stade).
    query = query.in('status', ['dispatching', 'assigned', 'accepted', 'in_progress', 'parked', 'delivering'])
  } else if (status === 'new') {
    query = query.eq('status', 'new')
  } else if (status === 'dispatching') {
    // Olivier 2026-07-03/05 : l'onglet « En attente » regroupe les commandes à
    // valider (new) ET les missions validées en attente d'assignation (dispatching).
    // Le client les sépare en 2 bandes ("🆕 À valider" au-dessus).
    // - TOUTES les 'new' apparaissent (y compris les futures/RDV) → on peut tout
    //   valider depuis un seul écran.
    // - Les 'dispatching' restent limitées à l'horizon du jour (les futures sont
    //   dans l'onglet RDV). Filtre appliqué INLINE ici (et 'dispatching' retiré de
    //   DAY_TABS plus bas) pour ne PAS filtrer les 'new' futures.
    query = query.or(`status.eq.new,and(status.eq.dispatching,or(intervention_date.is.null,intervention_date.lte.${RDV_THRESHOLD}))`)
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
      .eq('parc_zone_key', relZone)
  } else if (status === 'completed') {
    // Inclure aussi 'to_invoice' : ce sont des missions cloturees cote
    // chauffeur, en attente de validation employe facturation. Le tampon
    // sur la card distingue visuellement le sous-statut facturation.
    query = query.in('status', ['completed', 'to_invoice'])
  } else if (status === 'rdv') {
    // Onglet RDV : missions VALIDÉES (donc plus 'new') planifiées à +12h, pas
    // encore clôturées. Une mission 'new' future reste dans « En commande »
    // (avec sa date de RDV) jusqu'à ce que le dispatch la valide.
    query = query.gt('intervention_date', RDV_THRESHOLD)
      .not('status', 'in', '("new","completed","to_invoice","cancelled","ignored","parse_error")')
  } else if (status === 'all') {
    query = query.not('status', 'in', '("parse_error","ignored")')
  }

  // Les missions planifiées à +12h VALIDÉES sont dans l'onglet RDV → on les retire
  // des onglets du jour (carte + En attente / Assigné / En cours). Les 'new'
  // futures RESTENT visibles dans « En commande » avec leur date de RDV.
  // 'dispatching' n'est PLUS ici : son filtre du jour est appliqué inline ci-dessus
  // (seulement sur les 'dispatching', pas sur les 'new' → toutes les new visibles).
  const DAY_TABS = ['assigned', 'in_progress']
  if (mapMode || DAY_TABS.includes(status)) {
    query = query.or(`intervention_date.is.null,intervention_date.lte.${RDV_THRESHOLD}`)
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
    .eq('status', 'parked').eq('parc_zone_key', relZone)
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
    // 0) Lire les coords de relivraison en cache (requête séparée + try/catch :
    //    tant que la migration redelivery_lat/lng n'est pas appliquée, ce bloc
    //    no-op proprement au lieu de casser tout /api/missions/list).
    //    NB : le géocodage se fait CÔTÉ NAVIGATEUR (DispatchClient via Places),
    //    car l'API Geocoding serveur n'est pas activée sur le projet Google ;
    //    le client persiste redelivery_lat/lng puis recharge → tri ci-dessous.
    try {
      const { data: coordRows, error: coordErr } = await supabase
        .from('incoming_missions')
        .select('id, redelivery_lat, redelivery_lng')
        .in('id', visibleMissions.map(m => m.id))
      if (!coordErr) {
        const cmap = new Map((coordRows || []).map(r => [r.id, r]))
        for (const m of visibleMissions) {
          const c = cmap.get(m.id)
          ;(m as any).redelivery_lat = c?.redelivery_lat ?? null
          ;(m as any).redelivery_lng = c?.redelivery_lng ?? null
        }
      }
    } catch { /* migration pas encore appliquée → tri no-op */ }

    // Tournée plus proche voisin depuis le dépôt par défaut (Pepinster).
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

  // Onglet RDV : trier par date d'intervention (le plus proche en premier).
  if (status === 'rdv') {
    visibleMissions = [...visibleMissions].sort((a: any, b: any) => String(a.intervention_date || '').localeCompare(String(b.intervention_date || '')))
  }

  // « En commande » : les missions futures (date d'intervention > maintenant, ex.
  // RDV garage à venir) passent EN BAS du tableau (pas encore urgentes), triées
  // par date. Le reste (immédiat) garde son ordre.
  if (status === 'new') {
    const nowMs = Date.now()
    const isFuture = (m: any) => m.intervention_date && new Date(m.intervention_date).getTime() > nowMs
    visibleMissions = [
      ...visibleMissions.filter((m: any) => !isFuture(m)),
      ...visibleMissions.filter(isFuture).sort((a: any, b: any) => String(a.intervention_date || '').localeCompare(String(b.intervention_date || ''))),
    ]
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
  // Les onglets "du jour" excluent les RDV planifiés à +12h (comme la liste).
  // Onglets du jour (hors 'new') : excluent les missions validées planifiées à +12h.
  // 'new' compte TOUTES les commandes (y compris futures, restées en « En commande »).
  const exclFuture = (q: any) => q.or(`intervention_date.is.null,intervention_date.lte.${RDV_THRESHOLD}`)
  const [cNew, cDisp, cAssigned, cInProg, cCompleted, cErrors, cRdv] = await Promise.all([
    countBy(q => q.eq('status', 'new')),
    countBy(q => exclFuture(q.eq('status', 'dispatching'))),
    countBy(q => exclFuture(q.in('status', ['assigned', 'accepted']))),
    countBy(q => exclFuture(q.in('status', ['in_progress', 'delivering']))),
    countBy(q => q.in('status', ['completed', 'to_invoice'])),
    countBy(q => q.eq('status', 'parse_error')),
    countBy(q => q.gt('intervention_date', RDV_THRESHOLD).not('status', 'in', '("new","completed","to_invoice","cancelled","ignored","parse_error")')),
  ])

  const counters = {
    new:         cNew.count       || 0,
    dispatching: cDisp.count      || 0,
    assigned:    cAssigned.count  || 0,
    in_progress: cInProg.count    || 0,
    parked:      parkedActiveCount,
    completed:   cCompleted.count || 0,
    rdv:         cRdv.count       || 0,
    errors:      cErrors.count    || 0,
  }

  // Compteurs par sous-parc de relivraison (hint du toggle K / K1 de l'onglet À
  // Relivrer). La zone active reprend le compte exact (parkedActiveCount) ; l'autre
  // est un compte brut (léger sur-comptage possible si un parent a déjà une REL).
  let relZoneCounts: { K: number; K1: number } | undefined
  if (status === 'parked') {
    const countZone = async (z: string) => {
      const { count } = await supabase.from('incoming_missions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'parked').eq('parc_zone_key', z)
        .not('external_id', 'like', 'PROCESSING_%').not('external_id', 'like', 'UNKNOWN_SENDER_%')
        .or('parse_confidence.is.null,parse_confidence.gte.0.3,assigned_to.not.is.null')
        .is('archived_at', null)
      return count || 0
    }
    const [k, k1] = await Promise.all([countZone('K'), countZone('K1')])
    relZoneCounts = { K: k, K1: k1 }
    relZoneCounts[relZone] = parkedActiveCount   // zone active = compte exact
  }

  return NextResponse.json({ missions: visibleMissions, counters, relZoneCounts })
}
