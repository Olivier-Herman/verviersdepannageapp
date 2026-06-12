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
async function putManualAssign(token: string, caseId: string, assignmentId: string): Promise<void> {
  const url = `${BASE_URL}/hexalite-job-monitoring/v1.0/assistanceCases/${caseId}/assignments/${assignmentId}/status?cache_buster=${Date.now()}`
  const res = await fetch(url, { method: 'PUT', headers: headers(token), body: JSON.stringify({ subStatus: 'SVPSD' }), signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Affectation manuelle KO HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
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

/** Mappe une ligne de tarif (assignmenttariffs) → une ligne bill (expertreports). */
function tariffToBill(t: any): any {
  // unitCost / lineAmount sont des strings "EUR x.xx" ; on extrait le nombre.
  const num = (s: any) => {
    const m = String(s || '').match(/-?\d+(?:[.,]\d+)?/)
    return m ? Number(m[0].replace(',', '.')) : 0
  }
  return {
    grossCostAmount: num(t.lineAmount),
    typeOfBill:      t.tariffType || 'S',
    partyInCharge:   null,
    unitCalculation: t.unitAmount ?? 1,
    unitType:        t.unitType ?? null,
    tariffName:      t.tariffName ?? null,
    self:            t.self ?? null,
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
  // Garde-fou : destination obligatoire UNIQUEMENT pour le remorquage (T).
  // Réparé sur place (R) / Trajet à vide (D) n ont pas de destination.
  if (!dryRun && input.providedService === 'T' && !destination?.name) {
    return { ok: false, dryRun, steps, error: 'Destination du remorquage manquante — soumission bloquée (sinon montants à 0).' }
  }

  try {
    // Étape 1 : affectation manuelle (sautée en dry-run)
    if (!dryRun) {
      await putManualAssign(token, input.caseId, input.assignmentId)
      steps.push({ step: 'affectation_manuelle', ok: true })
    } else {
      steps.push({ step: 'affectation_manuelle', ok: true, detail: 'sautée (dry-run)' })
    }

    // Étape 2 : tarifs
    const tariffs = await getTariffs(token, input.assignmentId, input.providedService, input.tariffLat ?? null, input.tariffLng ?? null, input.tariffZip ?? null)
    steps.push({ step: 'tarifs', ok: true, detail: `${tariffs.length} lignes` })

    // Construit le payload expertreports
    const bills = tariffs.filter(t => !t.isExtraCost || (t.unitAmount && t.unitAmount > 0)).map(tariffToBill)
    const payload: any = {
      providedService:          input.providedService,
      finalSubCaseCause:        input.finalSubCaseCause || DEFAULT_FINAL_SUB_CASE_CAUSE,
      arrivalDateTime:          times.arrival,
      serviceDeliveryStartTime: times.start,
      serviceDeliveryDateTime:  times.end,
      // Distance déclarée : arrondi à l unité supérieure + 2 (règle Olivier 2026-06-12)
      distance:                 String(Math.ceil(distanceKm) + 2),
      contractualDistance:      Number(distanceKm),
      // Kilométrage TOUJOURS 0 (Olivier 2026-06-12) — sinon Allianz reste à 0.
      customerMileageRecord:    { mileage: '0' },
      costCurrency:             'EUR',
      bills,
      expertReportStep:         'C',
    }
    if (destination?.name) {
      payload.finalDestination = {
        name:        destination.name,
        countryCode: destination.countryCode || 'BE',
        countryName: destination.countryName || 'Belgique',
        ...(destination.latitude  != null ? { latitude:  destination.latitude }  : {}),
        ...(destination.longitude != null ? { longitude: destination.longitude } : {}),
      }
    }

    if (dryRun) {
      return { ok: true, dryRun: true, steps, payload, tariffs }
    }

    // Délai de calcul Allianz : ~2 s entre "Calculer" (tarifs) et "Soumettre",
    // sinon Allianz soumet avant d avoir calculé → montants à 0 (Olivier 2026-06-12).
    await new Promise(r => setTimeout(r, 2200))
    steps.push({ step: 'attente_calcul', ok: true, detail: '2,2 s' })

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
