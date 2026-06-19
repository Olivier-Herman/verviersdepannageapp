// src/lib/kaze/web-session.ts
//
// Acceptation des PROPOSITIONS Kaze via l'appli web (session + CSRF).
//
// Pourquoi pas l'API à clé : testé le 2026-06-19, l'acceptation d'une
// proposition n'existe pas via l'API (/job_proposals/{id} → 404,
// /jobs/{id}/proposals → 403 feature_not_enabled). C'est une action web only
// (même l'app smartphone ne voit pas les missions à accepter).
//
// Flux (capturé F12) :
//   1. GET  /users/sign_in            → cookie _kaze_session + meta csrf-token
//   2. POST /users/sign_in            → user[login] + user[password] + token
//                                        → 302 + remember_user_token (auth OK)
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
  // 1) GET sign_in → cookie de session + token CSRF (meta)
  const g = await fetch(`${BASE}/users/sign_in`, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    signal: AbortSignal.timeout(20000),
  })
  mergeCookies(jar, parseSetCookie(g.headers.get('set-cookie')))
  const html = await g.text()
  const csrf = (html.match(/<meta name="csrf-token" content="([^"]+)"/i) || [])[1]
  if (!csrf) throw new Error('Token CSRF login introuvable')

  // 2) POST sign_in
  const body = new URLSearchParams({
    authenticity_token: csrf,
    'user[login]':      email,
    'user[password]':   pwd,
    'user[remember_me]': '1',
  })
  const p = await fetch(`${BASE}/users/sign_in`, {
    method: 'POST', redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA, accept: 'text/html',
      cookie: cookieHeader(jar), 'x-csrf-token': csrf,
      origin: BASE, referer: `${BASE}/users/sign_in`,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(20000),
  })
  mergeCookies(jar, parseSetCookie(p.headers.get('set-cookie')))
  // 302 = succès ; 200 = formulaire re-affiché (identifiants refusés)
  if (p.status !== 302 || !jar['remember_user_token']) {
    throw new Error(`Login Kaze échoué (HTTP ${p.status})`)
  }
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
