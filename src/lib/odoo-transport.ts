// ============================================================
// VERVIERS DÉPANNAGE — Transport Odoo unique (JSON-2 / JSON-RPC)
// ------------------------------------------------------------
// Odoo a déclaré XML-RPC et JSON-RPC (/jsonrpc) obsolètes : ils disparaissent
// d'Odoo Online à la 21.1 (hiver 2027). Remplaçant : JSON-2
// (POST /json/2/<modèle>/<méthode>, clé API en bearer, arguments NOMMÉS).
//
// TOUS les appels Odoo de l'app passent ici : le connecteur principal
// (@/lib/odoo), les connecteurs Achats, FSM, factures, relances et les routes
// qui avaient leur propre fetch. Chaque appelant garde SON identité (clé de
// l'utilisateur, utilisateur Achats, base de test FSM) et SON contexte
// (allowed_company_ids) : ce module ne fait que le transport.
//
// Choix du transport, sans redéployer :
//   1. réglage `odoo_api` dans app_settings (valeur JSON "json2" ou "jsonrpc"),
//      relu toutes les 60 s — c'est l'interrupteur de bascule et de retour arrière ;
//   2. sinon la variable d'environnement ODOO_API (json2 | jsonrpc) ;
//   3. sinon "jsonrpc" (l'ancien transport, inchangé) tant que JSON-2 n'a pas
//      été validé en production.
//
// Les deux transports rendent la même forme qu'avant : { result } ou
// { error: { code, message, data: { name, message, debug } } }, pour que les
// messages d'erreur (et les tests « does not exist », « AccessError »…) restent
// identiques.
// ============================================================

import { OdooJson2, OdooError } from '@/lib/odoo-json2'
import { fetchWithRetry } from '@/lib/fetch-with-retry'

export type OdooApiMode = 'json2' | 'jsonrpc'

/** Qui appelle Odoo : base visée et clé API (uid ignoré en JSON-2, la clé suffit). */
export interface OdooIdentity { url: string; db: string; uid: number; apiKey: string }

/** Options d'envoi. Sans `timeoutMs`, un simple fetch (comportement historique des petits connecteurs). */
export interface OdooSendOptions {
  timeoutMs?:   number
  maxAttempts?: number
  logPrefix?:   string
  /** Force un transport pour cet appel (tests de comparaison). */
  mode?:        OdooApiMode
}

/** Erreur au format JSON-RPC (les deux transports la produisent). */
export interface OdooRpcErrorPayload {
  code?:    number
  message:  string
  data?:    { name?: string; message?: string; debug?: string; arguments?: unknown[] }
}
export type OdooResponse<T> = { result: T; error?: undefined } | { result?: undefined; error: OdooRpcErrorPayload }

/** Identité du compte de service « VD App » (variables ODOO_*), lue à l'appel. */
export function masterIdentity(): OdooIdentity {
  return {
    url:    process.env.ODOO_URL || '',
    db:     process.env.ODOO_DB || '',
    uid:    parseInt(process.env.ODOO_UID || '8', 10),
    apiKey: process.env.ODOO_API_KEY || '',
  }
}

// ── Choix du transport ──────────────────────────────────────────────────────
function envMode(): OdooApiMode {
  const v = (process.env.ODOO_API || '').trim().toLowerCase()
  return v === 'json2' ? 'json2' : 'jsonrpc'
}

const SWITCH_TTL_MS = 60_000
let switchCache: { mode: OdooApiMode | null; exp: number } | null = null
let switchPending: Promise<OdooApiMode | null> | null = null

async function readSwitch(): Promise<OdooApiMode | null> {
  // Hors de l'app (scripts sans Supabase) : pas d'interrupteur, la variable décide.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const { createAdminClient } = await import('@/lib/supabase')
    const { data } = await createAdminClient().from('app_settings').select('value').eq('key', 'odoo_api').maybeSingle()
    if (!data?.value) return null
    let v: unknown = data.value
    try { v = JSON.parse(String(data.value)) } catch { /* texte brut */ }
    const s = String(v).trim().toLowerCase()
    return s === 'json2' || s === 'jsonrpc' ? s : null
  } catch (e: any) {
    console.warn('[odoo-transport] interrupteur odoo_api illisible, variable ODOO_API utilisée :', e?.message)
    return null
  }
}

/** Transport en vigueur (interrupteur app_settings > ODOO_API > jsonrpc). */
export async function odooApiMode(): Promise<OdooApiMode> {
  if (switchCache && switchCache.exp > Date.now()) return switchCache.mode ?? envMode()
  if (!switchPending) {
    switchPending = readSwitch().then((mode) => {
      switchCache = { mode, exp: Date.now() + SWITCH_TTL_MS }
      switchPending = null
      return mode
    })
  }
  return (await switchPending) ?? envMode()
}

// ── JSON-2 ──────────────────────────────────────────────────────────────────
// Le client commun (copie de hoos-compta/outils/odoo-json2) est gardé tel quel.
// Cette sous-classe ne change que l'envoi : elle garde le corps d'erreur complet
// (nom de l'exception Odoo) et reprend les réessais de l'ancien transport
// (réseau, délai dépassé, 502/503/504) en plus du 429 du client commun.
class VdJson2 extends OdooJson2 {
  constructor(id: OdooIdentity, private readonly send: OdooSendOptions) {
    super({ url: id.url, db: id.db, apiKey: id.apiKey, timeoutMs: send.timeoutMs })
  }

  override async raw<T = unknown>(model: string, method: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.config.url.replace(/\/$/, '')}/json/2/${model}/${method}`
    const init: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `bearer ${this.config.apiKey}`,
        'X-Odoo-Database': this.config.db,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    }
    let res: Response
    if (this.send.timeoutMs) {
      res = await fetchWithRetry(url, {
        ...init,
        timeoutMs:     this.send.timeoutMs,
        maxAttempts:   this.send.maxAttempts ?? 3,
        logPrefix:     this.send.logPrefix ?? `[Odoo ${model}.${method}]`,
        // Une exception Odoo (500 en JSON-2) n'est pas transitoire : pas de réessai.
        retryOnStatus: (s) => s === 429 || s === 502 || s === 503 || s === 504,
      })
    } else {
      for (let essai = 0; ; essai++) {
        res = await fetch(url, init)
        if (res.status !== 429 || essai >= 3) break
        const attente = Number(res.headers.get('Retry-After')) || 2 * (essai + 1)
        await new Promise((r) => setTimeout(r, attente * 1000))
      }
    }
    const text = await res.text()
    if (!res.ok) {
      let detail: any = null
      try { detail = JSON.parse(text) } catch { /* texte brut */ }
      const err = new OdooError(`${model}.${method} : HTTP ${res.status} — ${String(detail?.message ?? text).slice(0, 500)}`, res.status)
      ;(err as any).detail = detail ?? { message: text.slice(0, 2000) }
      throw err
    }
    return (text ? JSON.parse(text) : null) as T
  }

  // Documentation des méthodes : lue sans le cache de Next (sinon une montée de
  // version d'Odoo garderait les anciens noms d'arguments) et relue toutes les 6 h.
  // Méthode absente de la documentation → aucun nom : l'appel échoue clairement
  // plutôt que de deviner.
  private vdDocs = new Map<string, { exp: number; p: Promise<Record<string, { parameters?: Record<string, unknown> }>> }>()
  override async paramNames(model: string, method: string): Promise<string[]> {
    let d = this.vdDocs.get(model)
    if (!d || d.exp < Date.now()) {
      const p = fetch(`${this.config.url.replace(/\/$/, '')}/doc-bearer/${model}.json`, {
        headers: { Authorization: `bearer ${this.config.apiKey}`, 'X-Odoo-Database': this.config.db },
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : { methods: {} }))
        .then((j: any) => j.methods ?? {})
        .catch(() => ({}))
      d = { exp: Date.now() + 6 * 3600_000, p }
      this.vdDocs.set(model, d)
    }
    const params = (await d.p)[method]?.parameters
    if (!params) return []
    return Object.keys(params).filter((n) => !n.endsWith('kwargs'))
  }
}

const clients = new Map<string, VdJson2>()
function json2Client(id: OdooIdentity, send: OdooSendOptions): VdJson2 {
  const k = `${id.url}|${id.db}|${id.apiKey}|${send.timeoutMs ?? 0}|${send.maxAttempts ?? 0}|${send.logPrefix ?? ''}`
  let c = clients.get(k)
  if (!c) { c = new VdJson2(id, send); clients.set(k, c) }
  return c
}

// Méthodes de MODÈLE (sans ids) et noms d'arguments stables d'Odoo 17 à 20 :
// les nommer ici évite de télécharger la documentation du modèle (100 à 300 ko)
// à chaque démarrage de fonction. Tout le reste passe par le client commun, qui
// lit les noms dans /doc-bearer/<modèle>.json.
const NOMS_MODELE: Record<string, string[]> = {
  search_read:  ['domain', 'fields', 'offset', 'limit', 'order'],
  search:       ['domain', 'offset', 'limit', 'order'],
  search_count: ['domain', 'limit'],
  fields_get:   ['allfields', 'attributes'],
  name_search:  ['name', 'domain', 'operator', 'limit'],
  formatted_read_group: ['domain', 'groupby', 'aggregates', 'having', 'offset', 'limit', 'order'],
  default_get:  ['fields_list'],
}
const NOMS_ENREG: Record<string, string[]> = {
  read:  ['fields', 'load'],
  write: ['vals'],
  copy:  ['default'],
  unlink: [],
}

async function callJson2<T>(id: OdooIdentity, model: string, method: string, args: any[], kwargs: Record<string, any>, send: OdooSendOptions): Promise<T> {
  const client = json2Client(id, send)
  if (method === 'create' && Array.isArray(args[0]) && args.length === 1) {
    return client.raw<T>(model, 'create', { ...kwargs, vals_list: args[0] })
  }
  const modele = NOMS_MODELE[method]
  if (modele && args.length <= modele.length) {
    const body: Record<string, unknown> = { ...kwargs }
    args.forEach((v, i) => { body[modele[i]!] = v })
    return client.raw<T>(model, method, body)
  }
  const enreg = NOMS_ENREG[method]
  if (enreg && args.length - 1 <= enreg.length) {
    const ids = args[0]
    const body: Record<string, unknown> = { ...kwargs, ids: Array.isArray(ids) ? ids : ids == null ? [] : [ids] }
    args.slice(1).forEach((v, i) => { body[enreg[i]!] = v })
    return client.raw<T>(model, method, body)
  }
  // Méthodes métier (action_post, reconcile, send_mail…) : le client commun.
  return client.call<T>(model, method, args, kwargs)
}

function json2ErrorPayload(e: any): OdooRpcErrorPayload {
  const d = e?.detail
  const name = d?.name
    ?? (e?.status === 403 ? 'odoo.exceptions.AccessError'
      : e?.status === 404 ? 'odoo.exceptions.MissingError'
      : e?.status === 401 ? 'odoo.exceptions.AccessDenied' : undefined)
  const message = String(d?.message ?? e?.message ?? 'erreur Odoo')
  return {
    code: e?.status ?? 0,
    message: 'Odoo Server Error',
    data: { name, message, debug: d?.debug, arguments: d?.arguments ?? [message] },
  }
}

// ── JSON-RPC (ancien transport, à l'identique) ──────────────────────────────
async function sendJsonRpc<T>(id: OdooIdentity, model: string, method: string, args: any[], kwargs: Record<string, any> | undefined, send: OdooSendOptions): Promise<OdooResponse<T>> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Date.now(),
      params: {
        service: 'object', method: 'execute_kw',
        args: kwargs === undefined
          ? [id.db, id.uid, id.apiKey, model, method, args]
          : [id.db, id.uid, id.apiKey, model, method, args, kwargs],
      },
    }),
  }
  const res = send.timeoutMs
    ? await fetchWithRetry(`${id.url}/jsonrpc`, {
        ...init,
        timeoutMs:   send.timeoutMs,
        maxAttempts: send.maxAttempts ?? 3,
        logPrefix:   send.logPrefix ?? `[Odoo ${model}.${method}]`,
      })
    : await fetch(`${id.url}/jsonrpc`, init)
  return await res.json()
}

// ── Point d'entrée ──────────────────────────────────────────────────────────
/**
 * Appel Odoo à la forme execute_kw (args par position, kwargs nommés), rendu au
 * format JSON-RPC : { result } ou { error }. Les erreurs réseau sont levées
 * comme avant ; les exceptions Odoo arrivent dans `error`.
 * `kwargs` absent = appel sans kwargs (forme historique de quelques routes).
 */
export async function odooSend<T = any>(
  id: OdooIdentity, model: string, method: string, args: any[] = [], kwargs?: Record<string, any>, send: OdooSendOptions = {},
): Promise<OdooResponse<T>> {
  const mode = send.mode ?? await odooApiMode()
  if (mode === 'jsonrpc') return sendJsonRpc<T>(id, model, method, args, kwargs, send)
  try {
    return { result: await callJson2<T>(id, model, method, args, kwargs ?? {}, send) }
  } catch (e: any) {
    if (e instanceof OdooError && (e.status || (e as any).detail)) return { error: json2ErrorPayload(e) }
    // Argument positionnel sans nom connu : erreur de programmation, rendue comme une erreur Odoo.
    if (e instanceof OdooError) return { error: { code: 0, message: 'Odoo Server Error', data: { name: 'json2.ArgumentError', message: e.message } } }
    throw e
  }
}

/** Variante qui lève une Error (message au format historique du connecteur principal). */
export async function odooExecute<T = any>(
  id: OdooIdentity, model: string, method: string, args: any[] = [], kwargs?: Record<string, any>, send: OdooSendOptions = {},
): Promise<T> {
  const data = await odooSend<T>(id, model, method, args, kwargs, send)
  if (data.error) throw new Error(`Odoo RPC [${model}.${method}]: ${JSON.stringify(data.error)}`)
  return data.result as T
}
