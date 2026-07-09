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

/**
 * Adresses de la mission (GET rest/adresse/get?cidDos=..&cidSeqAction=..).
 * Contient l'ID d'adresse dépôt (ADR_DEPOT_CID_INTV) requis par l'accept, absent
 * du detail/get. Appelé quand on ouvre une mission dans l'UI COMEX.
 */
export async function getComexAddresses(
  session: ComexSession,
  keys: { CID_DOS: string; CID_SEQ_ACTION: string },
): Promise<any> {
  const url = `${COMEX_BASE}/rest/adresse/get?cidDos=${encodeURIComponent(keys.CID_DOS)}&cidSeqAction=${encodeURIComponent(keys.CID_SEQ_ACTION)}`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': REAL_UA, 'Accept': 'application/json', 'Content-Language': 'fr',
      'Authorization': session.authToken, 'Cookie': session.cookieHeader,
      'X-Requested-With': 'XMLHttpRequest',
    },
    redirect: 'manual',
  })
  const ct = res.headers.get('content-type') || ''
  const buf = Buffer.from(await res.arrayBuffer())
  const text = /iso-8859-1|latin-?1/i.test(ct) ? new TextDecoder('iso-8859-1').decode(buf) : buf.toString('utf-8')
  try { return JSON.parse(text) } catch { return { _raw: text.slice(0, 500) } }
}

/** Dépôt COMEX par défaut = VERVIERS DÉPANNAGE principal (Rue de la Cité 22a). */
export const DEFAULT_DEPOT_CID = '001072478'

/**
 * Liste des dépôts candidats (CID_INTV) pour l'accept COMEX, ORDONNÉS par
 * pertinence GÉOGRAPHIQUE : COMEX exige le dépôt du SECTEUR de l'intervention
 * (ex Aywaille → dépôt Aywaille, pas Verviers). On classe : même localité que
 * l'intervention d'abord, puis même zone CP, puis dépôt principal, puis le reste.
 * Nos dépôts = entrées COD_ADRESSE='DEP' de adresse/get, id = CID_INTV.
 */
export async function getComexDepotCandidates(
  session: ComexSession,
  keys: { CID_DOS: string; CID_SEQ_ACTION: string },
): Promise<string[]> {
  try {
    const data = await getComexAddresses(session, keys)
    const list: any[] = Array.isArray(data?.content) ? data.content : (Array.isArray(data) ? data : [])
    const deps = list.filter(a => String(a?.COD_ADRESSE || '').toUpperCase() === 'DEP' && String(a?.CID_INTV || '').trim())
    // Adresse d'intervention (ROA / FL_ADR_SIN=1) pour le matching secteur.
    const interv = list.find(a => String(a?.COD_ADRESSE || '').toUpperCase() === 'ROA' || String(a?.FL_ADR_SIN) === '1') || {}
    const iLoc = String((interv as any).LOC || '').toUpperCase().trim()
    const iCp  = String((interv as any).CP || '').trim()
    const score = (a: any): number => {
      const loc = String(a?.LOC || '').toUpperCase().trim()
      const cp  = String(a?.CP || '').trim()
      if (iLoc && loc === iLoc) return 0                                   // même localité
      if (iCp && cp && cp.slice(0, 2) === iCp.slice(0, 2)) return 1        // même zone CP
      if (String(a?.CID_INTV).trim() === DEFAULT_DEPOT_CID) return 2       // principal
      return 3
    }
    const cids = [...deps].sort((a, b) => score(a) - score(b)).map(a => String(a.CID_INTV).trim()).filter(Boolean)
    if (!cids.includes(DEFAULT_DEPOT_CID)) cids.push(DEFAULT_DEPOT_CID)
    return cids.length ? cids : [DEFAULT_DEPOT_CID]
  } catch { return [DEFAULT_DEPOT_CID] }
}

/** Meilleur dépôt (1er candidat géo). Utilisé par onRoad/onSpot (pas de retry). */
export async function resolveComexDepotCid(
  session: ComexSession,
  keys: { CID_DOS: string; CID_SEQ_ACTION: string },
): Promise<string> {
  const cands = await getComexDepotCandidates(session, keys)
  return cands[0] || DEFAULT_DEPOT_CID
}

/**
 * true si la mission est sur AUTOROUTE / zone Siabis : l'adresse sinistre est
 * la route (COD_ADRESSE='HIG' ou FL_ADR_SIN=1), sans CID_INTV. Pour ces missions
 * COMEX refuse l'accept avec un de nos dépôts (03→03 sur tous les dépôts, cas
 * mission 10054129) → on tente SANS dépôt. Olivier 2026-07-09.
 */
export async function isComexHighwayMission(
  session: ComexSession,
  keys: { CID_DOS: string; CID_SEQ_ACTION: string },
): Promise<boolean> {
  try {
    const data = await getComexAddresses(session, keys)
    const list: any[] = Array.isArray(data?.content) ? data.content : (Array.isArray(data) ? data : [])
    return list.some(a => String(a?.COD_ADRESSE || '').toUpperCase() === 'HIG' || String(a?.FL_ADR_SIN) === '1')
  } catch { return false }
}

/**
 * Pour une mission AUTOROUTE : l'intervenant lié `MEM_CID_INTV` du détail COMEX
 * (ex "AA0005653210", format ≠ nos garages numériques) = ce que COMEX attend dans
 * `ADR_DEPOT_CID_INTV` pour ces missions. '' si absent. Olivier 2026-07-09.
 */
export async function resolveComexHighwayDepot(
  session: ComexSession,
  keys: { CID_DOS: string; CID_SEQ_ACTION: string },
): Promise<string> {
  try {
    const dRes: any = await getComexMissionDetail(session, keys)
    const dd = (dRes?.content || dRes || {}) as Record<string, any>
    return String(dd?.MEM_CID_INTV || '').trim()
  } catch { return '' }
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

export type ComexOperType = 'accept' | 'onRoad' | 'onSpot'

/** Format COMEX pour operDate : "YYYY-MM-DDTHH:mm:ss.000" en **heure locale belge**
 * (Europe/Brussels). CRITIQUE : le serveur Vercel tourne en UTC → getHours()
 * donnerait l'heure UTC (2h de retard l'été) → SLA COMEX faussé. On formate donc
 * explicitement dans le fuseau Europe/Brussels. Olivier 2026-07-08. */
export function comexOperDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value || '00'
  let hh = get('hour')
  if (hh === '24') hh = '00'   // certains runtimes renvoient 24 à minuit
  return `${get('year')}-${get('month')}-${get('day')}T${hh}:${get('minute')}:${get('second')}.000`
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
  depotCid?: string,
  opts?: { noDepot?: boolean },
): Promise<{ response: any; sentDepotCid: string; payload: Record<string, any> }> {
  const dRes = await getComexMissionDetail(session, keys)
  const d = (dRes?.content || dRes || {}) as Record<string, any>
  const payload: Record<string, any> = { CID_DOS: keys.CID_DOS, CID_SEQ_ACTION: keys.CID_SEQ_ACTION, operType, operDate }
  for (const f of SET_ECHO_FIELDS) {
    const v = d[f]
    payload[f] = (v === undefined || v === null)
      ? (f === 'FL_PLAINTE_CLIENT' ? '0' : (f === 'MONT_KM' ? 0 : ''))
      : v
  }
  // ADR_DEPOT_CID_INTV : ABSENT du detail/get mais REQUIS (non vide) pour que
  // COMEX bascule réellement le statut (accept/onRoad/onSpot). On le résout depuis
  // adresse/get (id du dépôt intervenant). Sans lui, COMEX répond OK mais ne fait
  // rien. Cause racine identifiée 2026-07-07.
  // noDepot : essai explicite SANS dépôt (missions Siabis/autoroute — hypothèse
  // Olivier 2026-07-09 : COMEX n'attend pas un de nos dépôts pour ces missions).
  if (opts?.noDepot) {
    payload.ADR_DEPOT_CID_INTV = ''
  } else if (!String(payload.ADR_DEPOT_CID_INTV || '').trim()) {
    payload.ADR_DEPOT_CID_INTV = depotCid || await resolveComexDepotCid(session, keys)
  }
  const response = await comexRest(session, 'Mission/detail/set', payload)
  return { response, sentDepotCid: String(payload.ADR_DEPOT_CID_INTV || ''), payload }
}

/** Règle le délai (ETA « sur place ») en minutes : POST setEta { TPS_ONSPOT_EXT }. */
export async function setComexEta(
  session: ComexSession,
  keys: { CID_DOS: string; CID_SEQ_ACTION: string },
  minutes: number,
): Promise<any> {
  return comexRest(session, 'Mission/detail/setEta', { ...keys, TPS_ONSPOT_EXT: minutes })
}

/** Assigne le camion (patrouille) : POST assignComex { REF_PATROL }. « 001 » = Verviers DE-001. */
export async function assignComexPatrol(
  session: ComexSession,
  keys: { CID_DOS: string; CID_SEQ_ACTION: string },
  refPatrol: string,
): Promise<any> {
  return comexRest(session, 'Mission/detail/assignComex', { ...keys, REF_PATROL: refPatrol })
}

/** Code REF_PATROL du camion COMEX à assigner par défaut (Verviers DE-001). */
export const DEFAULT_REF_PATROL = '001'

/**
 * Workflow d'acceptation Touring (session DISPATCH D68267), dans l'ordre capturé :
 *   1. accept  (detail/set operType=accept)  → 03→04
 *   2. setEta  (TPS_ONSPOT_EXT = etaMinutes)  → délai
 *   3. assign  (assignComex REF_PATROL)       → Verviers DE-001
 * Best-effort : on log chaque étape, on ne throw pas au milieu.
 */
export async function acceptTouringMission(
  keys: { CID_DOS: string; CID_SEQ_ACTION: string },
  opts?: { etaMinutes?: number; refPatrol?: string; acceptedAt?: Date },
): Promise<{ ok: boolean; steps: Record<string, boolean>; error?: string; statusBefore?: string | null; statusAfter?: string | null; sentDepotCid?: string; acceptResp?: any; alreadyAccepted?: boolean }> {
  const steps: Record<string, boolean> = { accept: false, eta: false, assign: false }
  // Preuve indépendante : on relit le statut COMEX AVANT et APRÈS notre appel.
  // Si accept 03→04 : c'est bien NOTRE appel. Si 03→03 : notre appel n'a rien fait.
  const readStatus = async (session: ComexSession): Promise<string | null> => {
    try {
      const list = await listComexMissions(session)
      const m = list.find(x => String(x.CID_DOS).toUpperCase() === keys.CID_DOS.toUpperCase()
        && (!keys.CID_SEQ_ACTION || String(x.CID_SEQ_ACTION) === keys.CID_SEQ_ACTION))
        || list.find(x => String(x.CID_DOS).toUpperCase() === keys.CID_DOS.toUpperCase())
      return m?.COD_STATUT_MTR ?? null
    } catch { return null }
  }
  let statusBefore: string | null = null
  let statusAfter:  string | null = null
  let sentDepotCid = ''
  let acceptResp: any = null
  const triedDepots: string[] = []
  try {
    const session = await loginComex('dispatch')
    statusBefore = await readStatus(session)

    // Déjà acceptée (04) ou plus avancée (05/06/07) → pas de ré-accept. Cas courant :
    // validée MANUELLEMENT dans COMEX (dispatch VD Soft tardif). PAS un échec. Le
    // pointage chauffeur (en route/sur place) continuera normalement via la fiche.
    // Si juste 04 (pas encore démarrée), on COMPLÈTE quand même délai + assign DE-001
    // (au cas où la validation manuelle ne l'aurait pas fait). Olivier 2026-07-08.
    if (statusBefore && statusBefore !== '03') {
      if (statusBefore === '04') {
        try { await setComexEta(session, keys, opts?.etaMinutes ?? 60); steps.eta = true } catch { /* best effort */ }
        try { await assignComexPatrol(session, keys, opts?.refPatrol ?? DEFAULT_REF_PATROL); steps.assign = true } catch { /* best effort */ }
      }
      return { ok: true, alreadyAccepted: true, steps, statusBefore, statusAfter: statusBefore, sentDepotCid: '' }
    }

    const operDate = comexOperDate(opts?.acceptedAt || new Date())

    // COMEX exige le dépôt du SECTEUR de l'intervention. On essaie les dépôts
    // candidats (ordonnés par géo) et on s'arrête dès que le statut bascule
    // (03 → 04). Un mauvais dépôt = accept no-op (statut inchangé). Olivier 2026-07-08.
    const candidates = await getComexDepotCandidates(session, keys)
    const highway = await isComexHighwayMission(session, keys)
    // Missions autoroute/Siabis : COMEX refuse nos garages (cas 10054129 : les 5
    // dépôts en 03→03). Théorie Olivier 2026-07-09 : un NON COUVERT ne lie AUCUN
    // dépôt (pas de facturation chez Touring) → accept SANS dépôt. On tente donc
    // « sans dépôt » EN PREMIER ; puis `MEM_CID_INTV` (intervenant lié du détail,
    // ex "AA0005653210") et les garages en filet de sécurité (pour un couvert
    // éventuel). Le log dira lequel fait basculer 03→04.
    const memCid = highway ? await resolveComexHighwayDepot(session, keys) : ''
    type Attempt = { depot: string; noDepot: boolean; label: string }
    const attempts: Attempt[] = highway
      ? [
          { depot: '', noDepot: true, label: 'sans-dépôt' },
          ...(memCid ? [{ depot: memCid, noDepot: false, label: `MEM:${memCid}` }] : []),
          ...candidates.map(d => ({ depot: d, noDepot: false, label: d })),
        ]
      : candidates.map(d => ({ depot: d, noDepot: false, label: d }))
    let accepted = false
    for (const att of attempts) {
      triedDepots.push(att.label)
      sentDepotCid = att.noDepot ? '(sans dépôt)' : att.depot
      const acc = await pushComexOperation(session, keys, 'accept', operDate, att.depot, { noDepot: att.noDepot })
      acceptResp = acc?.response
      const st = await readStatus(session)
      if (st && st !== '03' && st !== statusBefore) { accepted = true; statusAfter = st; break }
      statusAfter = st  // reste 03 → on tentera l'essai suivant
    }
    steps.accept = accepted

    if (accepted) {
      await setComexEta(session, keys, opts?.etaMinutes ?? 60);          steps.eta = true
      await assignComexPatrol(session, keys, opts?.refPatrol ?? DEFAULT_REF_PATROL); steps.assign = true
    }
    return { ok: accepted, steps, statusBefore, statusAfter, sentDepotCid, acceptResp, error: accepted ? undefined : `aucun dépôt n'a fait basculer (essayés: ${triedDepots.join(',')})` }
  } catch (e: any) {
    return { ok: false, steps, error: e?.message || 'erreur', statusBefore, statusAfter, sentDepotCid, acceptResp }
  }
}

/**
 * Pousse « en route » (onRoad, 05) côté COMEX via la session USER (patrouille
 * D6826701). `at` optionnel = heure de l'action (peut être BACKDATÉE pour tenir
 * le SLA : onRoad doit rester ≤ accept+10min et précéder le onSpot).
 */
export async function setTouringOnRoad(
  keys: { CID_DOS: string; CID_SEQ_ACTION: string },
  opts?: { at?: Date },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await loginComex('user')
    // Siabis/autoroute : sans dépôt (même règle que l'accept). Olivier 2026-07-09.
    const noDepot = await isComexHighwayMission(session, keys)
    await pushComexOperation(session, keys, 'onRoad', comexOperDate(opts?.at || new Date()), undefined, { noDepot })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'erreur' }
  }
}

/**
 * Pousse « sur place » (onSpot, 06) côté COMEX via la session USER. `at` optionnel
 * = heure d'arrivée (vraie heure si le chauffeur pointe, sinon auto = accept +
 * rand(20..45min) via le cron SLA). Doit être ≤ accept+45min.
 * NB : COMEX exige que onRoad précède onSpot — l'appelant garantit l'ordre.
 */
export async function setTouringOnSpot(
  keys: { CID_DOS: string; CID_SEQ_ACTION: string },
  opts?: { at?: Date },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await loginComex('user')
    // Siabis/autoroute : sans dépôt (même règle que l'accept). Olivier 2026-07-09.
    const noDepot = await isComexHighwayMission(session, keys)
    await pushComexOperation(session, keys, 'onSpot', comexOperDate(opts?.at || new Date()), undefined, { noDepot })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'erreur' }
  }
}
