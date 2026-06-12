// src/lib/towsoft-client.ts
//
// Olivier 2026-06-04 : client TowSoft pour la migration. Remplace
// lib/towsoft-scrape.ts dont le login etait FAUX (POST /auth/login avec
// nomusager/passusager -> NE MARCHE PAS, redirige systematiquement vers
// login.php non authentifie).
//
// LE BON LOGIN (verifie en live par Olivier) :
//   1. GET  /login.php          -> pose un cookie PHPSESSID initial
//   2. POST /_try-login.php     -> body: usager=...&motdepasse=...&mobile=0&fromApp=false
//                                  -> JSON {"login_status":"1"} (1 = succes)
//                                  -> pose un 2e cookie `theuser=VDBot`
//   3. Garder les 2 cookies (PHPSESSID + theuser) pour les requetes suivantes.
//
// Endpoints utilises :
//   - allImpoundListCallServerSide : 1 appel = 733 fiches (toutes parcs / types)
//   - appel.php?num=X : fiche detaillee HTML
//   - origineFormView / destinationFormView / _appel-charges2.php / client-add-modif.php
//     : details (5 endpoints) — voir lib/towsoft-detail.ts (Phase 2)

const TOWSOFT_URL  = process.env.TOWSOFT_URL  || 'https://verviers.towsoft.ca'
const TOWSOFT_USER = process.env.TOWSOFT_USER || 'VDBot'
const TOWSOFT_PASS = process.env.TOWSOFT_PASS

// Cache cookie session (1 par process, ~1h TTL cote TowSoft)
let cachedCookie: string | null = null
let cookieFetchedAt = 0
const COOKIE_TTL_MS = 50 * 60 * 1000  // 50 min

/**
 * Login TowSoft via _try-login.php (le bon endpoint).
 * Retourne le header Cookie complet a utiliser dans les requetes suivantes.
 */
async function loginTowsoft(): Promise<string> {
  if (!TOWSOFT_PASS) throw new Error('TOWSOFT_PASS manquant en env vars')

  const jar = new Map<string, string>()

  // Etape 1 : GET / pour obtenir PHPSESSID initial
  const init = await fetch(`${TOWSOFT_URL}/login.php`, { redirect: 'manual' })
  for (const c of (init.headers as any).getSetCookie?.() || []) {
    const [k, v] = c.split(';')[0].split('=')
    if (k && v) jar.set(k, v)
  }

  // Etape 2 : POST /_try-login.php avec ce cookie
  const auth = await fetch(`${TOWSOFT_URL}/_try-login.php`, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie':           [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: new URLSearchParams({
      usager:     TOWSOFT_USER,
      motdepasse: TOWSOFT_PASS,
      mobile:     '0',
      fromApp:    'false',
    }).toString(),
    redirect: 'manual',
  })

  for (const c of (auth.headers as any).getSetCookie?.() || []) {
    const [k, v] = c.split(';')[0].split('=')
    if (k && v) jar.set(k, v)
  }

  // Verifier que login a reussi (JSON {"login_status":"1"})
  try {
    const body = await auth.json()
    if (body?.login_status !== '1' && body?.login_status !== 1) {
      throw new Error(`Login TowSoft echec : ${JSON.stringify(body)}`)
    }
  } catch (e: any) {
    // Si la reponse n est pas JSON, on continue : certains endpoints renvoient HTML
    if (!auth.ok) throw new Error(`Login TowSoft HTTP ${auth.status}`)
  }

  if (!jar.has('theuser')) {
    throw new Error('Login TowSoft : cookie "theuser" absent (auth incomplete)')
  }

  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  return cookie
}

/**
 * Retourne le cookie de session (login si manquant ou expire).
 * Force re-login si forceReload=true.
 */
export async function getTowsoftCookie(forceReload = false): Promise<string> {
  const age = Date.now() - cookieFetchedAt
  if (!forceReload && cachedCookie && age < COOKIE_TTL_MS) {
    return cachedCookie
  }
  cachedCookie     = await loginTowsoft()
  cookieFetchedAt  = Date.now()
  return cachedCookie
}

/**
 * Fetch authentifie. Retry une fois si 302 -> /login (session expiree).
 */
export async function towsoftFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  let cookie = await getTowsoftCookie()
  let res = await fetch(`${TOWSOFT_URL}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Cookie: cookie,
    },
    redirect: 'manual',
  })

  // Si redirige vers /login = session expiree
  const loc = res.headers.get('location') || ''
  if (res.status === 302 && /login/i.test(loc)) {
    cookie = await getTowsoftCookie(true)
    res = await fetch(`${TOWSOFT_URL}${path}`, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        Cookie: cookie,
      },
      redirect: 'manual',
    })
  }
  return res
}

// ───────────────────────────────────────────────────────────────────
// LISTE DES 733 FICHES (1 seul appel) ⭐
// ───────────────────────────────────────────────────────────────────

export interface TowsoftListRow {
  towsoft_num:   string         // n° fiche (col0)
  base:          string         // ex Pepinster (col1)
  parc_towsoft:  string         // zone/depot TowSoft (col2)
  client_name:   string         // proprietaire/donneur (col4)
  vehicle_raw:   string         // vehicule+plaque+VIN aggreges (col5)
  motif:         string         // Accident, Saisie, ... (col6)
  date_entree:   string         // (col10)
  appel_type:    string         // "Appel Police - Accident", ... (col17)
  raw:           any[]          // ligne aaData entiere
}

/**
 * Fetch les 733 fiches TowSoft en UN SEUL appel via DataTables serverside.
 * Retourne la liste brute (a parser ensuite avec parseListRow).
 */
export async function fetchAllImpoundList(limit = 2000): Promise<{
  total:   number
  rows:    TowsoftListRow[]
  raw:     any
}> {
  // DataTables params (pour avoir TOUT en 1 appel)
  const body = new URLSearchParams()
  body.set('draw', '1')
  body.set('start', '0')
  body.set('length', String(limit))
  body.set('search[value]', '')
  body.set('order[0][column]', '0')
  body.set('order[0][dir]', 'asc')
  // Colonnes minimales requises par DataTables (sinon erreur)
  for (let i = 0; i < 20; i++) {
    body.set(`columns[${i}][data]`, String(i))
    body.set(`columns[${i}][searchable]`, 'true')
    body.set(`columns[${i}][orderable]`, 'true')
  }

  const res = await towsoftFetch('/Src/router.php?controller=Impound/Impound/allImpoundListCallServerSide', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  })

  if (!res.ok) {
    throw new Error(`fetchAllImpoundList HTTP ${res.status}`)
  }

  const data = await res.json()
  const aaData = Array.isArray(data?.aaData) ? data.aaData : []
  const total  = parseInt(data?.iTotalRecords || aaData.length, 10)

  const rows: TowsoftListRow[] = []
  for (const r of aaData) {
    const parsed = parseListRow(r)
    if (parsed) rows.push(parsed)
  }

  return { total, rows, raw: data }
}

/**
 * Parse une ligne aaData de allImpoundListCallServerSide vers un objet
 * structure. col0 contient un <a href="appel.php?num=XXXXX">XXXXX</a>,
 * col5 le vehicule agrege, etc. Tolerant aux variations TowSoft.
 */
function parseListRow(r: any[]): TowsoftListRow | null {
  if (!Array.isArray(r) || r.length === 0) return null
  const col0 = String(r[0] || '')
  const numMatch = col0.match(/appel\.php\?num=(\d+)/i)
  if (!numMatch) return null
  return {
    towsoft_num:  numMatch[1],
    base:         stripHtml(r[1] || ''),
    parc_towsoft: stripHtml(r[2] || ''),
    client_name:  stripHtml(r[4] || ''),
    vehicle_raw:  stripHtml(r[5] || ''),
    motif:        stripHtml(r[6] || ''),
    date_entree:  stripHtml(r[10] || ''),
    appel_type:   stripHtml(r[17] || ''),
    raw:          r,
  }
}

function stripHtml(s: any): string {
  if (s == null) return ''
  return String(s).replace(/<[^>]+>/g, '').trim()
}

/**
 * Helpers d extraction plaque + VIN depuis col5 (souvent format
 * "Marque Modele - PLAQUE - VINxxx" ou variations).
 */
export function extractPlateAndVin(vehicleRaw: string): { plate: string | null; vin: string | null; brand: string | null; model: string | null } {
  if (!vehicleRaw) return { plate: null, vin: null, brand: null, model: null }
  const s = vehicleRaw.trim()
  // Format typique TowSoft : "Marque/Modele/PLAQUE/VIN" ou "Marque Modele PLAQUE"
  // VIN = 17 chars alphanumeriques (sauf I O Q)
  const vinMatch = s.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i)
  const vin = vinMatch ? vinMatch[1].toUpperCase() : null
  // Plaque BE : commence par chiffre, puis lettres + chiffres (ex 1ABC234 ou 2-ABC-456)
  const plateMatch = s.match(/\b([0-9][A-Z]{2,3}[-. ]?[0-9]{2,3})\b/i)
  const plate = plateMatch ? plateMatch[1].replace(/[-. ]/g, '').toUpperCase() : null
  // Marque / modele : tout le reste (best-effort)
  let rest = s
  if (vin)   rest = rest.replace(vin, '')
  if (plate) rest = rest.replace(new RegExp(plateMatch![1], 'i'), '')
  const parts = rest.split(/[\s/,;-]+/).filter(Boolean)
  const brand = parts[0] || null
  const model = parts.slice(1).join(' ') || null
  return { plate, vin, brand, model }
}

/**
 * Parse la date TowSoft (formats varies : DD-MM-YYYY HH:MM, YYYY-MM-DD HH:MM:SS,
 * etc.) en ISO UTC en assumant timezone Europe/Brussels.
 */
export function parseTowsoftDateUTC(s: string | null | undefined): string | null {
  if (!s) return null
  const trimmed = s.trim()
  // YYYY-MM-DD HH:MM(:SS)?
  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    const local = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`)
    return new Date(local.getTime() - brusselsOffsetMs(local)).toISOString()
  }
  // DD-MM-YYYY HH:MM(:SS)?
  m = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    const local = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}`)
    return new Date(local.getTime() - brusselsOffsetMs(local)).toISOString()
  }
  // DD/MM/YYYY HH:MM
  m = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)
  if (m) {
    const local = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`)
    return new Date(local.getTime() - brusselsOffsetMs(local)).toISOString()
  }
  // Date seule -> midi
  m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    const local = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`)
    return new Date(local.getTime() - brusselsOffsetMs(local)).toISOString()
  }
  m = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (m) {
    const local = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`)
    return new Date(local.getTime() - brusselsOffsetMs(local)).toISOString()
  }
  return null
}

function brusselsOffsetMs(d: Date): number {
  const localeStr = d.toLocaleString('en-US', { timeZone: 'Europe/Brussels' })
  const utcStr    = d.toLocaleString('en-US', { timeZone: 'UTC' })
  return (new Date(localeStr).getTime() - new Date(utcStr).getTime())
}

// ───────────────────────────────────────────────────────────────────
// RECHERCHE GLOBALE TOWSOFT (live) ⭐ Olivier 2026-06-12
// ───────────────────────────────────────────────────────────────────
//
// Reproduit la "Recherche rapide" de TowSoft via l endpoint data JSON
// (decouvert en capturant la requete reseau) :
//   GET /_appels-recherche.php?key=<terme>&searchType=<type>&companies=1,2,3,4,5,6
//   -> { aaData: [[col0..col13], ...] }  (format DataTables)
//
// Un seul login partage (cookie cache 50 min via towsoftFetch) couvre
// autant de recherches que voulu — pas de connexion par ligne.

/** Types de recherche supportes (value des radios TowSoft). */
export const TOWSOFT_SEARCH_TYPES = {
  id_appel:            '# de mission',
  num_facture:         '# de facture',
  num_dossier:         '# de dossier',
  immatriculation:     'Immatriculation',
  niv:                 'NIV',
  modele_marque:       'Marque - Modèle',
  client_nom:          'Nom du client',
  origine_destination: "Lieu d'intervention / Destination",
  montant:             'Montant TTC',
  remarques:           'Remarques & notes paiement',
} as const

export type TowsoftSearchType = keyof typeof TOWSOFT_SEARCH_TYPES

// Les 6 compagnies du groupe (company_select). Toutes = recherche large.
const TOWSOFT_ALL_COMPANIES = '1,2,3,4,5,6'

export interface TowsoftSearchResult {
  towsoft_num:        string
  statut:             string | null   // ex "Exporté"
  ticket:             string | null   // ex "Relivraison - Zone K"
  num_facture:        string | null
  dossier:            string | null
  type:               string | null   // ex "Appel Police - Accident"
  date_raw:           string | null
  date_iso:           string | null
  lieu_intervention:  string | null
  destination:        string | null
  client:             string | null
  brand:              string | null
  model:              string | null
  plate:              string | null
  vin:                string | null
  remarks:            string | null
  montant_ttc:        number | null
  action_label:       string | null   // col12 : ex "Restitution", "N/D", "-"
  fiche_url:          string
}

function parseMontantTtc(raw: string): number | null {
  const cleaned = stripHtml(raw).replace(/[^\d.,]/g, '').trim()
  if (!cleaned) return null
  // ',' present => format FR (',' decimal, '.' milliers). Sinon '.' decimal.
  const norm = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned
  const n = Number(norm)
  return Number.isFinite(n) ? n : null
}

function parseSearchRow(r: any[]): TowsoftSearchResult | null {
  if (!Array.isArray(r) || r.length === 0) return null
  const col0 = String(r[0] || '')
  const numMatch = col0.match(/appel\.php\?num=(\d+)/i)
  const towsoft_num = numMatch ? numMatch[1] : stripHtml(col0)
  if (!towsoft_num) return null

  // col1 : statut (+ eventuel <span class="ticket">…</span>)
  const col1 = String(r[1] || '')
  const ticketMatch = col1.match(/class="ticket"[^>]*>([^<]+)</i)
  const ticket = ticketMatch ? ticketMatch[1].trim() : null
  const statut = stripHtml(col1.replace(/<span class="ticket"[\s\S]*?<\/span>/i, '')).trim() || null

  // col9 : vehicule "Marque Modele <hr/> PLAQUE_ou_VIN"
  const vehParts = String(r[9] || '').split(/<hr[^>]*>/i).map(s => stripHtml(s).trim()).filter(Boolean)
  const { plate, vin, brand, model } = extractPlateAndVin(vehParts.join(' '))

  const dateRaw = stripHtml(r[5] || '') || null

  return {
    towsoft_num,
    statut,
    ticket,
    num_facture:       stripHtml(r[2] || '') || null,
    dossier:           stripHtml(r[3] || '') || null,
    type:              stripHtml(r[4] || '') || null,
    date_raw:          dateRaw,
    date_iso:          parseTowsoftDateUTC(dateRaw),
    lieu_intervention: stripHtml(r[6] || '') || null,
    destination:       stripHtml(r[7] || '') || null,
    client:            stripHtml(r[8] || '').replace(/[-–—]{3,}/g, ' ').replace(/\s+/g, ' ').trim() || null,
    brand, model, plate, vin,
    remarks:           stripHtml(r[10] || '') || null,
    montant_ttc:       parseMontantTtc(String(r[11] || '')),
    action_label:      stripHtml(r[12] || '') || null,
    fiche_url:         `${TOWSOFT_URL}/appel.php?num=${towsoft_num}`,
  }
}

// ───────────────────────────────────────────────────────────────────
// ANNULATION D UNE FICHE TOWSOFT ⭐ Olivier 2026-06-12
// ───────────────────────────────────────────────────────────────────
//
// Reproduit le bouton "Annuler" de TowSoft (decouvert via la def JS
// cancellerappel -> modale appel-canceller.php -> submit) :
//   POST /Src/router.php?controller=Appel/AppelCancellation/appelCanceller
//   body: idappel=<num>&idby=<user>&raison=<motif>&dispatchId=&dpr=0
//
// Usage chantier facturation : apres avoir facture via VD Soft, on annule
// la fiche TowSoft avec motif "Facturation via OK VDS" pour la sortir des
// listes a facturer cote TowSoft (double-ecriture coherente).

export interface CancelTowsoftResult {
  ok:           boolean
  towsoft_num:  string
  idby:         string | null
  http_status:  number
  response:     string        // reponse brute (tronquee) pour debug/log
  error?:       string
}

/**
 * Annule une fiche TowSoft avec un motif.
 * idby est auto-decouvert depuis le formulaire d annulation (var idadmin),
 * fallback env TOWSOFT_USER_ID puis '50' (VDBot).
 */
export async function cancelTowsoftAppel(
  towsoftNum: string | number,
  raison: string,
): Promise<CancelTowsoftResult> {
  const num = String(towsoftNum).trim()
  const motif = (raison || '').trim()
  if (!num)   return { ok: false, towsoft_num: num, idby: null, http_status: 0, response: '', error: 'Numero requis' }
  if (!motif) return { ok: false, towsoft_num: num, idby: null, http_status: 0, response: '', error: 'Motif requis' }

  // 1. Recupere idby depuis le formulaire d annulation (var idadmin = "50")
  let idby: string = process.env.TOWSOFT_USER_ID || '50'
  try {
    const formRes = await towsoftFetch(`/appel-canceller.php?thenum=${encodeURIComponent(num)}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    const formHtml = await formRes.text()
    const m = formHtml.match(/idadmin\s*=\s*["'](\d+)["']/i)
    if (m) idby = m[1]
  } catch { /* fallback idby conserve */ }

  // 2. POST l annulation
  const body = new URLSearchParams({
    idappel:    num,
    idby:       idby,
    raison:     motif,
    dispatchId: '',
    dpr:        '0',
  })
  const res = await towsoftFetch('/Src/router.php?controller=Appel/AppelCancellation/appelCanceller', {
    method:  'POST',
    headers: {
      'Content-Type':     'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  })
  const txt = (await res.text().catch(() => '')).slice(0, 500)

  return {
    ok:          res.ok,
    towsoft_num: num,
    idby,
    http_status: res.status,
    response:    txt,
    error:       res.ok ? undefined : `HTTP ${res.status}`,
  }
}

/**
 * Verifie le statut d une fiche TowSoft via la recherche par # de mission.
 * Retourne le statut texte (ex "Annulé", "Exporté") ou null si introuvable.
 */
export async function getTowsoftAppelStatus(towsoftNum: string | number): Promise<string | null> {
  const rows = await searchTowsoftGlobal('id_appel', String(towsoftNum))
  const hit = rows.find(r => r.towsoft_num === String(towsoftNum)) || rows[0]
  return hit?.statut || null
}

/**
 * Recherche globale dans TowSoft (toutes compagnies) par critere.
 * Login partage (cookie cache). Retourne 0..N resultats structures.
 */
export async function searchTowsoftGlobal(
  searchType: TowsoftSearchType,
  key: string,
): Promise<TowsoftSearchResult[]> {
  const term = (key || '').trim()
  if (!term) return []
  if (!(searchType in TOWSOFT_SEARCH_TYPES)) {
    throw new Error(`searchType invalide : ${searchType}`)
  }
  const qs = new URLSearchParams({
    key:        term,
    searchType,
    companies:  TOWSOFT_ALL_COMPANIES,
    _:          String(Date.now()),
  })
  const res = await towsoftFetch(`/_appels-recherche.php?${qs.toString()}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  })
  if (!res.ok) throw new Error(`searchTowsoftGlobal HTTP ${res.status}`)
  const data = await res.json().catch(() => ({}))
  const aaData = Array.isArray(data?.aaData) ? data.aaData : []
  return aaData.map(parseSearchRow).filter((x: TowsoftSearchResult | null): x is TowsoftSearchResult => x !== null)
}
