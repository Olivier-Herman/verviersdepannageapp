// src/app/api/tableau-bord/route.ts
//
// KPIs du mur d'écran ops (page publique /tableau-bord protégée par PIN).
// Route PUBLIQUE (hors matcher middleware) → on valide le PIN nous-mêmes.
// Compteurs ALIGNÉS sur les onglets du module dispatch (mêmes filtres :
// placeholders exclus, parse_confidence≥0.3, non archivées, futures +12h exclues,
// VHU exclu). Données via service_role (no-store). Olivier 2026-07-30.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { isPoliceNoPointage, loadDepots } from '@/lib/perf/police-trip'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 30

// PIN mur ops (071000) + PIN vue dispatch /boarding (019190). Les deux vues
// consomment la même API → on accepte les deux codes.
const VALID_PINS = [
  process.env.DASHBOARD_PIN || '071000',
  process.env.DASHBOARD_PIN_DISPATCH || '019190',
]
const VHU_SOURCE = 'garage_j7772c'
const PERIOD_DAYS = 7

// Km routiers approx A/R dépôt → intervention (vol d'oiseau × 1.3 détour routier),
// instantané (pas d'appel réseau). Sert au total « km parcourus » par chauffeur.
function roundTripKm(depot: { lat: number; lng: number }, lat: number, lng: number): number {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(lat - depot.lat), dLng = toRad(lng - depot.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(depot.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2
  const km = 2 * R * Math.asin(Math.sqrt(h))
  return km * 1.3 * 2   // × détour routier, × aller-retour
}

// Instant UTC (ISO) de minuit à Bruxelles il y a `daysAgo` jours (gère l'heure d'été).
function bxlDayStartISO(daysAgo = 0): string {
  const now = new Date()
  const bxl = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Brussels' }))
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
  const offsetMs = bxl.getTime() - utc.getTime()
  const midnight = new Date(bxl); midnight.setHours(0, 0, 0, 0)
  midnight.setDate(midnight.getDate() - daysAgo)
  return new Date(midnight.getTime() - offsetMs).toISOString()
}
// Minuit du 1er du mois courant (Bruxelles) en UTC ISO.
function bxlMonthStartISO(): string {
  const now = new Date()
  const bxl = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Brussels' }))
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
  const offsetMs = bxl.getTime() - utc.getTime()
  const first = new Date(bxl); first.setDate(1); first.setHours(0, 0, 0, 0)
  return new Date(first.getTime() - offsetMs).toISOString()
}

// Nombre de clôtures Allianz prêtes (Hexalite TO_ASSIGN ∩ VD Soft to_invoice).
// Live Hexalite → CACHE 5 min (app_settings) pour ne pas taper l'API à chaque poll.
async function getAllianzClotureCount(sb: any): Promise<number | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'allianz_cloture_cache').maybeSingle()
  let cache: any = null
  try { cache = data?.value ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) : null } catch {}
  if (cache?.at && Date.now() - Date.parse(cache.at) < 5 * 60 * 1000) return cache.count ?? null
  try {
    const baseUrl = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
    const r = await fetch(`${baseUrl}/api/facturation/allianz/list`, {
      cache: 'no-store',
      headers: { 'x-internal-secret': process.env.NEXTAUTH_SECRET || '' },
      signal: AbortSignal.timeout(20000),
    })
    const j = await r.json().catch(() => ({}))
    const count = typeof j?.count === 'number' ? j.count : (cache?.count ?? null)
    await sb.from('app_settings').upsert({ key: 'allianz_cloture_cache', value: { count, at: new Date().toISOString() } }, { onConflict: 'key' }).then(() => {}, () => {})
    return count
  } catch { return cache?.count ?? null }
}

export async function GET(req: Request) {
  const pin = req.headers.get('x-dashboard-pin') || new URL(req.url).searchParams.get('pin') || ''
  if (!VALID_PINS.includes(pin)) return NextResponse.json({ error: 'PIN invalide' }, { status: 401 })

  const sb = createAdminClient()
  const RDV_THRESHOLD = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
  const startToday    = bxlDayStartISO(0)
  const startPeriod   = bxlDayStartISO(PERIOD_DAYS)

  // Base identique au module dispatch (src/app/api/missions/list countBy).
  const countBy = (apply: (q: any) => any) => {
    const q = sb.from('incoming_missions').select('*', { count: 'exact', head: true })
      .not('external_id', 'like', 'PROCESSING_%')
      .not('external_id', 'like', 'UNKNOWN_SENDER_%')
      .or('parse_confidence.is.null,parse_confidence.gte.0.3,assigned_to.not.is.null')
      .is('archived_at', null)
    return apply(q)
  }
  const exclFuture = (q: any) => q.or(`intervention_date.is.null,intervention_date.lte.${RDV_THRESHOLD}`)

  const [
    cCommande, cAttente, cAssign, cCours, cFacturer,
    cParc, cTerminees, cFacturees,
  ] = await Promise.all([
    countBy(q => q.eq('status', 'new').neq('source', VHU_SOURCE)),                       // En commande
    countBy(q => exclFuture(q.eq('status', 'dispatching')).neq('source', VHU_SOURCE)),   // En attente
    countBy(q => exclFuture(q.in('status', ['assigned', 'accepted']))),                  // Assignées
    countBy(q => exclFuture(q.in('status', ['in_progress', 'delivering']))),             // En cours
    countBy(q => q.eq('status', 'to_invoice')),                                          // À facturer
    // Parc physique (aligné fourrière : parked + zone).
    sb.from('incoming_missions').select('*', { count: 'exact', head: true })
      .eq('status', 'parked').not('parc_zone_key', 'is', null),
    // Du jour : terminées (completed_at aujourd'hui) / facturées (invoiced_at aujourd'hui).
    sb.from('incoming_missions').select('*', { count: 'exact', head: true })
      .gte('completed_at', startToday).not('status', 'in', '(cancelled,ignored,parse_error)'),
    sb.from('incoming_missions').select('*', { count: 'exact', head: true })
      .gte('invoiced_at', startToday),
  ])

  // « À relivrer » (= onglet dispatch À Relivrer, K+K1) : parked en zone K/K1
  // (filtres de base) MOINS les parents ayant déjà une REL enfant active.
  const { data: kk1Rows } = await sb.from('incoming_missions').select('id')
    .eq('status', 'parked').in('parc_zone_key', ['K', 'K1'])
    .not('external_id', 'like', 'PROCESSING_%').not('external_id', 'like', 'UNKNOWN_SENDER_%')
    .or('parse_confidence.is.null,parse_confidence.gte.0.3,assigned_to.not.is.null')
    .is('archived_at', null)
  const kk1Ids = (kk1Rows || []).map(r => r.id)
  let aRelivrer = kk1Ids.length
  if (kk1Ids.length) {
    const { data: kids } = await sb.from('incoming_missions').select('parent_mission_id')
      .in('parent_mission_id', kk1Ids).not('status', 'in', '("cancelled","ignored")')
    const withChild = new Set((kids || []).map(k => k.parent_mission_id).filter(Boolean))
    aRelivrer = kk1Ids.filter(id => !withChild.has(id)).length
  }

  // Durée moyenne « À facturer » → « Terminé » = invoiced_at − completed_at (fenêtre,
  // paginé car PostgREST plafonne à 1000 lignes).
  // On EXCLUT les dossiers Touring qui ne passent PAS par COMEX BKO : ils sont
  // facturés via un circuit lent/manuel et faussent la moyenne. Les Touring
  // COMEX BKO (auto-facturation) restent comptés.
  const TOURING_SOURCES = ['touring', 'tgr_touring']
  const comexBkoIds = new Set<string>()
  {
    const { data: bkoRows } = await sb.from('touring_comex_dossiers').select('mission_id, mission_ids')
    for (const r of (bkoRows || [])) {
      if (r.mission_id) comexBkoIds.add(r.mission_id as string)
      if (Array.isArray(r.mission_ids)) for (const id of r.mission_ids) if (id) comexBkoIds.add(id as string)
    }
  }
  // MÉDIANE (pas moyenne) : la distribution est très asymétrique — une poignée
  // de fiches soldées tard (backlog rattrapé, saisie/SNC facturés en lot) fait
  // exploser la moyenne alors que ~80 % des dossiers sont facturés en < 24 h.
  // La médiane reflète le délai réellement représentatif.
  const durs: number[] = []
  for (let page = 0; page < 15; page++) {
    const { data: chunk } = await sb.from('incoming_missions')
      .select('id, source, completed_at, invoiced_at, no_charge_at')
      .eq('status', 'completed')
      .or(`invoiced_at.gte.${startPeriod},no_charge_at.gte.${startPeriod}`)
      .order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (!chunk || !chunk.length) break
    for (const m of chunk) {
      // Touring hors COMEX BKO → écarté du calcul.
      if (TOURING_SOURCES.includes(m.source) && !comexBkoIds.has(m.id)) continue
      const end = m.invoiced_at || m.no_charge_at
      if (end && m.completed_at) {
        const d = Date.parse(end) - Date.parse(m.completed_at)
        if (d >= 0) durs.push(d)
      }
    }
    if (chunk.length < 1000) break
  }
  durs.sort((a, b) => a - b)
  const dureeMoyMin = durs.length
    ? Math.round((durs.length % 2 ? durs[(durs.length - 1) / 2] : (durs[durs.length / 2 - 1] + durs[durs.length / 2]) / 2) / 60000)
    : null

  // ── Slide 2 : à facturer PAR SOURCE + ratios Touring/Allianz ───────────────
  const { data: toInvRows } = await sb.from('incoming_missions')
    .select('source').eq('status', 'to_invoice').limit(3000)
  const srcCount = new Map<string, number>()
  for (const r of (toInvRows || [])) { const s = r.source || 'inconnu'; srcCount.set(s, (srcCount.get(s) || 0) + 1) }

  const { data: cat } = await sb.from('mission_source_catalog').select('key, label, display_color_hex')
  const catMap = new Map((cat || []).map((c: any) => [c.key, { label: c.label, hex: c.display_color_hex }]))
  const parSource = [...srcCount.entries()]
    .map(([key, count]) => ({ key, label: (catMap.get(key) as any)?.label || key, hex: (catMap.get(key) as any)?.hex || '#64748b', count }))
    .sort((a, b) => b.count - a.count)

  const touringTotal = (srcCount.get('touring') || 0) + (srcCount.get('tgr_touring') || 0)
  const { count: comexBko } = await sb.from('touring_comex_dossiers')
    .select('*', { count: 'exact', head: true }).eq('in_comex', true).in('verdict', ['ok', 'verify'])
  const allianzTotal = (srcCount.get('allianz') || 0) + (srcCount.get('mondial') || 0)
  const clotureAllianz = await getAllianzClotureCount(sb)

  // ── Slide « Par chauffeur (jour) » + « En cours détaillé » ────────────────
  const catOf = (mt: any): string => {
    const t = String(mt || '').toLowerCase()
    if (t.includes('rel') && !t.includes('rem')) return 'REL'
    if (t.includes('rem')) return 'REM'
    if (t.includes('dsp') || t.includes('depannage') || t.includes('reparation')) return 'DSP'
    if (t.includes('transport')) return 'Transport'
    if (t.includes('trajet_vide') || t.includes('dpr') || t.includes('deplace') || t.includes('mal_gar')) return 'DPR'
    return 'Autre'
  }

  // Missions attribuées du MOIS courant (fenêtre la plus large), déclinées en
  // jour / 7 jours / mois. « comptée » = attribuée OU clôturée dans la période
  // (assigned_at plus fiable qu'intervention_date, souvent nul).
  const startMonth = bxlMonthStartISO()
  const start7 = bxlDayStartISO(7)
  const { data: monthMissions } = await sb.from('incoming_missions')
    .select('id, assigned_to, mission_type, accepted_at, completed_at, assigned_at, on_way_at, parked_at, source, incident_lat, incident_lng, departure_depot_id, depot_depart_id')
    .or(`assigned_at.gte.${startMonth},completed_at.gte.${startMonth}`)
    .not('assigned_to', 'is', null)
    .not('status', 'in', '(cancelled,ignored,parse_error)')
    .limit(10000)

  // Missions dont la CLÔTURE a été forcée par le dispatch (log force_status_*).
  // Elles n'ont pas été clôturées par le chauffeur → écartées du calcul des
  // moyennes de perf, mais restent comptées dans son total (colonne « Forcées »).
  const forcedSet = new Set<string>()
  const { data: forcedLogs } = await sb.from('mission_logs')
    .select('mission_id')
    .in('action', ['force_status_to_invoice', 'force_status_parked', 'force_status_completed'])
    .gte('created_at', startMonth)
    .limit(10000)
  for (const l of (forcedLogs || [])) if (l.mission_id) forcedSet.add(l.mission_id)

  // Durée par défaut des appels police sans pointage (est_trip_min, rempli par le
  // cron estimate-police-trips). Requête séparée + protégée : si la colonne
  // n'existe pas encore (migration non appliquée), on n'écroule pas le tableau.
  const estTripById = new Map<string, number>()
  const policeIds = (monthMissions || []).filter(isPoliceNoPointage).map((m: any) => m.id)
  if (policeIds.length) {
    try {
      const { data: et } = await sb.from('incoming_missions').select('id, est_trip_min').in('id', policeIds)
      for (const r of (et || [])) if (r.est_trip_min != null) estTripById.set(r.id, r.est_trip_min)
    } catch {}
  }

  // Dépôts (pour les km parcourus par chauffeur = A/R dépôt → intervention).
  const depots = await loadDepots(sb)

  // Missions actives (assignées / en cours) détaillées, avec le point de départ
  // du compteur (assignation).
  const { data: active } = await sb.from('incoming_missions')
    .select('id, mission_number, assigned_to, vehicle_plate, vehicle_brand, vehicle_model, mission_type, incident_city, assigned_at, accepted_at, status')
    .in('status', ['assigned', 'accepted', 'in_progress', 'delivering'])
    .order('assigned_at', { ascending: true })
    .limit(200)

  // Noms chauffeurs (union mois + actives).
  const driverIds = [...new Set([...(monthMissions || []).map((m: any) => m.assigned_to), ...(active || []).map((m: any) => m.assigned_to)].filter(Boolean))]
  const dn = new Map<string, string>()
  // Comptes NON chauffeurs à exclure des STATS uniquement (dispatchers / tests /
  // support). Ils restent visibles dans « missions en cours ». Match sur le nom
  // complet OU le 1er prénom (robuste si le compte porte un nom de famille).
  const EXCLUDED_DRIVER_NAMES = ['jona', 'mobi', 'mobi test', 'vivian']
  const excludedDrivers = new Set<string>()
  if (driverIds.length) {
    const { data: us } = await sb.from('users').select('id, name').in('id', driverIds)
    for (const u of (us || [])) {
      dn.set(u.id, u.name || '—')
      const nm = String(u.name || '').trim().toLowerCase()
      if (EXCLUDED_DRIVER_NAMES.includes(nm) || EXCLUDED_DRIVER_NAMES.includes(nm.split(/\s+/)[0])) excludedDrivers.add(u.id)
    }
  }

  const chauffeursForPeriod = (sinceISO: string) => {
    const drv = new Map<string, any>()
    for (const m of (monthMissions || [])) {
      if (excludedDrivers.has(m.assigned_to)) continue
      const inP = (m.assigned_at && m.assigned_at >= sinceISO) || (m.completed_at && m.completed_at >= sinceISO)
      if (!inP) continue
      const d = drv.get(m.assigned_to) || { total: 0, forced: 0, REM: 0, DSP: 0, REL: 0, Transport: 0, DPR: 0, Autre: 0, durSum: 0, durN: 0, km: 0 }
      d.total++; d[catOf(m.mission_type)]++
      // Durée moyenne = temps chauffeur : assignation → mise en parc (sinon
      // to_invoice = completed_at). Fiches clôturées de force par le dispatch
      // (forcedSet) écartées de la moyenne mais comptées dans le total.
      if (forcedSet.has(m.id)) { d.forced++; drv.set(m.assigned_to, d); continue }
      // La durée n'est comptée que pour les fiches ASSIGNÉES dans la période :
      // une fiche assignée il y a 6 j mais clôturée aujourd'hui (ex. REM+REL en
      // attente de relivraison) ne doit pas gonfler la moyenne « du jour ».
      const a = (m.assigned_at && m.assigned_at >= sinceISO) ? Date.parse(m.assigned_at) : null
      if (a != null) {
        if (isPoliceNoPointage(m)) {
          // Appel police sans pointage → durée par défaut = A/R dépôt + 20 min.
          const est = estTripById.get(m.id)
          if (est != null) { d.durSum += est * 60000; d.durN++ }
        } else {
          const pk = m.parked_at ? Date.parse(m.parked_at) : null
          const end = (pk != null && pk >= a) ? pk : (m.completed_at ? Date.parse(m.completed_at) : null)
          if (end != null) { const x = end - a; if (x >= 0) { d.durSum += x; d.durN++ } }
        }
        // Km parcourus (A/R dépôt → intervention) pour les fiches de la période.
        if (m.incident_lat != null && m.incident_lng != null) {
          const dep = m.departure_depot_id || m.depot_depart_id
          const depot = (dep && depots.byId.get(dep)) || depots.def
          if (depot) d.km += roundTripKm(depot, Number(m.incident_lat), Number(m.incident_lng))
        }
      }
      drv.set(m.assigned_to, d)
    }
    return [...drv.entries()].map(([id, d]) => ({
      driver: dn.get(id) || '—', total: d.total, forced: d.forced,
      REM: d.REM, DSP: d.DSP, REL: d.REL, Transport: d.Transport, DPR: d.DPR, autre: d.Autre,
      avgMin: d.durN ? Math.round(d.durSum / d.durN / 60000) : null,
      km: Math.round(d.km),
    })).sort((a, b) => b.total - a.total)
  }
  const chauffeurs = { jour: chauffeursForPeriod(startToday), semaine: chauffeursForPeriod(start7), mois: chauffeursForPeriod(startMonth) }

  // Perf chauffeurs (mois) : durées moyennes assignation → acceptation / → départ
  // en route / → traité (terminé ou en parc). + moyenne équipe en bas.
  // Pas de plafond (moyennes brutes). Seules les durées négatives sont écartées.
  // Les fiches dont la clôture a été FORCÉE par le dispatch (forcedSet) sont
  // comptées dans le total mais EXCLUES des moyennes (elles n'ont pas été
  // clôturées par le chauffeur → completed_at = admin/facturation, pas son temps).
  const ok = (x: number) => x >= 0
  const perfMap = new Map<string, any>()
  const gAcc = [0, 0], gRoute = [0, 0], gTrait = [0, 0]   // [somme ms, n]
  for (const m of (monthMissions || [])) {
    if (excludedDrivers.has(m.assigned_to)) continue
    const a = m.assigned_at ? Date.parse(m.assigned_at) : null
    if (a == null) continue
    const p = perfMap.get(m.assigned_to) || { count: 0, forced: 0, accS: 0, accN: 0, rS: 0, rN: 0, tS: 0, tN: 0 }
    p.count++
    if (forcedSet.has(m.id)) { p.forced++; perfMap.set(m.assigned_to, p); continue }  // écartée des moyennes
    if (m.accepted_at) { const x = Date.parse(m.accepted_at) - a; if (ok(x)) { p.accS += x; p.accN++; gAcc[0] += x; gAcc[1]++ } }
    if (m.on_way_at)   { const x = Date.parse(m.on_way_at) - a;   if (ok(x)) { p.rS += x; p.rN++; gRoute[0] += x; gRoute[1]++ } }
    // Traitement (part chauffeur) = de l'assignation (« dans ses mains ») jusqu'à
    // SA clôture. Priorité à la MISE EN PARC (parked_at = clôture réelle du
    // chauffeur), sinon to_invoice (completed_at). Cas particulier : appel police
    // sans pointage → durée par défaut = A/R dépôt → intervention + 20 min.
    if (isPoliceNoPointage(m)) {
      const est = estTripById.get(m.id)
      if (est != null) { const x = est * 60000; p.tS += x; p.tN++; gTrait[0] += x; gTrait[1]++ }
    } else {
      const pk = m.parked_at ? Date.parse(m.parked_at) : null
      const end = (pk != null && pk >= a) ? pk : (m.completed_at ? Date.parse(m.completed_at) : null)
      if (end != null) { const x = end - a; if (ok(x)) { p.tS += x; p.tN++; gTrait[0] += x; gTrait[1]++ } }
    }
    perfMap.set(m.assigned_to, p)
  }
  const avgMin = (sum: number, n: number) => (n ? Math.round(sum / n / 60000) : null)
  const perf = {
    parChauffeur: [...perfMap.entries()].map(([id, p]) => ({
      driver: dn.get(id) || '—', count: p.count, forced: p.forced,
      acceptMin: avgMin(p.accS, p.accN), routeMin: avgMin(p.rS, p.rN), traitMin: avgMin(p.tS, p.tN),
    })).sort((a, b) => b.count - a.count),
    global: { acceptMin: avgMin(gAcc[0], gAcc[1]), routeMin: avgMin(gRoute[0], gRoute[1]), traitMin: avgMin(gTrait[0], gTrait[1]) },
  }

  // ── Domaine ops ────────────────────────────────────────────────────────────
  // À transférer en zone Domaine (I) : remis au Domaine (Dates IN) mais pas en I.
  const { count: aTransferer } = await sb.from('incoming_missions')
    .select('*', { count: 'exact', head: true })
    .not('domaine_remise_date', 'is', null).eq('status', 'parked')
    .or('parc_zone_key.is.null,parc_zone_key.neq.I')
  // À préparer pour enlèvement : vendu (registre) mais pas encore « Préparation OK »
  // ni sorti physiquement.
  const { count: aPreparer } = await sb.from('domaine_ventes_epaves')
    .select('*', { count: 'exact', head: true })
    .is('prepare_at', null).is('sortie_reelle_date', null)

  const STATUS_LBL: Record<string, string> = { assigned: 'Assignée', accepted: 'Acceptée', in_progress: 'En cours', delivering: 'Livraison' }
  const enCoursDetail = (active || []).map((m: any) => ({
    id: m.id, missionNumber: m.mission_number, driver: dn.get(m.assigned_to) || '—',
    plate: m.vehicle_plate || '', vehicle: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' '),
    category: catOf(m.mission_type), city: m.incident_city || '',
    statusLabel: STATUS_LBL[m.status] || m.status,
    since: m.assigned_at || m.accepted_at || null,
  }))

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    ops: {
      enCommande:    cCommande.count  || 0,
      enAttente:     cAttente.count   || 0,
      assignees:     cAssign.count    || 0,
      enCours:       cCours.count     || 0,
      aFacturer:     cFacturer.count  || 0,
      enParc:        cParc.count      || 0,
      aRelivrer,
      termineesJour: cTerminees.count || 0,
      factureesJour: cFacturees.count || 0,
    },
    facturation: { periodeJours: PERIOD_DAYS, dureeMoyMin },
    sources: {
      parSource,
      touring: { bko: comexBko || 0, total: touringTotal },
      allianz: { cloture: clotureAllianz, total: allianzTotal },
    },
    chauffeurs,
    perf,
    enCours: enCoursDetail,
    domaine: { aTransferer: aTransferer || 0, aPreparer: aPreparer || 0 },
  })
}
