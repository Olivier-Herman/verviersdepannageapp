// src/lib/kaze/web-session.ts
//
// Acceptation des PROPOSITIONS Kaze via l'appli web (session + CSRF).
//
// Pourquoi pas l'API à clé : testé le 2026-06-19 ET revérifié le 07/09/2026 :
// l'acceptation d'une proposition n'existe pas via l'API (/jobs/{id}/proposals
// → 403 feature_not_enabled, PUT accept_proposals → 422). Le passage « API
// seule » du 31/08 a fait échouer les 12 acceptations suivantes, toutes
// acceptées à la main par Olivier. C'est une action web only.
//
// Flux (capturé F12, refait le 07/09/2026 après le nouvel écran de login) :
//   1. POST /api/v2/graphql mutation Login (X-Web-Client) → JWT + cookies
//      `refresh` + `_kaze_session`
//   2. GET  /landing?return_to=/app   → authentifie la session Rails « legacy »
//   3. GET  /job_proposals/{id}/accept/edit.turbo_stream?form=accept
//                                        → formulaire + authenticity_token frais
//   4. POST /job_proposals/{id}/accept → _method=put + token + estimation + durée
//                                        → 302 (accepté)
//
// Identifiants : KAZE_WEB_EMAIL / KAZE_WEB_PASSWORD (secrets env).

const BASE = 'https://app.kaze.so'
const UA   = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

type Jar = Record<string, string>

function parseSetCookie(header: string | null): string[] {
  // Sépare sur les virgules qui précèdent un "nom=" (les dates d'expiration
  // contiennent aussi des virgules). On ne garde que la paire nom=valeur.
  return (header || '')
    .split(/,(?=[^;=]+=)/)
    .map(c => c.split(';')[0].trim())
    .filter(c => c.includes('=') && !/^(expires|path|domain|max-age|samesite)=/i.test(c))
}
function mergeCookies(jar: Jar, arr: string[]): Jar {
  for (const c of arr) { const i = c.indexOf('='); jar[c.slice(0, i)] = c.slice(i + 1) }
  return jar
}
function cookieHeader(jar: Jar): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
}

/**
 * Se connecte à l'appli web Kaze et renvoie le jar de cookies authentifié.
 * Throw si les identifiants manquent ou si le login échoue.
 */
export async function loginKazeWeb(): Promise<Jar> {
  const email = process.env.KAZE_WEB_EMAIL
  const pwd   = process.env.KAZE_WEB_PASSWORD
  if (!email || !pwd) throw new Error('KAZE_WEB_EMAIL / KAZE_WEB_PASSWORD non configurés')
  const jar: Jar = {}
  const absorb = (r: Response) => {
    const list: string[] = typeof (r.headers as any).getSetCookie === 'function'
      ? (r.headers as any).getSetCookie().map((c: string) => c.split(';')[0].trim())
      : parseSetCookie(r.headers.get('set-cookie'))
    mergeCookies(jar, list.filter(c => c.includes('=')))
  }

  // 1) Login GraphQL, comme le navigateur (X-Web-Client → Kaze pose aussi les
  //    cookies `refresh` + `_kaze_session` en plus du JWT).
  const login = await fetch(`${BASE}/api/v2/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json',
      'user-agent': UA, origin: BASE, referer: `${BASE}/app/login`, 'X-Web-Client': 'true',
    },
    body: JSON.stringify({
      operationName: 'Login',
      query: 'mutation Login($input: LoginInput!) { login(input: $input) { accessToken refreshToken viewer { id email } } }',
      variables: { input: { login: email, password: pwd } },
    }),
    signal: AbortSignal.timeout(20000),
  })
  absorb(login)
  const j: any = await login.json().catch(() => null)
  const token: string | undefined = j?.data?.login?.accessToken
  if (!token) {
    const msg = j?.errors?.[0]?.message || j?.data?.login === null ? 'identifiants refusés' : `HTTP ${login.status}`
    throw new Error(`Login Kaze échoué (${msg})`)
  }

  // 2) Passerelle /landing : c'est elle qui authentifie la session Rails des
  //    pages « legacy » (dont l'acceptation des propositions).
  let url = `${BASE}/landing?return_to=%2Fapp`
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(url, {
      headers: { cookie: cookieHeader(jar), 'user-agent': UA, accept: 'text/html', authorization: `Bearer ${token}` },
      redirect: 'manual', signal: AbortSignal.timeout(20000),
    })
    absorb(r)
    const loc = r.headers.get('location')
    if (!loc) break
    url = loc.startsWith('http') ? loc : `${BASE}${loc}`
    if (/\/app\/login/.test(loc)) throw new Error('Passerelle /landing refusée (redirigé vers le login)')
  }

  // 3) Preuve : une page legacy répond 200 (et non 302 → login).
  const probe = await fetch(`${BASE}/jobs`, {
    headers: { cookie: cookieHeader(jar), 'user-agent': UA, accept: 'text/html' },
    redirect: 'manual', signal: AbortSignal.timeout(20000),
  })
  if (probe.status !== 200) throw new Error(`Session web Kaze non reconnue par les pages legacy (HTTP ${probe.status})`)
  return jar
}

export interface AcceptOptions {
  estimationMinutes?: number   // défaut 60
  days?:    number             // défaut 0
  hours?:   number             // défaut 1
  minutes?: number             // défaut 0
  note?:    string             // proposal[response_description]
}

/**
 * Accepte une proposition Kaze (par son proposal_id) via l'appli web.
 * Non bloquant côté appelant recommandé (peut prendre ~2-5s : login + 2 requêtes).
 */
export async function acceptKazeProposal(
  proposalId: string,
  opts: AcceptOptions = {},
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!proposalId) return { ok: false, status: 0, error: 'proposal_id manquant' }
  let jar: Jar
  try { jar = await loginKazeWeb() }
  catch (e: any) { return { ok: false, status: 0, error: e?.message || 'login KO' } }

  // 3) GET le formulaire d'acceptation → authenticity_token frais (lié à la session)
  const fr = await fetch(`${BASE}/job_proposals/${proposalId}/accept/edit.turbo_stream?form=accept`, {
    headers: { 'user-agent': UA, cookie: cookieHeader(jar), accept: 'text/vnd.turbo-stream.html, text/html' },
    redirect: 'manual', signal: AbortSignal.timeout(20000),
  })
  const formHtml = await fr.text()
  // Proposition déjà acceptée/expirée → Kaze renvoie un flash d'erreur (pas le form)
  if (/data-level="error"|Proposition est dans un|n'est plus disponible/i.test(formHtml)) {
    return { ok: false, status: fr.status, error: 'Proposition pas/plus en attente (déjà acceptée ou expirée)' }
  }
  const token = (formHtml.match(/name="authenticity_token"[^>]*value="([^"]+)"/i) || [])[1]
  if (!token) return { ok: false, status: fr.status, error: 'Token CSRF du formulaire introuvable' }

  // 4) POST accept
  const body = new URLSearchParams()
  body.set('_method', 'put')
  body.set('authenticity_token', token)
  body.set('proposal[response_description]', opts.note || '')
  body.set('proposal[estimation]', String(opts.estimationMinutes ?? 60))
  body.set('duration[days]',    String(opts.days    ?? 0))
  body.set('duration[hours]',   String(opts.hours   ?? 1))
  body.set('duration[minutes]', String(opts.minutes ?? 0))

  const r = await fetch(`${BASE}/job_proposals/${proposalId}/accept`, {
    method: 'POST', redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA, accept: 'text/vnd.turbo-stream.html, text/html',
      cookie: cookieHeader(jar), 'x-csrf-token': token,
      origin: BASE, referer: `${BASE}/job_proposals/${proposalId}/job`,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(20000),
  })
  // 302 → /jobs/{id} = succès ; 200 turbo-stream peut aussi être renvoyé
  const ok = r.status === 302 || r.status === 200
  if (!ok) return { ok: false, status: r.status, error: `POST accept HTTP ${r.status}` }
  return { ok: true, status: r.status }
}
