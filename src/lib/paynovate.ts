// ============================================================
// VERVIERS DÉPANNAGE — Portail Paynovate (my Paynovate)
// ============================================================
//
// Le portail n'expose pas d'API publique. On passe par la session web,
// exactement comme un navigateur :
//
//   1. GET  auth.paynovate.com/login          → _token (CSRF) + cookies
//   2. POST auth.paynovate.com/login          → _token + email + password
//   3. redirections → portal.paynovate.com    → cookie my_paynovate_session
//
// Une fois connecté, la source de vérité est l'export CSV :
//   GET /en/{customer}/paymentexport/csv?startDate=JJ/MM/AAAA&endDate=…
// Il contient TOUT (versement, brut/net, commission HTVA + TVA, TID,
// référence marchand) — un seul appel par terminal, pas de scraping.
//
// La session est mise en cache dans app_settings pour éviter de se
// reconnecter à chaque appel. Si le portail nous éjecte, on refait un
// login complet et on réessaie une fois.
//
// ⚠️ Un compte Paynovate = UN terminal. Il y en a deux (Fourrière et
// Dépannage) : toujours boucler sur listCustomers(), jamais coder les IDs.

import { createAdminClient } from '@/lib/supabase'

const AUTH_BASE   = 'https://auth.paynovate.com'
const PORTAL_BASE = 'https://portal.paynovate.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

const SESSION_KEY     = 'paynovate_session'
const SESSION_TTL_MIN = 45

// ── Types ───────────────────────────────────────────────────

export interface PaynovateCustomer {
  id: number
  name: string
}

/** Une transaction carte, telle qu'elle sort de l'export CSV. */
export interface PaynovateTx {
  paymentId:      number          // = le « PAYMENT xxx » du libellé bancaire
  paymentDate:    string          // date du versement (ISO)
  paymentRaw:     number          // brut total du versement
  paymentNet:     number          // net crédité sur le compte
  communication:  string          // libellé bancaire (MID / TID / SOURCE / DATE / BRUT)
  transactionAt:  string | null   // horodatage de l'encaissement (ISO)
  accountingDate: string | null   // date comptable → période de facturation Paynovate
  cardBrand:      string
  rawAmount:      number          // montant encaissé
  commissionHtva: number
  commissionVat:  number
  commissionTvac: number
  netAmount:      number
  tid:            string          // identifie le terminal
  merchantRef:    string          // = le numéro de facture Odoo
  customerId:     number
}

// ── Cookies ─────────────────────────────────────────────────
// Jar minimaliste : paires nom=valeur, ce qui suffit ici puisque tous les
// cookies utiles vivent sur *.paynovate.com.

type Jar = Map<string, string>

function jarHeader(jar: Jar): string {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
}

function absorb(jar: Jar, res: Response) {
  // getSetCookie() renvoie chaque Set-Cookie séparément (Node 18.13+).
  const raw = (res.headers as any).getSetCookie?.() ?? []
  for (const line of raw as string[]) {
    const [pair] = line.split(';')
    const idx = pair.indexOf('=')
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
  }
}

/**
 * fetch qui suit les redirections à la main, pour capturer les cookies posés
 * en cours de route — `redirect: 'follow'` les perdrait.
 */
async function hop(url: string, jar: Jar, init: RequestInit = {}, maxHops = 10): Promise<Response> {
  let current = url
  let body    = init.body
  let method  = init.method || 'GET'

  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, {
      ...init,
      method,
      body,
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8',
        ...(jar.size ? { Cookie: jarHeader(jar) } : {}),
        ...(init.headers || {}),
      },
    })
    absorb(jar, res)

    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString()
      method  = 'GET'        // une redirection après POST repasse en GET
      body    = undefined
      continue
    }
    return res
  }
  throw new Error('Paynovate : trop de redirections')
}

// ── Session ─────────────────────────────────────────────────

async function readCachedJar(): Promise<Jar | null> {
  try {
    const sb = createAdminClient()
    const { data } = await sb.from('app_settings').select('value').eq('key', SESSION_KEY).maybeSingle()
    if (!data?.value) return null
    // ⚠️ app_settings.value est du TEXTE : toujours parser.
    const saved = JSON.parse(data.value as string) as { at: string; cookies: Record<string, string> }
    const ageMin = (Date.now() - new Date(saved.at).getTime()) / 60000
    if (ageMin > SESSION_TTL_MIN) return null
    return new Map(Object.entries(saved.cookies))
  } catch {
    return null
  }
}

async function writeCachedJar(jar: Jar) {
  try {
    const sb = createAdminClient()
    const value = JSON.stringify({ at: new Date().toISOString(), cookies: Object.fromEntries(jar) })
    await sb.from('app_settings').upsert({ key: SESSION_KEY, value }, { onConflict: 'key' })
  } catch {
    /* le cache est un confort, pas une dépendance */
  }
}

/** Login complet. Renvoie un jar authentifié. */
async function login(): Promise<Jar> {
  const email    = process.env.PAYNOVATE_EMAIL
  const password = process.env.PAYNOVATE_PASSWORD
  if (!email || !password) {
    throw new Error("Paynovate : PAYNOVATE_EMAIL / PAYNOVATE_PASSWORD absents de l'environnement")
  }

  const jar: Jar = new Map()

  const page  = await hop(`${AUTH_BASE}/login`, jar)
  const html  = await page.text()
  const token =
    html.match(/name="_token"[^>]*value="([^"]+)"/)?.[1] ??
    html.match(/value="([^"]+)"[^>]*name="_token"/)?.[1]
  if (!token) throw new Error('Paynovate : jeton CSRF introuvable sur la page de connexion')

  const form = new URLSearchParams({ _token: token, email, password })
  const res  = await hop(`${AUTH_BASE}/login?lang=en`, jar, {
    method: 'POST',
    body: form.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${AUTH_BASE}/login`,
    },
  })

  const landing = await res.text()
  if (/these credentials|identifiants|invalid|incorrect/i.test(landing)) {
    throw new Error('Paynovate : identifiants refusés')
  }

  await writeCachedJar(jar)
  return jar
}

/**
 * Appel authentifié. Réutilise la session en cache, et refait un login
 * complet si le portail nous éjecte (session périmée, mot de passe changé).
 */
async function authed(
  path: string,
  opts: { xhr?: boolean; jar?: Jar } = {},
): Promise<{ res: Response; jar: Jar }> {
  let current = opts.jar ?? (await readCachedJar()) ?? (await login())

  // Sans ces en-têtes, Laravel renvoie la page HTML au lieu du JSON.
  const extra: Record<string, string> = opts.xhr
    ? { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' }
    : {}

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await hop(`${PORTAL_BASE}${path}`, current, {
      headers: { Referer: `${PORTAL_BASE}/en`, ...extra },
    })

    // Éjecté vers l'auth server → on reprend une session propre.
    if (res.url.startsWith(AUTH_BASE) || res.status === 401 || res.status === 419) {
      current = await login()
      continue
    }
    if (res.ok) {
      await writeCachedJar(current)
      return { res, jar: current }
    }
    throw new Error(`Paynovate : ${path} → HTTP ${res.status}`)
  }
  throw new Error(`Paynovate : session impossible à établir pour ${path}`)
}

// ── API ─────────────────────────────────────────────────────

/** Les comptes marchands accessibles — un par terminal. Jamais de hardcode. */
export async function listCustomers(): Promise<PaynovateCustomer[]> {
  const { res } = await authed('/en/customers/lookup', { xhr: true })
  const text = await res.text()
  let rows: any
  try { rows = JSON.parse(text) } catch {
    throw new Error('Paynovate : customers/lookup n\'a pas renvoyé de JSON (session perdue ?)')
  }
  if (!Array.isArray(rows)) throw new Error('Paynovate : réponse inattendue sur customers/lookup')
  return rows.map((r: any) => ({ id: Number(r.id), name: String(r.name || '') }))
}

const dmy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`

const num = (s: string | undefined) => {
  const v = parseFloat(String(s ?? '').replace(/\s/g, '').replace(/,/g, ''))
  return Number.isFinite(v) ? v : 0
}

/** « 07/08/2026 » ou « 07/08/2026 12:40:59 » → ISO, ou null si vide. */
function toIso(v: string | undefined): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[\sT]+(\d{2}):(\d{2}):(\d{2}))?$/)
  if (!m) return null
  const [, dd, mm, yyyy, hh, mi, ss] = m
  return hh ? `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}` : `${yyyy}-${mm}-${dd}`
}

/** Parseur CSV tolérant aux guillemets et aux virgules dans les champs. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',')  { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }

  const head = (rows.shift() || []).map(h => h.replace(/^﻿/, '').trim())
  return rows
    .filter(r => r.length > 1)
    .map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
}

/**
 * Toutes les transactions d'un terminal sur une période.
 *
 * ⚠️ Le filtre porte sur la DATE DE VERSEMENT, pas sur la date comptable.
 * Pour un contrôle mensuel, élargir d'au moins un mois en amont, sinon les
 * transactions comptabilisées en début de mois manquent à l'appel.
 */
export async function fetchTransactions(
  customerId: number,
  from: Date,
  to: Date,
): Promise<PaynovateTx[]> {
  const qs = `startDate=${encodeURIComponent(dmy(from))}&endDate=${encodeURIComponent(dmy(to))}&type=csv`
  const { res } = await authed(`/en/${customerId}/paymentexport/csv?${qs}`)
  const text = await res.text()

  if (!/Payment ID/i.test(text.slice(0, 400))) {
    throw new Error(`Paynovate : export CSV illisible pour le compte ${customerId}`)
  }

  return parseCsv(text).map(r => ({
    paymentId:      Number(r['Payment ID']),
    paymentDate:    toIso(r['Payment Date']) ?? '',
    paymentRaw:     num(r['Payment Raw Amount']),
    paymentNet:     num(r['Payment Net Amount']),
    communication:  r['Payment Communication'] || '',
    transactionAt:  toIso(r['Transaction Date']),
    accountingDate: toIso(r['Accounting Date']),
    cardBrand:      r['Card Brand'] || '',
    rawAmount:      num(r['Raw Amount']),
    commissionHtva: num(r['Commission (VAT Excluded)']),
    commissionVat:  num(r['VAT']),
    commissionTvac: num(r['Commission (VAT Included)']),
    netAmount:      num(r['Net Amount']),
    tid:            r['TID'] || '',
    merchantRef:    r['Merchant Reference'] || '',
    customerId,
  })).filter(t => t.paymentId)
}

/** Les transactions de TOUS les terminaux sur une période. */
export async function fetchAllTransactions(from: Date, to: Date): Promise<PaynovateTx[]> {
  const customers = await listCustomers()
  const out: PaynovateTx[] = []
  for (const c of customers) out.push(...(await fetchTransactions(c.id, from, to)))
  return out
}

/**
 * L'identifiant de versement porté par le libellé bancaire Odoo
 * (« … Info personnelle: LOYALACQ2.PAYMENT 391958542 ») — c'est la clé de
 * jointure avec le portail. null si la ligne n'est pas un versement Paynovate.
 */
export function paymentIdFromLabel(label: string): number | null {
  const m = String(label || '').match(/PAYMENT\s+(\d{6,})/i)
  return m ? Number(m[1]) : null
}

/** Le TID du libellé bancaire → dit quel terminal a encaissé. */
export function tidFromLabel(label: string): string | null {
  return String(label || '').match(/\bTID\s+(\d+)/i)?.[1] ?? null
}

/** Commissions d'un mois (« 2026-07 »), regroupées par terminal. */
export function commissionsByMonth(txs: PaynovateTx[], month: string) {
  const per = new Map<number, { customerId: number; tid: string; count: number; htva: number; vat: number; tvac: number }>()
  for (const t of txs) {
    if (!t.accountingDate?.startsWith(month)) continue
    const e = per.get(t.customerId) ?? { customerId: t.customerId, tid: t.tid, count: 0, htva: 0, vat: 0, tvac: 0 }
    e.count += 1
    e.htva  += t.commissionHtva
    e.vat   += t.commissionVat
    e.tvac  += t.commissionTvac
    per.set(t.customerId, e)
  }
  return Array.from(per.values()).map(e => ({
    ...e,
    htva: Math.round(e.htva * 100) / 100,
    vat:  Math.round(e.vat  * 100) / 100,
    tvac: Math.round(e.tvac * 100) / 100,
  }))
}
