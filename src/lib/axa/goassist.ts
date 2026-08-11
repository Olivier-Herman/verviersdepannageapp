// src/lib/axa/goassist.ts
//
// Client API AXA « go&assist ». Cycle de vie COMPLET reversé du bundle web et
// PROUVÉ en live 2026-08-11 (Olivier) :
//   accepter → affecter → pointer (étapes) → signer/skip → completed → report/devis.
//
// Auth : getAxaAccessToken('web') (refresh token rotatif persisté en DB). Config
// statique non-secrète en env (base/apiKey/clientId/technicien). Cf mémoire
// [[project_axa_goassist_integration]].
//
// ⚠️ go&assist répond souvent HTTP 200 avec { isSuccess:false, message } pour les
// erreurs métier → on considère "ok" seulement si isSuccess !== false.
// ⚠️ Concurrence : chaque écriture exige l'`updatedAt` COURANT de la mission
//    (optimistic locking) → les helpers relisent la mission avant d'écrire.

import { getAxaAccessToken } from './auth'

const API_BASE      = process.env.AXA_API_BASE            || 'https://go-and-assist-api-pra.axapartners.com'
const API_KEY       = process.env.AXA_API_KEY             || '313453E64B6BAFA757717DEF6C29C'
const TECH_AUTH0_ID = process.env.AXA_TECHNICIAN_AUTH0_ID || 'auth0|62c5457e120ef14810015750'

/** ISO avec offset (format attendu par go&assist, ex "2026-08-11T20:49:20.107+00:00"). */
export const axaNow = () => new Date().toISOString().replace('Z', '+00:00')

export interface AxaResult { status: number; ok: boolean; data: any; raw: string }

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const tok = await getAxaAccessToken('web')
  return {
    Authorization:    `Bearer ${tok}`,
    ApiKey:           API_KEY,
    platform:         'web',
    'mobile-version': 'null',
    Accept:           'application/json',
    ...extra,
  }
}

async function api(path: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<AxaResult> {
  const headers = await authHeaders(opts.form ? {} : { 'Content-Type': 'application/json' })
  const res = await fetch(`${API_BASE}${path}`, {
    method:  opts.method || 'GET',
    headers,
    body:    opts.form ? opts.form : (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    cache:   'no-store', // Next met en cache les fetch serveur par défaut (cf mémoire)
  })
  const raw = await res.text()
  let data: any = null
  try { data = raw ? JSON.parse(raw) : null } catch { data = raw }
  const ok = res.ok && (data == null || typeof data !== 'object' || data.isSuccess !== false)
  return { status: res.status, ok, data, raw }
}

// ── Lecture ──────────────────────────────────────────────────────────────────

/** Liste TOUTES les missions (historique complet, ~2000+). */
export async function getMissions(): Promise<any[]> {
  const r = await api('/v1.0/mission/getmissions')
  const list = Array.isArray(r.data) ? r.data : (r.data?.missions || r.data?.data || [])
  return Array.isArray(list) ? list : []
}

/** Détail d'une mission. GET /v1.0/mission/{missionOrderId} (data sous .data). */
export async function getMission(missionOrderId: string): Promise<any | null> {
  const r = await api(`/v1.0/mission/${encodeURIComponent(missionOrderId)}`)
  return r.data?.data || r.data || null
}

// Statuts go&assist « actionnables » chez nous (onglets NOUVEAU + À AFFECTER).
//   'New'             = NOUVEAU → AXA a envoyé, on doit VALIDER (accept).
//   'AwaitingDispatch'= À AFFECTER → déjà validé (par nous ou par AXA au tél), à assigner.
// AXA valide souvent lui-même après un rappel tél → une mission peut arriver
// directement en AwaitingDispatch sans passer (visiblement) par New chez nous.
export const AXA_ACTIONABLE_STATUSES = ['New', 'AwaitingDispatch'] as const

/**
 * Missions à récupérer dans VD Soft = NOUVEAU + À AFFECTER, non clôturées.
 * ⚠️ getmissions inclut des AwaitingDispatch historiques auto-clôturés à 3j →
 * on écarte celles trop vieilles via `maxAgeDays`.
 */
export function filterActionable(missions: any[], maxAgeDays = 3): any[] {
  const cutoff = Date.now() - maxAgeDays * 86400_000
  return missions.filter(m => {
    if (!AXA_ACTIONABLE_STATUSES.includes(m.status)) return false
    const sub = Array.isArray(m.subStatus) ? m.subStatus : (m.subStatus ? [m.subStatus] : [])
    if (sub.some((s: string) => /Closed/i.test(s))) return false
    const t = new Date(m.missionSendingDate || m.updatedAt || 0).getTime()
    return !t || t >= cutoff
  })
}

/** Statut go&assist courant d'une mission ('New' | 'AwaitingDispatch' | …). */
export async function getMissionStatus(missionOrderId: string): Promise<string | null> {
  const m = await getMission(missionOrderId)
  return m?.status || null
}

/** updatedAt courant (jeton de concurrence) pour une mission. */
async function currentUpdatedAt(missionOrderId: string): Promise<string | null> {
  const m = await getMission(missionOrderId)
  return m?.updatedAt || null
}

// ── Écritures cycle de vie ───────────────────────────────────────────────────

/** VALIDER (nouveau → à affecter). PATCH /v1.0/mission/accept. */
export async function acceptMission(missionOrderId: string): Promise<AxaResult> {
  const updatedAt = await currentUpdatedAt(missionOrderId)
  return api('/v1.0/mission/accept', {
    method: 'PATCH',
    body:   { missionOrderId, updatedAt, executedAt: axaNow() },
  })
}

/** REFUSER. PATCH /v1.0/mission/refuse. */
export async function refuseMission(missionOrderId: string, reason: string, description = ''): Promise<AxaResult> {
  const updatedAt = await currentUpdatedAt(missionOrderId)
  return api('/v1.0/mission/refuse', {
    method: 'PATCH',
    body:   { missionOrderId, updatedAt, executedAt: axaNow(), refusalReason: reason, description },
  })
}

/**
 * AFFECTER à notre technicien. PATCH /v1.0/mission/dispatch.
 * appointmentAt = heure d'assignation + 1h (convention Olivier) par défaut.
 */
export async function dispatchMission(missionOrderId: string, opts: { appointmentAt?: string; plateNumber?: string } = {}): Promise<AxaResult> {
  const m = await getMission(missionOrderId)
  if (!m) return { status: 404, ok: false, data: null, raw: 'mission introuvable' }
  const appointmentAt = opts.appointmentAt || new Date(Date.now() + 3600_000).toISOString().replace('Z', '+00:00')
  return api('/v1.0/mission/dispatch', {
    method: 'PATCH',
    body: {
      missionOrderId,
      plateNumber: opts.plateNumber ?? (m.case?.registrationPlateNumber || ''),
      updatedAt:   m.updatedAt,
      executedAt:  axaNow(),
      user:        { auth0Id: TECH_AUTH0_ID },
      appointmentAt,
    },
  })
}

/** Étape d'intervention. PATCH /v3.0/mission/intervention. `status` = NOM de l'étape. */
export async function postInterventionStep(missionOrderId: string, status: string, extra: Record<string, any> = {}): Promise<AxaResult> {
  const updatedAt = await currentUpdatedAt(missionOrderId)
  return api('/v3.0/mission/intervention', {
    method: 'PATCH',
    body:   { missionOrderId, updatedAt, executedAt: axaNow(), status, ...extra },
  })
}

/** Signature « passée » (pas de faux trait) : Signed_1/Signed_2 avec isSignatureSkipped. */
export function skipSignatureStep(missionOrderId: string, signedStep: 'Signed_1' | 'Signed_2' = 'Signed_1'): Promise<AxaResult> {
  return postInterventionStep(missionOrderId, signedStep, { isSignatureSkipped: true })
}

/**
 * Signature réelle (trait). POST /v1.0/mission/signature en multipart.
 * ⚠️ NE PAS fixer Content-Type manuellement (le boundary est posé par fetch).
 * vehiculeDamageInformation="[]" quand aucun dégât (chaîne vide → refusé).
 */
export async function submitSignature(missionOrderId: string, opts: { png: Buffer | Uint8Array; noDamageByProvider?: boolean; vehiculeDamageInformation?: string; status?: string }): Promise<AxaResult> {
  const updatedAt = await currentUpdatedAt(missionOrderId)
  const form = new FormData()
  form.append('signature', new Blob([opts.png as unknown as BlobPart], { type: 'image/png' }), 'signature.png')
  form.append('vehiculeDamageInformation', opts.vehiculeDamageInformation ?? '[]')
  form.append('missionOrderId', missionOrderId)
  form.append('updatedAt', String(updatedAt ?? ''))
  form.append('executedAt', axaNow())
  form.append('status', opts.status || 'Signed_1')
  form.append('noDamageByProvider', String(opts.noDamageByProvider ?? true))
  return api('/v1.0/mission/signature', { method: 'POST', form })
}

/** Rapport final → AXA (solde la mission). PATCH /v1.0/mission/report. */
export async function postReport(missionOrderId: string, report: any, opts: { isSendingToAxa?: boolean } = {}): Promise<AxaResult> {
  const updatedAt = await currentUpdatedAt(missionOrderId)
  return api('/v1.0/mission/report', {
    method: 'PATCH',
    body:   { missionOrderId, updatedAt, executedAt: axaNow(), isSendingToAxa: opts.isSendingToAxa ?? false, report },
  })
}

/** Devis (remorquage chiffré). POST /v1.0/mission/quotation. */
export async function postQuotation(missionOrderId: string, quote: any, opts: { isSendingToAxa?: boolean } = {}): Promise<AxaResult> {
  const updatedAt = await currentUpdatedAt(missionOrderId)
  return api('/v1.0/mission/quotation', {
    method: 'POST',
    body:   { missionOrderId, updatedAt, executedAt: axaNow(), isSendingToAxa: opts.isSendingToAxa ?? false, quote },
  })
}

// ── Clôture orchestrée (utilisée par le flux 2 chauffeur) ────────────────────

// Ordre canonique imposé par l'API ; on ne garde que les étapes présentes dans
// la config de la mission (availableSteps). Late est optionnelle → écartée.
const CANONICAL_ORDER = [
  'OnTheRoad', 'OnSite', 'VehicleDamages', 'Started',
  'DestinationAddress', 'VehicleDamages_2', 'Signed_1', 'Signed_2', 'Completed',
]

export interface AxaCloseResult { ok: boolean; steps: Array<{ step: string; ok: boolean; message?: string }>; error?: string }

/**
 * Déroule TOUTE la séquence d'intervention restante jusqu'à Completed, en
 * respectant l'ordre imposé et le type de service (les étapes towing —
 * DestinationAddress + Signed_2 — ne sont jouées que si présentes dans la config).
 * Signatures « passées » (skip) par défaut. Idempotent : reprend après la
 * dernière étape déjà pointée (lastInterventionStatus).
 */
export async function closeMissionAuto(missionOrderId: string): Promise<AxaCloseResult> {
  const m = await getMission(missionOrderId)
  if (!m) return { ok: false, steps: [], error: 'mission introuvable' }

  const available: string[] = m.configuration?.interventionStepConfiguration?.availableSteps || []
  const destination = m.case?.service?.serviceDestination || null
  const sequence = CANONICAL_ORDER.filter(s => available.includes(s))

  // reprendre après la dernière étape déjà faite
  const last = m.lastInterventionStatus
  const startIdx = last ? sequence.indexOf(last) + 1 : 0

  const steps: AxaCloseResult['steps'] = []
  for (const step of sequence.slice(Math.max(0, startIdx))) {
    let extra: Record<string, any> = {}
    if (step === 'DestinationAddress') extra = { destinationAddress: destination || buildDestinationFromIncident(m) }
    if (step === 'Signed_1' || step === 'Signed_2') extra = { isSignatureSkipped: true }
    const r = await postInterventionStep(missionOrderId, step, extra)
    steps.push({ step, ok: r.ok, message: r.data?.message })
    if (!r.ok) return { ok: false, steps, error: `échec à ${step}: ${r.data?.message || r.status}` }
  }
  return { ok: true, steps }
}

/** Destination de repli (mission sans serviceDestination) construite depuis l'incident. */
function buildDestinationFromIncident(m: any): any {
  const a = m.case?.incidentLocation?.address || {}
  return {
    address: {
      streetAddress: a.streetAddress || '',
      postalCode:    a.postalCode || '',
      locality:      a.locality || '',
      country:       a.country || 'BE',
      subdivision:   a.subdivision || null,
    },
  }
}

export const AXA_TECHNICIAN_AUTH0_ID = TECH_AUTH0_ID
