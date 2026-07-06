// src/lib/touring/comex.ts
//
// Client de la plateforme Touring COMEX (apps.touring.be/Comex).
// Touring n'a pas d'API officielle → on pilote leur backend REST interne
// (reverse-engineeré 2026-07-06). Avantage vs email : données STRUCTURÉES en
// JSON → zéro appel Claude pour le parsing Touring (économie IA). L'email reste
// en roue de secours (dédoublonnage par CID_DOS / plaque).
//
// Flux d'authentification (Java/Spring Security + Dojo) :
//   1. GET  /Comex/web/welcome.do              → pose JSESSIONID
//   2. POST /Comex/rest/auth/encryptPwd        → {content: passSHA (SHA-256)}
//   3. POST /Comex/web/secured/canIlog         → PRÉ-appel obligatoire (amorce le
//                                                "saved request" Spring)
//   4. POST /Comex/web/j_security_check        → 303, session authentifiée
//   5. (verif) POST /Comex/web/secured/canIlog → "logged"
// Puis appels REST avec header Authorization: Basic base64(LOGIN:passSHA).
//
// Cf mémoire project_touring_comex_integration.

const COMEX_BASE = 'https://apps.touring.be/Comex'
const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export type ComexAccount = 'dispatch' | 'user'

export interface ComexSession {
  cookieHeader: string
  authToken:    string   // "Basic base64(LOGIN:passSHA)"
  login:        string   // login en MAJUSCULES
}

// ── Cookie jar minimal (Node fetch n'en a pas) ────────────────────────────────
class CookieJar {
  private jar = new Map<string, string>()
  addFromResponse(res: Response): void {
    const setCookies = res.headers.getSetCookie?.() || []
    if (setCookies.length === 0) {
      const single = res.headers.get('set-cookie')
      if (single) setCookies.push(single)
    }
    for (const c of setCookies) {
      const first = c.split(';')[0]?.trim()
      if (!first) continue
      const eq = first.indexOf('=')
      if (eq < 0) continue
      const name = first.slice(0, eq).trim()
      const value = first.slice(eq + 1).trim()
      if (!value || value === '""') this.jar.delete(name)
      else this.jar.set(name, value)
    }
  }
  toHeader(): string {
    return Array.from(this.jar.entries()).map(([n, v]) => `${n}=${v}`).join('; ')
  }
  size(): number { return this.jar.size }
}

function credsFor(account: ComexAccount): { user: string; pass: string } {
  const user = account === 'user' ? process.env.TOURING_WEB_USER : process.env.TOURING_WEB_DISPATCH
  const pass = account === 'user' ? process.env.TOURING_WEB_USER_PASS : process.env.TOURING_WEB_DISPATCH_PASS
  if (!user || !pass) {
    throw new Error(`[comex] identifiants manquants pour le compte '${account}' (TOURING_WEB_${account === 'user' ? 'USER' : 'DISPATCH'}[_PASS])`)
  }
  return { user, pass }
}

/**
 * Login COMEX. Retourne la session (cookies + token Basic) à passer aux appels REST.
 * account='dispatch' (défaut) = compte qui accepte/assigne.
 */
export async function loginComex(account: ComexAccount = 'dispatch'): Promise<ComexSession> {
  const { user, pass } = credsFor(account)
  const login = user.toUpperCase()   // COMEX met le login en MAJUSCULES
  const jar = new CookieJar()

  // 1) welcome.do → JSESSIONID
  const welcome = await fetch(`${COMEX_BASE}/web/welcome.do`, {
    headers: { 'User-Agent': REAL_UA }, redirect: 'manual',
  })
  jar.addFromResponse(welcome)

  // 2) encryptPwd → passSHA (SHA-256 hex)
  const encRes = await fetch(`${COMEX_BASE}/rest/auth/encryptPwd`, {
    method: 'POST',
    headers: {
      'User-Agent': REAL_UA, 'Content-Type': 'application/json',
      'Accept': 'application/json', 'Content-Language': 'fr', 'Cookie': jar.toHeader(),
    },
    body: JSON.stringify({ loginUser: login, loginPassword: pass }),
    redirect: 'manual',
  })
  jar.addFromResponse(encRes)
  const encJson: any = await encRes.json().catch(() => ({}))
  const passSHA: string = encJson?.content || ''
  if (!passSHA) throw new Error(`[comex] encryptPwd sans content (success=${encJson?.success}) — identifiants invalides ?`)

  // 3) PRÉ-canIlog OBLIGATOIRE : ce POST sur la ressource sécurisée amorce le
  // "saved request" Spring — sans lui, le j_security_check qui suit n'authentifie
  // PAS la session (testé : "not logged" sans, "logged" avec). Réponse attendue
  // ici : "not loggedj_security_check".
  const pre = await fetch(`${COMEX_BASE}/web/secured/canIlog`, {
    method: 'POST',
    headers: {
      'User-Agent': REAL_UA, 'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': jar.toHeader(),
    },
    body: new URLSearchParams({ j_username: login, j_password: passSHA }).toString(),
    redirect: 'manual',
  })
  jar.addFromResponse(pre)

  // 4) j_security_check (form login Spring) → 303 + rotation session
  const form = new URLSearchParams({ j_username: login, j_password: passSHA })
  const auth = await fetch(`${COMEX_BASE}/web/j_security_check`, {
    method: 'POST',
    headers: {
      'User-Agent': REAL_UA, 'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': jar.toHeader(),
    },
    body: form.toString(),
    redirect: 'manual',
  })
  jar.addFromResponse(auth)

  // 5) vérif : canIlog doit renvoyer "logged"
  const check = await fetch(`${COMEX_BASE}/web/secured/canIlog`, {
    method: 'POST',
    headers: {
      'User-Agent': REAL_UA, 'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': jar.toHeader(),
    },
    body: new URLSearchParams({ j_username: login, j_password: passSHA }).toString(),
    redirect: 'manual',
  })
  jar.addFromResponse(check)
  const checkTxt = (await check.text().catch(() => '')).trim()
  if (checkTxt !== 'logged') {
    throw new Error(`[comex] login non confirmé (canIlog="${checkTxt.slice(0, 40)}")`)
  }

  const authToken = 'Basic ' + Buffer.from(`${login}:${passSHA}`).toString('base64')
  return { cookieHeader: jar.toHeader(), authToken, login }
}

/**
 * Appel REST authentifié. Gère le décodage ISO-8859-1 (COMEX renvoie parfois
 * charset=iso-8859-1) pour ne pas casser les accents (é, è…).
 */
async function comexRest<T = any>(session: ComexSession, path: string, body: any = {}): Promise<T> {
  const res = await fetch(`${COMEX_BASE}/rest/${path}`, {
    method: 'POST',
    headers: {
      'User-Agent': REAL_UA, 'Content-Type': 'application/json',
      'Accept': 'application/json', 'Content-Language': 'fr',
      'Authorization': session.authToken, 'Cookie': session.cookieHeader,
    },
    body: JSON.stringify(body ?? {}),
    redirect: 'manual',
  })
  const ct = res.headers.get('content-type') || ''
  const buf = Buffer.from(await res.arrayBuffer())
  const text = /iso-8859-1|latin-?1/i.test(ct)
    ? new TextDecoder('iso-8859-1').decode(buf)
    : buf.toString('utf-8')
  let json: any
  try { json = JSON.parse(text) } catch { throw new Error(`[comex] réponse REST non-JSON sur ${path}: ${text.slice(0, 120)}`) }
  if (json && json.success === false) {
    throw new Error(`[comex] REST ${path} échec: ${json.message || 'inconnu'}`)
  }
  return json as T
}

// ── Types mission (champs de rest/Mission/list) ───────────────────────────────
export interface ComexMission {
  CID_DOS:          string   // n° dossier (ex "2026BE268515")
  CID_SEQ_ACTION:   string   // séquence action
  COD_STATUT_MTR:   string   // statut moteur (ex "04")
  NICKNAME:         string   // compte dispatch (D68267)
  LIB_GAR:          string   // type (Remorquage…)
  COD_ADRESSE:      string
  CP:               string   // prise en charge — code postal
  LOC:              string   // prise en charge — localité
  TO_COD_ADRESSE?:  string
  TO_CP?:           string   // destination — code postal
  TO_LOC?:          string   // destination — localité
  NUM_PLAQUE:       string
  LIB_MARQUE?:      string
  LIB_MODELE?:      string
  COD_CARBUR?:      string
  LIB_COD_CARBUR?:  string
  D_CREATION?:      string
  D_ASSIGN?:        string
  D_SEND?:          string
  IS_VIP?:          number
  FL_ZONE_SIABIS?:  number
  [k: string]:      any
}

/** Liste des missions COMEX (le "parsing" : JSON direct, pas de Claude). */
export async function listComexMissions(session: ComexSession): Promise<ComexMission[]> {
  const data = await comexRest<{ total: number; content: ComexMission[] }>(session, 'Mission/list', {})
  return Array.isArray(data?.content) ? data.content : []
}

/** Détail d'une mission (adresses complètes, contact, panne…). */
export async function getComexMissionDetail(
  session: ComexSession,
  keys: { CID_DOS: string; CID_SEQ_ACTION: string },
): Promise<any> {
  return comexRest(session, 'Mission/detail/get', keys)
}

// ── Actions (mutations) : changement de statut via detail/set + operType ──────
// Le payload = la mission ré-échoée (union des captures onRoad/onSpot du 06/07)
// + operType + operDate. On lit donc le détail puis on renvoie ces champs.
const SET_ECHO_FIELDS = [
  'COD_PANNE_CAUSE', 'COD_PANNE_RESULT', 'COD_PANNE_DESC', 'NUM_CHASSIS', 'D_MEC', 'MONT_KM',
  'COD_FIN_MISSION', 'BON_AFFILIATION', 'BON_AFFIL_MOP', 'BON_AFFIL_PRD', 'COMM_FIN_MISSION',
  'COD_NON_SAISIE_KM', 'FL_PLAINTE_CLIENT', 'LIB_PLAINTE_CLIENT',
  'TO_COD_ADRESSE', 'TO_NOM', 'TO_RUE', 'TO_NUM_RUE', 'TO_CP', 'TO_LOC', 'ADR_DEPOT_CID_INTV',
]

export type ComexOperType = 'onRoad' | 'onSpot'

/** Format COMEX pour operDate : "YYYY-MM-DDTHH:mm:ss.000" (heure locale, sans TZ). */
export function comexOperDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.000`
}

/**
 * Pousse un changement de statut Touring via rest/Mission/detail/set :
 *   operType 'onRoad' = en route (05) · 'onSpot' = sur place (06).
 * operDate peut être BACKDATÉ (respect des SLA). À appeler avec la session USER
 * (compte patrouille D6826701), pas la session dispatch.
 */
export async function pushComexOperation(
  session: ComexSession,
  keys: { CID_DOS: string; CID_SEQ_ACTION: string },
  operType: ComexOperType,
  operDate: string,
): Promise<any> {
  const dRes = await getComexMissionDetail(session, keys)
  const d = (dRes?.content || dRes || {}) as Record<string, any>
  const payload: Record<string, any> = { CID_DOS: keys.CID_DOS, CID_SEQ_ACTION: keys.CID_SEQ_ACTION, operType, operDate }
  for (const f of SET_ECHO_FIELDS) {
    const v = d[f]
    payload[f] = (v === undefined || v === null)
      ? (f === 'FL_PLAINTE_CLIENT' ? '0' : (f === 'MONT_KM' ? 0 : ''))
      : v
  }
  return comexRest(session, 'Mission/detail/set', payload)
}
