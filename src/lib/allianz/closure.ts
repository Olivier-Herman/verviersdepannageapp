// src/lib/allianz/closure.ts
//
// Olivier 2026-06-12 : "Clôture Allianz" — autoclôture des missions Mondial/AWP
// sur la plateforme Hexalite, depuis le module Facturation.
//
// Flux complet (capturé en live le 2026-06-12) :
//   1. PUT  /hexalite-job-monitoring/v1.0/assistanceCases/{caseId}/assignments/{id}/status
//           body { subStatus: "SVPSD" }                          (= affectation manuelle)
//   2. GET  /hexalite-service-broker/v2.0/assignments/{id}/assignmenttariffs?providedService=T&...
//           → renvoie les lignes de tarif (bills) — Allianz calcule (auto-facturation)
//   3. POST /hexalite-job-monitoring/v1.0/assistanceCases/{caseId}/assignments/{id}/expertreports
//           body { providedService, finalSubCaseCause, heures, distance, bills, finalDestination, ... }
//
// Token : réutilise le dernier access_token Hexalite valide (allianz_otp_pending,
// status verified/done, JWT non expiré). Sinon throw (l UI proposera de relancer
// un OTP — flux existant dans processor.ts).
//
// ⚠️ Écrit sur la prod Allianz. dryRun=true s arrête après l étape 2 (aucune
// écriture) et renvoie le payload expertreports qui SERAIT envoyé.

import { createAdminClient } from '@/lib/supabase'

const BASE_URL = 'https://global.allianzpartners-providerplatform.com'

// providedService Hexalite par type de service VD Soft.
// T = Remorquage (confirmé). Les 2 autres restent à confirmer côté Allianz.
export const ALLIANZ_PROVIDED_SERVICE: Record<string, string> = {
  remorquage:       'T',
  depannage:        'R',   // Réparé sur place (à confirmer)
  reparation_place: 'R',   // Réparé sur place (à confirmer)
  trajet_vide:      'D',   // Trajet à vide (à confirmer)
}

// Cause par défaut (= "Autre" / AUTRE SERVICE dans le dropdown "Dégâts ou panne réelle")
const DEFAULT_FINAL_SUB_CASE_CAUSE = 'KA704'

// ─── Grille tarifaire Allianz/AWP — LUE depuis source_tariffs (zéro hardcode) ──
// Tarifs IDENTIQUES pour tous les produits Allianz, AUCUNE majoration (soir/WE/JF).
// source_tariffs(source='mondial', mission_type) : unit_price=forfait, km_inclus,
// km_price. La ligne "Fuel compensation" = source_tariffs(mondial, 'fuel').unit_price.
const round2 = (n: number) => Math.round(n * 100) / 100

export interface AllianzRates {
  fuel:        number   // forfait Fuel compensation
  remorquage:  number   // forfait Remorquage sans réparation (T)
  repare:      number   // forfait Réparé sur place (R)
  trajetVide:  number | null
  kmInclus:    number   // km inclus (50)
  kmPrice:     number   // €/km au-delà (1.40)
}

/** Charge la grille Allianz depuis source_tariffs (source='mondial', en vigueur). */
export async function loadAllianzRates(): Promise<AllianzRates | null> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('source_tariffs')
    .select('mission_type, unit_price, km_inclus, km_price')
    .eq('source', 'mondial')
    .is('effective_to', null)
  if (!data || data.length === 0) return null
  const by = (t: string) => data.find(r => r.mission_type === t)
  const rem = by('remorquage')
  const dsp = by('depannage')
  const fuel = by('fuel')
  const tv = by('trajet_vide')
  // km_inclus / km_price pris sur la ligne remorquage (identiques partout chez Allianz)
  const ref = rem || dsp
  if (!ref) return null
  return {
    fuel:       Number(fuel?.unit_price ?? 0),
    remorquage: Number(rem?.unit_price ?? 0),
    repare:     Number(dsp?.unit_price ?? 0),
    trajetVide: tv?.unit_price != null ? Number(tv.unit_price) : null,
    kmInclus:   Number(ref.km_inclus ?? 50),
    kmPrice:    Number(ref.km_price ?? 0),
  }
}

/** Km supplémentaires facturables (km_inclus inclus). Le quirk +0.01 reproduit Allianz. */
function supplementKm(distance: number, kmInclus: number): number {
  const extra = distance - (kmInclus - 0.01)
  return extra > 0 ? round2(extra) : 0
}

/** Montant d une ligne de devis selon son libellé + la distance, depuis la grille.
 *  Retourne null si le libellé n est pas calculable (ex "Siabis") → blocage. */
function allianzLineAmount(tariffName: string, distance: number, rates: AllianzRates): { amount: number; qty: number } | null {
  const n = (tariffName || '').toLowerCase()
  if (/fuel/.test(n))                   return { amount: rates.fuel, qty: 1 }
  if (/remorquage sans/.test(n))        return { amount: rates.remorquage, qty: 1 }
  if (/r[ée]par[ée] sur place/.test(n)) return { amount: rates.repare, qty: 1 }
  if (/suppl[ée]ment distance/.test(n)) {
    const qty = supplementKm(distance, rates.kmInclus)
    return { amount: round2(qty * rates.kmPrice), qty }
  }
  if (/autre|note de cr[ée]dit/.test(n)) return { amount: 0, qty: 1 }
  return null   // Siabis / Siabis Majoré / inconnu → non calculable
}

/** Lignes tarifaires Allianz à IGNORER (ni facturées, ni bloquantes pour la
 *  clôture). Olivier 2026-06-19 : "Réparation pneu" est renvoyée par Allianz pour
 *  le service R même quand l'intervention n'a rien à voir (ex. batterie) → on
 *  facture "Réparé sur place" et on ignore cette ligne. */
function isIgnoredAllianzLine(tariffName: string): boolean {
  const n = (tariffName || '').toLowerCase()
  return /r[ée]paration\s+pneu/.test(n)
}

/** Géocode une adresse via Google → coords + composants (pour finalDestination). */
async function geocodeAddress(address: string): Promise<
  { lat: number; lng: number; street?: string; streetNumber?: string; zipCode?: string; city?: string; formatted?: string } | null
> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY
  const addr = (address || '').trim()
  if (!key || !addr) return null
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&region=be&language=fr&key=${key}`, { signal: AbortSignal.timeout(10000) })
    const j = await r.json()
    const res = j.results?.[0]
    if (!res?.geometry?.location) return null
    const comp = (type: string) => res.address_components?.find((c: any) => c.types?.includes(type))?.long_name
    return {
      lat: res.geometry.location.lat,
      lng: res.geometry.location.lng,
      streetNumber: comp('street_number'),
      street:       comp('route'),
      zipCode:      comp('postal_code'),
      city:         comp('locality') || comp('postal_town'),
      formatted:    res.formatted_address,
    }
  } catch { return null }
}

function headers(token: string): Record<string, string> {
  return {
    'guac-authorization':  `Bearer ${token}`,
    'subscriptioncountry': 'BEL',
    'origin':              'https://www.allianzpartners-providerplatform.com',
    'referer':            'https://www.allianzpartners-providerplatform.com/',
    'accept':             'application/json, text/plain, */*',
    'accept-language':    'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'content-type':       'application/json',
    'User-Agent':         'Mozilla/5.0 (compatible; VerviersDepannage/1.0)',
  }
}

/** Décode l exp d un JWT (sans vérifier la signature). */
function jwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch { return null }
}

/**
 * Récupère un access_token Hexalite valide depuis allianz_otp_pending.
 * Prend le plus récent (status verified/done) dont le JWT n est pas expiré.
 */
export async function getValidAllianzToken(): Promise<string> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('allianz_otp_pending')
    .select('access_token, created_at, status')
    .in('status', ['verified', 'done'])
    .not('access_token', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5)
  const now = Math.floor(Date.now() / 1000)
  for (const row of (data || [])) {
    const exp = jwtExp(row.access_token)
    if (exp && exp - now > 120) return row.access_token   // marge 2 min
  }
  throw new Error('Token Allianz expiré ou absent — relance une connexion Allianz (OTP).')
}

// ─── Génération des heures (Olivier 2026-06-12) ──────────────────────────
// début = réception + 1 min · arrivée = début + rand(15..30) · fin = arrivée + rand(15..20)
function brusselsIso(d: Date): string {
  // Format type Hexalite : 2026-06-12T09:37:52.5252+02:00 (heure locale Brussels)
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => parts.find(p => p.type === t)?.value || '00'
  // offset réel Brussels (CET/CEST) via différence UTC/Brussels
  const localStr = d.toLocaleString('en-US', { timeZone: 'Europe/Brussels' })
  const utcStr   = d.toLocaleString('en-US', { timeZone: 'UTC' })
  const offset   = (new Date(localStr).getTime() - new Date(utcStr).getTime()) / 60000
  const sign = offset >= 0 ? '+' : '-'
  const oh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const om = String(Math.abs(offset) % 60).padStart(2, '0')
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}.0000${sign}${oh}:${om}`
}

export interface ClosureTimes { start: string; arrival: string; end: string }

export function generateClosureTimes(receivedIso: string, rand: () => number = Math.random): ClosureTimes {
  const base = new Date(receivedIso)
  if (!isFinite(base.getTime())) throw new Error('received_at invalide')
  const start   = new Date(base.getTime() + 1 * 60_000)
  const arrival = new Date(start.getTime()   + (15 + Math.floor(rand() * 16)) * 60_000)  // +15..30
  const end     = new Date(arrival.getTime() + (15 + Math.floor(rand() * 6))  * 60_000)  // +15..20
  return { start: brusselsIso(start), arrival: brusselsIso(arrival), end: brusselsIso(end) }
}

// ─── Étapes Hexalite ─────────────────────────────────────────────────────

/** Liste les missions à clôturer (onglet TO_ASSIGN). */
export async function listAllianzToAssign(token: string): Promise<{ content: any[]; counts: any }> {
  const from = '2026-06-04T22:00:00+00:00'   // large fenêtre (sera paramétrable)
  const to   = new Date(Date.now() + 31 * 24 * 3600_000).toISOString()
  const url = `${BASE_URL}/hexalite-job-monitoring/v2.0/search/assignments`
    + `?estimatedDispatchTimeFrom=${encodeURIComponent(from)}`
    + `&estimatedDispatchTimeTo=${encodeURIComponent(to)}`
    + `&sort=estimatedDispatchTime,asc&tabType=TO_ASSIGN&fromCache=true&size=250`
    + `&cache_buster=${Date.now()}`
  const res = await fetch(url, { headers: headers(token), signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`listAllianzToAssign HTTP ${res.status}`)
  const j = await res.json()
  return { content: j?.assignmentJobDataPage?.content || [], counts: j?.tabCountList || null }
}

/** Étape 1 : affectation manuelle (PUT status SVPSD). */
async function putManualAssign(token: string, caseId: string, assignmentId: string): Promise<{ alreadyAssigned: boolean }> {
  const url = `${BASE_URL}/hexalite-job-monitoring/v1.0/assistanceCases/${caseId}/assignments/${assignmentId}/status?cache_buster=${Date.now()}`
  const res = await fetch(url, { method: 'PUT', headers: headers(token), body: JSON.stringify({ subStatus: 'SVPSD' }), signal: AbortSignal.timeout(20000) })
  if (res.ok) return { alreadyAssigned: false }
  const txt = await res.text()
  // Déjà en SVPSD = affectation manuelle déjà faite (transition SVPSD→SVPSD
  // refusée). Ce n'est pas une erreur : on continue la clôture (tarifs + soumission).
  // Olivier 2026-06-17.
  if (res.status === 400 && /DUPLICATE_STATUS_UPDATE|SVPSD\s+to\s+SVPSD/i.test(txt)) {
    return { alreadyAssigned: true }
  }
  throw new Error(`Affectation manuelle KO HTTP ${res.status}: ${txt.slice(0, 200)}`)
}

/** Étape 2 : récupère les tarifs (Allianz calcule). */
async function getTariffs(token: string, assignmentId: string, providedService: string, lat: number | null, lng: number | null, zip: string | null): Promise<any[]> {
  const url = `${BASE_URL}/hexalite-service-broker/v2.0/assignments/${assignmentId}/assignmenttariffs`
    + `?providedService=${encodeURIComponent(providedService)}`
    + (lat != null ? `&latitude=${lat}` : '')
    + (lng != null ? `&longitude=${lng}` : '')
    + (zip ? `&zipCode=${encodeURIComponent(zip)}` : '')
    + `&countryCode=BE&locale=fr-FR&cache_buster=${Date.now()}`
  const res = await fetch(url, { headers: headers(token), signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Tarifs KO HTTP ${res.status}`)
  const j = await res.json()
  return Array.isArray(j) ? j : []
}

/** Mappe une ligne de tarif (assignmenttariffs) + montant calculé → bill (expertreports),
 *  structure EXACTE captée d une soumission réussie (Olivier 2026-06-12). */
function tariffToBill(t: any, amount: number, qty: number): any {
  return {
    assignmentTariffId: t.self ?? null,
    grossCost:          'EUR',
    grossCostAmount:    amount,
    partyInCharge:      null,
    serviceDes:         null,
    typeOfBill:         t.tariffType || 'S',
    unitCalculation:    qty,
    unitType:           t.unitType ?? null,
  }
}

export interface CloseInput {
  caseId:           string
  assignmentId:     string
  providedService:  string                       // 'T' | 'R' | 'D'
  receivedIso:      string                        // heure de mission Hexalite (1ère colonne) — base des heures générées
  distanceKm?:      number                         // km total (VD Soft). Si absent + towsoftNum fourni, résolu via TowSoft.
  towsoftNum?:      string | null                  // fallback : récupère distance + destination depuis TowSoft
  plate?:           string | null                  // pour regrouper les fiches TowSoft d un même dossier (REM via dépôt)
  towsoftDossier?:  string | null                  // dossier TowSoft : somme les km des fiches liées, destination = fiche finale
  mileage?:         string                         // kilométrage véhicule (def "0")
  finalSubCaseCause?: string                       // def KA704
  destination?:     { name: string; countryCode?: string; countryName?: string; latitude?: number; longitude?: number }
  tariffLat?:       number | null
  tariffLng?:       number | null
  tariffZip?:       string | null
  dryRun?:          boolean
}

export interface CloseResult {
  ok:        boolean
  dryRun:    boolean
  steps:     Array<{ step: string; ok: boolean; detail?: string }>
  payload?:  any       // le body expertreports (construit)
  tariffs?:  any[]     // les lignes renvoyées par Allianz
  error?:    string
}

/**
 * Autoclôture d une mission Allianz. dryRun=true : exécute UNIQUEMENT le GET
 * tarifs (aucune écriture) et renvoie le payload qui serait soumis.
 */
export async function closeAllianzAssignment(input: CloseInput): Promise<CloseResult> {
  const steps: CloseResult['steps'] = []
  const dryRun = !!input.dryRun
  let token: string
  try { token = await getValidAllianzToken() }
  catch (e: any) { return { ok: false, dryRun, steps, error: e.message } }

  const times = generateClosureTimes(input.receivedIso)

  // Résolution distance + destination depuis TowSoft si pas fournies (fallback hors VD Soft).
  // Cas REM via dépôt : 2 fiches TowSoft pour le même dossier → on SOMME les km
  // et on prend la destination de la fiche FINALE (la 2ᵉ, qui porte l adresse de dest).
  let distanceKm = input.distanceKm
  let destination = input.destination
  if ((distanceKm == null || destination == null) && input.towsoftNum) {
    try {
      const { fetchTowsoftDetail }   = await import('@/lib/towsoft-detail')
      const { searchTowsoftGlobal }  = await import('@/lib/towsoft-client')

      // Détermine les fiches (legs) : la fiche + ses sœurs du même dossier/plaque (non annulées).
      let legNums: string[] = [input.towsoftNum]
      if (input.plate && input.towsoftDossier) {
        const hits = await searchTowsoftGlobal('immatriculation', input.plate)
        const sibs = hits.filter(h => h.dossier && h.dossier === input.towsoftDossier && !/annul/i.test(h.statut || ''))
        legNums = Array.from(new Set([input.towsoftNum, ...sibs.map(h => h.towsoft_num)]))
      }

      const parseKm = (s: any) => {
        const n = Number(String(s || '').replace(',', '.').replace(/[^\d.]/g, ''))
        return Number.isFinite(n) ? n : 0
      }
      // Trie par n° croissant : la dernière fiche = leg final (destination réelle).
      legNums.sort((a, b) => Number(a) - Number(b))
      let sumKm = 0
      let destFromLeg: CloseInput['destination'] | null = null
      for (const n of legNums) {
        const d = await fetchTowsoftDetail(n)
        sumKm += parseKm(d.distance_km)
        if (d.dest_addr) {
          destFromLeg = { name: [d.dest_addr, d.dest_cp, d.dest_ville].filter(Boolean).join(' '), countryCode: 'BE', countryName: 'Belgique' }
        }
      }
      if (distanceKm == null && sumKm > 0) distanceKm = sumKm
      if (destination == null && destFromLeg) destination = destFromLeg
      if (legNums.length > 1) {
        steps.push({ step: 'towsoft_legs', ok: true, detail: `${legNums.length} fiches sommées = ${sumKm} km (dossier ${input.towsoftDossier})` })
      }
    } catch (e: any) {
      steps.push({ step: 'towsoft_fallback', ok: false, detail: e.message })
    }
  }
  if (distanceKm == null || !Number.isFinite(distanceKm)) {
    return { ok: false, dryRun, steps, error: 'Distance introuvable (ni VD Soft ni TowSoft)' }
  }

  // Géocodage de la destination (remorquage T uniquement) — Allianz exige des
  // coordonnées pour placer la "Destination du remorquage", sinon montants à 0.
  let destGeo: Awaited<ReturnType<typeof geocodeAddress>> = null
  if (input.providedService === 'T' && destination?.name) {
    if (destination.latitude != null && destination.longitude != null) {
      destGeo = { lat: destination.latitude, lng: destination.longitude }
    } else {
      destGeo = await geocodeAddress(destination.name)
      steps.push({ step: 'geocode_destination', ok: !!destGeo, detail: destGeo ? `${destGeo.lat},${destGeo.lng}` : 'échec géocodage' })
    }
  }
  // Garde-fou STRICT : remorquage (T) sans destination géocodée => on bloque.
  if (!dryRun && input.providedService === 'T' && !destGeo) {
    return { ok: false, dryRun, steps, error: 'Destination du remorquage non géocodée — soumission bloquée (évite les montants à 0).' }
  }

  try {
    // Étape 1 : affectation manuelle (sautée en dry-run)
    if (!dryRun) {
      const ma = await putManualAssign(token, input.caseId, input.assignmentId)
      steps.push({ step: 'affectation_manuelle', ok: true, detail: ma.alreadyAssigned ? 'déjà affectée (SVPSD)' : undefined })
    } else {
      steps.push({ step: 'affectation_manuelle', ok: true, detail: 'sautée (dry-run)' })
    }

    // Étape 2 : tarifs (lignes + assignmentTariffId ; les montants viennent de la grille)
    const tariffs = await getTariffs(token, input.assignmentId, input.providedService, input.tariffLat ?? null, input.tariffLng ?? null, input.tariffZip ?? null)
    steps.push({ step: 'tarifs', ok: true, detail: `${tariffs.length} lignes` })

    // Grille tarifaire Allianz (source_tariffs) → montants calculés.
    const rates = await loadAllianzRates()
    if (!rates) {
      return { ok: false, dryRun, steps, error: 'Tarif Allianz non configuré (source_tariffs source=mondial). À ajouter dans /admin/tarifs.' }
    }

    // Distance déclarée = arrondi sup + 2 (règle Olivier). Sert au supplément distance.
    const declaredDistance = Math.ceil(distanceKm) + 2

    // Bills = lignes ayant un `self` (assignmentTariffId), montants depuis la grille.
    // Une ligne non calculable (ex "Siabis") => on la signale (clôture manuelle).
    const nonComputable: string[] = []
    const bills = tariffs.filter(t => t.self).map(t => {
      if (isIgnoredAllianzLine(t.tariffName)) return null   // ligne ignorée : ni bill, ni blocage
      const calc = allianzLineAmount(t.tariffName, declaredDistance, rates)
      if (!calc) { nonComputable.push(t.tariffName || '?'); return null }
      return tariffToBill(t, calc.amount, calc.qty)
    }).filter(Boolean) as any[]

    const payload: any = {
      providedService:          input.providedService,
      finalSubCaseCause:        input.finalSubCaseCause || DEFAULT_FINAL_SUB_CASE_CAUSE,
      arrivalDateTime:          times.arrival,
      serviceDeliveryStartTime: times.start,
      serviceDeliveryDateTime:  times.end,
      distance:                 String(declaredDistance),
      contractualDistance:      Number(distanceKm),
      // Kilométrage TOUJOURS 0 (Olivier 2026-06-12) — sinon Allianz reste à 0.
      customerMileageRecord:    { mileage: '0' },
      costCurrency:             'EUR',
      bills,
      expertReportStep:         'C',
    }
    // finalDestination : structure EXACTE captée (geoLocation imbriqué, coords en string).
    if (destination?.name) {
      const lat = destGeo?.lat ?? destination.latitude
      const lng = destGeo?.lng ?? destination.longitude
      payload.finalDestination = {
        name:         destGeo?.formatted || destination.name,
        street:       destGeo?.street ?? null,
        streetNumber: destGeo?.streetNumber ?? null,
        zipCode:      destGeo?.zipCode ?? null,
        city:         destGeo?.city ?? null,
        countryCode:  destination.countryCode || 'BE',
        countryName:  destination.countryName || 'Belgique',
        ...(lat != null && lng != null ? { geoLocation: { latitude: Number(lat).toFixed(5), longitude: Number(lng).toFixed(5) } } : {}),
      }
    }

    const finalTotal = bills.reduce((s: number, b: any) => s + (Number(b.grossCostAmount) || 0), 0)
    ;(payload as any)._totalHt = round2(finalTotal)   // info UI (retiré avant POST)

    if (dryRun) {
      return { ok: true, dryRun: true, steps, payload, tariffs }
    }

    // Garde-fou : ligne non calculable (Siabis…) => clôture manuelle.
    if (nonComputable.length) {
      steps.push({ step: 'montants', ok: false, detail: `non calculable : ${nonComputable.join(', ')}` })
      return { ok: false, dryRun: false, steps, payload, tariffs, error: `Ligne tarifaire spéciale non automatisable (${nonComputable.join(', ')}) — à clôturer manuellement dans Allianz.` }
    }
    if (finalTotal <= 0) {
      steps.push({ step: 'montants', ok: false, detail: 'total à 0' })
      return { ok: false, dryRun: false, steps, payload, tariffs, error: 'Montant total à 0 — soumission bloquée (vérifier la grille source_tariffs mondial).' }
    }
    steps.push({ step: 'montants', ok: true, detail: `${round2(finalTotal)} € HT` })
    delete (payload as any)._totalHt
    // Petit délai avant soumission (stabilité après affectation manuelle).
    await new Promise(r => setTimeout(r, 1200))

    // Étape 3 : soumission
    const url = `${BASE_URL}/hexalite-job-monitoring/v1.0/assistanceCases/${input.caseId}/assignments/${input.assignmentId}/expertreports?cache_buster=${Date.now()}`
    const res = await fetch(url, { method: 'POST', headers: headers(token), body: JSON.stringify(payload), signal: AbortSignal.timeout(25000) })
    const txt = (await res.text().catch(() => '')).slice(0, 400)
    if (!res.ok) {
      steps.push({ step: 'soumission', ok: false, detail: `HTTP ${res.status}: ${txt}` })
      return { ok: false, dryRun: false, steps, payload, tariffs, error: `Soumission KO HTTP ${res.status}` }
    }
    steps.push({ step: 'soumission', ok: true, detail: `HTTP ${res.status}` })
    return { ok: true, dryRun: false, steps, payload, tariffs }
  } catch (e: any) {
    steps.push({ step: 'erreur', ok: false, detail: e.message })
    return { ok: false, dryRun, steps, error: e.message }
  }
}
