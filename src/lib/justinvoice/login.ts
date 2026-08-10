// src/lib/justinvoice/login.ts
//
// Auto-login JustInvoice (SPF Justice) — Azure AD B2C + OTP e-mail, HTTP PUR (pas
// de navigateur). Reproduit le flux reverse-engineeré (cf [[project_justinvoice_spf_justice]]).
// Renvoie un client authentifié (cookie-jar par host) pour appeler le portail.
// Chaque login consomme un OTP envoyé à info@verviersdepannage.be. Olivier 2026-08-09.

import { readJustInvoiceOtp } from './otp'

const PORTAL = 'https://justinvoice.just.fgov.be'
const EMAIL  = process.env.JUSTINGOV_EMAIL || 'info@verviersdepannage.be'
const PASS   = process.env.JUSTINGOV_PASSWORD || ''

// ── Cookie-jar par host ──────────────────────────────────────────────────────
type Jar = Map<string, Map<string, string>>
const hostOf = (url: string) => new URL(url).host
function storeCookies(jar: Jar, url: string, res: Response) {
  const list: string[] = (res.headers as any).getSetCookie?.() || []
  if (!list.length) { const one = res.headers.get('set-cookie'); if (one) list.push(one) }
  if (!list.length) return
  const host = hostOf(url)
  if (!jar.has(host)) jar.set(host, new Map())
  const m = jar.get(host)!
  for (const sc of list) {
    const first = sc.split(';')[0]; const i = first.indexOf('=')
    if (i > 0) m.set(first.slice(0, i).trim(), first.slice(i + 1).trim())
  }
}
function cookieHeader(jar: Jar, url: string): string {
  const m = jar.get(hostOf(url))
  return m ? [...m.entries()].map(([k, v]) => `${k}=${v}`).join('; ') : ''
}

export interface JustInvoiceSession {
  jar: Jar
  fetch: (path: string, init?: RequestInit) => Promise<Response>
}

// fetch qui joint/mémorise les cookies du bon host + suit les redirections manuellement.
function makeFetch(jar: Jar) {
  return async function jfetch(url: string, init: RequestInit = {}, maxRedirect = 8): Promise<Response> {
    let cur = url
    let res: Response
    for (let hop = 0; ; hop++) {
      const headers = new Headers(init.headers || {})
      const ck = cookieHeader(jar, cur)
      if (ck) headers.set('cookie', ck)
      if (!headers.has('user-agent')) headers.set('user-agent', 'Mozilla/5.0 VDSoft')
      res = await fetch(cur, { ...init, headers, redirect: 'manual' })
      storeCookies(jar, cur, res)
      const loc = res.headers.get('location')
      if (hop < maxRedirect && res.status >= 300 && res.status < 400 && loc) {
        cur = new URL(loc, cur).toString()
        init = { method: 'GET', body: undefined }  // les redirections repassent en GET
        continue
      }
      return res
    }
  }
}

// Extrait les infos du bloc `var SETTINGS = {...}` de la page B2C.
function parseSettings(html: string) {
  const g = (re: RegExp) => (html.match(re)?.[1] ?? '')
  return {
    csrf:    g(/"csrf":"([^"]+)"/),
    transId: g(/"transId":"([^"]+)"/),
    tenant:  g(/"tenant":"([^"]+)"/),   // ex: /{tenantId}/b2c_1_.../
    policy:  g(/"policy":"([^"]+)"/),
    apiHost: g(/"host":"([^"]+)"/) || g(/https:\/\/([^\/"]+\.b2clogin\.com)/),
  }
}

const withSlash = (t: string) => (t.endsWith('/') ? t : t + '/')
function selfAssertedUrl(b2cHost: string, tenant: string, tx: string, policy: string) {
  return `https://${b2cHost}${withSlash(tenant)}SelfAsserted?tx=${encodeURIComponent(tx)}&p=${encodeURIComponent(policy)}`
}
const B2C_HEADERS = (csrf: string) => ({
  'X-CSRF-TOKEN': csrf,
  'X-Requested-With': 'XMLHttpRequest',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
})

/** Effectue le login complet. Throw avec un message clair si une étape échoue. */
export async function justInvoiceLogin(): Promise<JustInvoiceSession> {
  if (!PASS) throw new Error('JUSTINGOV_PASSWORD manquant')
  const jar: Jar = new Map()
  const jfetch = makeFetch(jar)

  // 1) GET signin → suit vers b2clogin/authorize → page de login (SETTINGS).
  const p1 = await jfetch(`${PORTAL}/signin?returnUrl=%2Fprofile%2F`)
  const html1 = await p1.text()
  const s1 = parseSettings(html1)
  const b2cHost = s1.apiHost || 'fodjjustinvoiceprd.b2clogin.com'
  if (process.env.JI_DEBUG) {
    console.error('[JI] p1 url=', p1.url, 'status=', p1.status, 'len=', html1.length, 'hasSETTINGS=', /var SETTINGS/.test(html1))
    console.error('[JI] s1=', JSON.stringify({ csrf: s1.csrf.slice(0, 12), transId: s1.transId.slice(0, 20), tenant: s1.tenant, policy: s1.policy, apiHost: s1.apiHost }))
    console.error('[JI] b2cHost=', b2cHost, 'cookies@b2c=', [...(jar.get(b2cHost)?.keys() || [])].join(','))
    console.error('[JI] selfAssertedUrl=', selfAssertedUrl(b2cHost, s1.tenant, s1.transId, s1.policy))
  }
  if (!s1.csrf || !s1.transId || !s1.tenant) throw new Error('Étape 1 : SETTINGS login introuvables (csrf/transId/tenant)')

  // 2) POST identifiants (⚠️ champ `email`, pas `signInName`).
  const r2 = await jfetch(selfAssertedUrl(b2cHost, s1.tenant, s1.transId, s1.policy), {
    method: 'POST', headers: B2C_HEADERS(s1.csrf),
    body: `request_type=RESPONSE&email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASS)}`,
  })
  const raw2 = await r2.text()
  let j2: any = {}; try { j2 = JSON.parse(raw2) } catch {}
  if (process.env.JI_DEBUG) console.error('[JI] r2 status=', r2.status, 'ct=', r2.headers.get('content-type'), 'body=', raw2.slice(0, 300))
  if (String(j2.status) !== '200') throw new Error(`Étape 2 : login refusé (${raw2.slice(0, 200)})`)

  // 3) GET confirmed → page OTP (nouveaux csrf/transId).
  const r3 = await jfetch(`https://${b2cHost}${withSlash(s1.tenant)}api/CombinedSigninAndSignup/confirmed` +
    `?rememberMe=false&csrf_token=${encodeURIComponent(s1.csrf)}&tx=${encodeURIComponent(s1.transId)}&p=${encodeURIComponent(s1.policy)}`)
  const html3 = await r3.text()
  const s3 = parseSettings(html3)
  const csrfOtp = s3.csrf || s1.csrf
  const tx = s3.transId || s1.transId
  const tenant = s3.tenant || s1.tenant
  const policy = s3.policy || s1.policy

  // 4a) Demande d'envoi du code.
  const since = new Date().toISOString()
  const rSend = await jfetch(selfAssertedUrl(b2cHost, tenant, tx, policy), {
    method: 'POST', headers: B2C_HEADERS(csrfOtp),
    body: `request_type=VERIFICATION_REQUEST&claim_id=ReadOnlyEmail&claim_value=${encodeURIComponent(EMAIL)}`,
  })
  const jSend = await rSend.json().catch(() => ({} as any))
  if (String(jSend.status) !== '200') throw new Error(`Étape 4a : envoi OTP refusé (${JSON.stringify(jSend).slice(0, 160)})`)

  // 4b) Lecture du code dans info@ (Graph).
  const code = await readJustInvoiceOtp(since)
  if (!code) throw new Error('Étape 4b : code OTP introuvable dans info@ (réessayer)')

  // 4c) Validation du code.
  const rVal = await jfetch(selfAssertedUrl(b2cHost, tenant, tx, policy), {
    method: 'POST', headers: B2C_HEADERS(csrfOtp),
    body: `request_type=VALIDATION_REQUEST&claim_id=ReadOnlyEmail&claim_value=${encodeURIComponent(EMAIL)}&user_input=${code}`,
  })
  const jVal = await rVal.json().catch(() => ({} as any))
  if (String(jVal.status) !== '200') throw new Error(`Étape 4c : code OTP invalide (${JSON.stringify(jVal).slice(0, 160)})`)

  // 4d) Soumission finale du formulaire OTP.
  const rSub = await jfetch(selfAssertedUrl(b2cHost, tenant, tx, policy), {
    method: 'POST', headers: B2C_HEADERS(csrfOtp),
    body: `ReadOnlyEmail=${encodeURIComponent(EMAIL)}&ReadOnlyEmail_ver_input=${code}&request_type=RESPONSE`,
  })
  const jSub = await rSub.json().catch(() => ({} as any))
  if (String(jSub.status) !== '200') throw new Error(`Étape 4d : soumission OTP refusée (${JSON.stringify(jSub).slice(0, 160)})`)

  // 5) GET confirmed OTP → form auto (quotes simples) → POST vers le portail.
  const rConf = await jfetch(`https://${b2cHost}${withSlash(tenant)}api/SelfAsserted/confirmed` +
    `?csrf_token=${encodeURIComponent(csrfOtp)}&tx=${encodeURIComponent(tx)}&p=${encodeURIComponent(policy)}`)
  const htmlConf = await rConf.text()
  const action = htmlConf.match(/action='([^']+)'/)?.[1] || htmlConf.match(/action="([^"]+)"/)?.[1] || `${PORTAL}/signin-aad-b2c_1`
  const field = (name: string) => {
    const re = new RegExp(`name='${name}'[^>]*value='([^']*)'`) // quotes simples
    const re2 = new RegExp(`name="${name}"[^>]*value="([^"]*)"`)
    return htmlConf.match(re)?.[1] ?? htmlConf.match(re2)?.[1] ?? ''
  }
  const state = field('state'), idToken = field('id_token'), codeF = field('code')
  if (!idToken && !codeF) throw new Error('Étape 5 : form de retour B2C introuvable (state/code/id_token)')
  const body = new URLSearchParams()
  if (state) body.set('state', state)
  if (codeF) body.set('code', codeF)
  if (idToken) body.set('id_token', idToken)

  const rBack = await jfetch(action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  // Suit jusqu'au portail ; le cookie .AspNet.ApplicationCookie doit être posé.
  await rBack.text().catch(() => '')
  const portalCookies = jar.get(hostOf(PORTAL))
  const connected = portalCookies && [...portalCookies.keys()].some(k => /AspNet\.ApplicationCookie/i.test(k))
  if (!connected) throw new Error('Étape 5 : session portail non établie (.AspNet.ApplicationCookie absent)')

  return { jar, fetch: jfetch }
}
