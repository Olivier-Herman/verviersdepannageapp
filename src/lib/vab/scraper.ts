// src/lib/vab/scraper.ts
//
// Scraper HTTP de la plateforme VAB COMET (comet.vab.be).
// Pas d'API officielle → on simule la session navigateur :
//   1. POST /login        → cookie de session
//   2. GET  /Missions     → table HTML des missions du jour, parse avec cheerio
//   3. GET  /Détails/{id} → opens detail (peut etre necessaire pour CSRF)
//   4. POST submit-email  → declenche envoi mail (qui sera capte par le parser
//                            email existant cote app)
//
// Pas de Chrome headless requis → tourne sur Vercel serverless sans probleme.
// Defensive : logs detailles + fail explicite si HTML structure change.

import * as cheerio from 'cheerio'

const VAB_BASE = 'https://comet.vab.be'

export interface ScrapedMission {
  /** N° de mission VAB (ex: "8293644") — identifiant principal */
  missionNumber: string
  /** Identifiant interne VAB pour ouvrir le detail (depuis href du bouton Detail) */
  detailHref:    string | null
  /** Type de tache (Remorquage, Panne, Livraison VR, ...) */
  taskType:      string | null
  /** Date dispatch (texte brut HTML) */
  dispatchDate:  string | null
  /** Statut de la mission tel qu'affiche VAB */
  status:        string | null
  /** Plaque vehicule */
  plate:         string | null
  /** Localisation depart */
  fromLocation:  string | null
  /** Localisation destination */
  toLocation:    string | null
}

interface SessionCookies {
  /** Cookie de session VAB serialise pour reutilisation entre requetes */
  cookieHeader: string
}

/**
 * Cookie jar minimal : merge plusieurs reponses Set-Cookie en gardant
 * uniquement la DERNIERE valeur pour chaque nom. Critique pour ASP.NET
 * FormsAuth : .ASPXAUTH anonyme (pre-login) doit etre ecrase par le
 * .ASPXAUTH authentifie (post-login), sinon le serveur considere la
 * session comme anonyme et renvoie NoPermission.
 */
class CookieJar {
  private jar = new Map<string, string>()

  addFromResponse(res: Response): void {
    const setCookies = res.headers.getSetCookie?.() || []
    if (setCookies.length === 0) {
      const single = res.headers.get('set-cookie')
      if (single) setCookies.push(single)
    }
    for (const c of setCookies) {
      const firstPair = c.split(';')[0]?.trim()
      if (!firstPair) continue
      const eqIdx = firstPair.indexOf('=')
      if (eqIdx < 0) continue
      const name = firstPair.slice(0, eqIdx).trim()
      const value = firstPair.slice(eqIdx + 1).trim()
      // Si la valeur est vide (Max-Age=0 ou explicit delete), on retire
      if (!value || value === '""') {
        this.jar.delete(name)
      } else {
        this.jar.set(name, value)
      }
    }
  }

  toHeader(): string {
    return Array.from(this.jar.entries()).map(([n, v]) => `${n}=${v}`).join('; ')
  }

  size(): number {
    return this.jar.size
  }
}

/** User-Agent realiste : certains serveurs filtrent les UA non-browser. */
const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/**
 * Login sur comet.vab.be.
 *
 * Strategy robuste :
 * 1. GET /COMET (entry point base sur le screenshot URL "comet.vab.be/COMET")
 *    OU fallback / si /COMET retourne 404
 * 2. Parse le <form> de login : recupere son action URL + tous les hidden inputs
 *    (CSRF, viewstate ASP.NET, etc.)
 * 3. POST sur l'action URL avec username/password + hidden fields
 * 4. Verifie qu'on est bien logge (302 vers /Missions ou cookie auth different)
 */
export async function loginVab(): Promise<SessionCookies> {
  const username = process.env.VAB_EMAIL
  const password = process.env.VAB_PASSWORD
  if (!username || !password) {
    throw new Error('VAB_EMAIL et VAB_PASSWORD env vars sont requis')
  }

  // CookieJar partage qui accumule les cookies tout au long du flow.
  const jar = new CookieJar()

  // Essaie plusieurs entry points jusqu'a trouver la page de login.
  // VAB COMET est ASP.NET WebForms → .aspx avec __VIEWSTATE etc.
  const entryPaths = ['/Comet/Home.aspx', '/Comet/Default.aspx', '/COMET', '/']
  let initRes: Response | null = null
  let initUrl: string = ''
  let initHtml: string = ''
  for (const path of entryPaths) {
    const url = `${VAB_BASE}${path}`
    // redirect: 'manual' pour capturer TOUS les Set-Cookie de la chaine
    let currentUrl = url
    let currentRes: Response | null = null
    // Suit les redirects manuellement et capture chaque Set-Cookie
    for (let hop = 0; hop < 5; hop++) {
      const r = await fetch(currentUrl, {
        method:   'GET',
        redirect: 'manual',
        headers: {
          'User-Agent':      REAL_UA,
          'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8',
          'Cookie':          jar.toHeader(),
        },
      })
      jar.addFromResponse(r)
      if (r.status === 200) {
        currentRes = r
        break
      }
      if (r.status === 302 || r.status === 303) {
        const loc = r.headers.get('location')
        if (!loc) break
        currentUrl = new URL(loc, currentUrl).toString()
        continue
      }
      break
    }
    if (currentRes && currentRes.status === 200) {
      initRes = currentRes
      initUrl = currentUrl
      initHtml = await currentRes.text()
      console.log(`[vab/login] entry OK via ${path} → ${initUrl} (cookies: ${jar.size()})`)
      break
    }
    console.log(`[vab/login] entry ${path} : pas de 200 finale`)
  }
  if (!initRes) {
    throw new Error('VAB login : aucune page d\'entree trouvee parmi ' + entryPaths.join(', '))
  }
  const html = initHtml
  const $ = cheerio.load(html)

  // Trouve le <form> de login : celui qui contient un input password
  let formAction = ''
  const passwordInput = $('input[type="password"]').first()
  const $form = passwordInput.closest('form')
  if ($form.length === 0) {
    throw new Error('VAB login : pas de <form> avec input password trouve dans ' + initUrl)
  }
  formAction = $form.attr('action') || initUrl
  const usernameField = $form.find('input[type="text"], input[type="email"]').first()
  const usernameFieldName = usernameField.attr('name') || 'Username'
  const passwordFieldName = passwordInput.attr('name') || 'Password'

  // Resoud l'URL de submit (peut etre relative)
  let submitUrl: string
  try {
    submitUrl = new URL(formAction, initUrl).toString()
  } catch {
    submitUrl = initUrl
  }
  console.log(`[vab/login] form action → ${submitUrl} (user field: ${usernameFieldName}, pwd field: ${passwordFieldName})`)

  // Recupere TOUS les hidden inputs (CSRF, ASP.NET __VIEWSTATE, __EVENTVALIDATION,
  // __VIEWSTATEGENERATOR, etc.). Critique pour ASP.NET WebForms.
  const formData = new URLSearchParams()
  $form.find('input[type="hidden"]').each((_idx, el) => {
    const n = $(el).attr('name')
    const v = $(el).attr('value') ?? ''
    if (n) formData.set(n, v)
  })
  formData.set(usernameFieldName, username)
  formData.set(passwordFieldName, password)

  // ASP.NET : le serveur s'attend a recevoir le bouton qui a declenche le
  // postback (name + value). On cherche le bouton "Login" / "Submit" / "Connexion".
  const $loginBtn = $form.find('input[type="submit"], button[type="submit"], button').filter((_, btn) => {
    const txt = ($(btn).text() || $(btn).attr('value') || '').toLowerCase()
    return txt.includes('login') || txt.includes('connexion') || txt.includes('se connecter') || txt.includes('sign in')
  }).first()
  const btnName = $loginBtn.attr('name')
  const btnValue = $loginBtn.attr('value') || $loginBtn.text().trim()
  if (btnName) {
    formData.set(btnName, btnValue || 'Login')
    console.log(`[vab/login] submit btn detecte : ${btnName}=${btnValue || 'Login'}`)
  }

  // POST sur l'action URL en suivant manuellement les redirects pour
  // capturer TOUS les Set-Cookie (notamment .ASPXAUTH apres la 302).
  let postUrl = submitUrl
  let loginRes: Response | null = null
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(postUrl, {
      method:   hop === 0 ? 'POST' : 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent':      REAL_UA,
        'Content-Type':    hop === 0 ? 'application/x-www-form-urlencoded' : '',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8',
        'Cookie':          jar.toHeader(),
        'Referer':         initUrl,
        'Origin':          VAB_BASE,
      },
      body: hop === 0 ? formData.toString() : undefined,
    })
    jar.addFromResponse(r)
    if (r.status === 200) {
      loginRes = r
      break
    }
    if (r.status === 302 || r.status === 303) {
      const loc = r.headers.get('location')
      if (!loc) { loginRes = r; break }
      postUrl = new URL(loc, postUrl).toString()
      console.log(`[vab/login] redirect ${hop+1} -> ${postUrl}`)
      continue
    }
    loginRes = r
    break
  }
  if (!loginRes) throw new Error('VAB login : pas de reponse finale')

  // Verifie qu'on n'est pas reste sur la page de login (auth ratee)
  if (loginRes.status === 200) {
    const body = await loginRes.text().catch(() => '')
    if (/invalid|incorrect|erreur|wrong|failed/i.test(body) && /password|mot.?de.?passe/i.test(body)) {
      throw new Error(`VAB login : creds invalides. Snippet: ${body.slice(0, 300)}`)
    }
    // Si la page contient encore un input password, c'est probablement la
    // page de login re-rendue (auth ratee silencieuse)
    if (cheerio.load(body)('input[type="password"]').length > 0) {
      throw new Error('VAB login : la reponse contient encore un champ password. Auth ratee. Snippet: ' + body.slice(0, 300))
    }
  } else if (loginRes.status !== 302 && loginRes.status !== 303) {
    const body = await loginRes.text().catch(() => '')
    throw new Error(`VAB login : status ${loginRes.status}. URL: ${postUrl}. Snippet: ${body.slice(0, 500)}`)
  }

  const cookieHeader = jar.toHeader()
  if (!cookieHeader) {
    throw new Error('VAB login : aucun cookie de session retourne')
  }
  console.log(`[vab/login] OK, ${jar.size()} cookies (header ${cookieHeader.length} bytes)`)
  return { cookieHeader }
}

/**
 * Liste les missions visibles sur la page Missions de COMET.
 * Parse la table HTML pour extraire chaque ligne.
 *
 * Strategy : essaie plusieurs paths .aspx (le serveur est ASP.NET WebForms),
 * puis si tout echoue, GET la page Home et cherche un lien vers Missions
 * dans la nav pour extraire l'URL reelle.
 */
export async function listVabMissions(session: SessionCookies): Promise<{ missions: ScrapedMission[]; debug: string }> {
  // URLs confirmees par Olivier :
  // - Liste : /Comet/Home.aspx (oui, "Home.aspx" est aussi la page de login,
  //   et apres auth elle affiche la liste des missions du jour)
  // - Detail : /Comet/TowAssignments_Details.aspx?AssignmentId={id}
  const candidatePaths = [
    '/Comet/Home.aspx',
    '/Comet/Missions.aspx',
    '/Comet/NewMissions.aspx',
    '/Comet/MissionList.aspx',
    '/Comet_TH/Home.aspx',
    '/Comet_TH/Missions.aspx',
  ]

  let res: Response | null = null
  let usedPath: string = ''
  for (const path of candidatePaths) {
    const r = await fetch(`${VAB_BASE}${path}`, {
      method: 'GET',
      redirect: 'follow', // suit eventuelles 302
      headers: {
        'User-Agent':      REAL_UA,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8',
        'Cookie':          session.cookieHeader,
      },
    })
    if (r.status === 200) {
      res = r
      usedPath = path
      console.log(`[vab/list] page trouvee via ${path} -> ${r.url}`)
      break
    }
    console.log(`[vab/list] ${path} -> status ${r.status}`)
  }

  // Fallback : si rien ne marche, on tente de discover via la home page
  // ET la racine /Comet_TH/ qui peut rediriger vers la vraie home apres auth
  if (!res) {
    const homeRes = await fetch(`${VAB_BASE}/Comet_TH/`, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':      REAL_UA,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie':          session.cookieHeader,
      },
    })
    if (homeRes.status === 200) {
      const homeHtml = await homeRes.text()
      const $h = cheerio.load(homeHtml)
      // Cherche un lien dont le texte contient "Missions"
      let foundLink: string | null = null
      $h('a').each((_idx, a) => {
        if (foundLink) return
        const txt = $h(a).text().toLowerCase().trim()
        const href = $h(a).attr('href')
        if (href && (txt.includes('nouvelles') || txt.includes('missions'))) {
          foundLink = href
        }
      })
      if (foundLink) {
        const found: string = foundLink
        const url = new URL(found, homeRes.url).toString()
        console.log(`[vab/list] discover via home -> ${url}`)
        const r = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Verviers-App/1.0)',
            'Accept':     'text/html,*/*;q=0.8',
            'Cookie':     session.cookieHeader,
          },
        })
        if (r.status === 200) {
          res = r
          usedPath = found
        }
      }
    }
  }

  if (!res) {
    throw new Error(`VAB Missions : aucun path ne fonctionne. Tente : ${candidatePaths.join(', ')}`)
  }

  const html = await res.text()
  const $ = cheerio.load(html)

  const missions: ScrapedMission[] = []
  const debugLog: string[] = []

  // Strategy : on cherche les liens vers /Comet/MissionDetail.aspx?... (ou
  // similaire). Ces liens contiennent l'identifiant de mission et permettent
  // de remonter au numero affiche dans la meme row. Plus robuste que de
  // deviner la structure du tableau.
  const candidateLinks: Array<{ href: string; text: string; row: any }> = []
  $('a').each((_idx, a) => {
    const href = $(a).attr('href') || ''
    const text = $(a).text().trim()
    if (!href) return
    const lower = href.toLowerCase()
    const txtLower = text.toLowerCase()
    // Candidat = lien vers detail (TowAssignments_Details est l'URL VAB)
    if (
      lower.includes('towassignments_details') ||
      lower.includes('missiondetail') ||
      lower.includes('assignmentid=') ||
      lower.includes('detail') ||
      lower.includes('mission?') ||
      lower.includes('/mission/') ||
      txtLower.includes('détail') ||
      txtLower.includes('detail')
    ) {
      const row = $(a).closest('tr').length > 0 ? $(a).closest('tr') : $(a).closest('div')
      candidateLinks.push({ href, text, row })
    }
  })
  debugLog.push(`candidateLinks count: ${candidateLinks.length}`)

  // Pour chaque lien candidat, on extrait le n° mission dans le meme container.
  // Strategy en plusieurs etages : tr -> table parente -> body avec proximite.
  //
  // NB: chez VAB, plusieurs lignes peuvent avoir le meme N° mission (8293644)
  // mais avec des AssignmentId differents (= 2 sous-taches du meme dossier,
  // ex: Remorquage + Livraison VR). On dedup donc par AssignmentId, PAS par
  // missionNumber (qui peut etre identique sur 2 lignes legitimes).
  const seenAssignmentIds = new Set<string>()
  for (const cand of candidateLinks) {
    // Extract AssignmentId depuis l'URL (toujours dispo)
    const aidMatch = cand.href.match(/[?&]AssignmentId=(\d+)/i)
    const assignmentId = aidMatch ? aidMatch[1] : null
    // Dedup par AssignmentId : si meme assignmentId que precedent, skip
    if (assignmentId && seenAssignmentIds.has(assignmentId)) continue
    if (assignmentId) seenAssignmentIds.add(assignmentId)

    // Essaie d'extraire le n° mission depuis plusieurs scopes
    let missionNumber: string | null = null
    let scopeUsed = 'none'

    const scopes: Array<{ name: string; el: any }> = [
      { name: 'closest-tr',    el: cand.row.closest('tr') },
      { name: 'closest-table', el: cand.row.closest('table') },
      { name: 'parent-2up',    el: cand.row.parent().parent() },
      { name: 'parent-3up',    el: cand.row.parent().parent().parent() },
    ]
    for (const scope of scopes) {
      if (!scope.el || scope.el.length === 0) continue
      const text = scope.el.text().replace(/\s+/g, ' ').trim()
      // Match un nombre 6-10 chiffres distinct de l'AssignmentId
      const matches: string[] = text.match(/\b(\d{6,10})\b/g) || []
      const candidate = matches.find((n: string) => n !== assignmentId)
      if (candidate) {
        missionNumber = candidate
        scopeUsed = scope.name
        break
      }
    }

    // Fallback : si on n'a pas trouve de mission number distinct mais on a
    // l'AssignmentId, on utilise l'AssignmentId comme identifiant unique
    // (mieux que rien — la dedup BDD pourra le matcher si on stocke aussi
    // l'AssignmentId comme external_id quand l'email parse arrive)
    if (!missionNumber && assignmentId) {
      missionNumber = assignmentId
      scopeUsed = 'fallback-assignment-id'
    }

    if (!missionNumber) {
      debugLog.push(`cand-skip: href=${cand.href.slice(0, 60)} (rien trouve)`)
      continue
    }
    debugLog.push(`cand-ok: ${missionNumber} (aid=${assignmentId || 'n/a'}) via ${scopeUsed}`)

    // Note : pas de dedup par missionNumber - chez VAB, 2 sous-taches peuvent
    // partager le meme n° mission mais avec des AssignmentId differents.
    // La dedup par AssignmentId est faite au debut de la boucle.

    // Extract cellules si dispo
    const tr = cand.row.closest('tr')
    let taskType: string | null = null
    let dispatchDate: string | null = null
    let status: string | null = null
    let plate: string | null = null
    let fromLocation: string | null = null
    let toLocation: string | null = null

    if (tr.length > 0) {
      const cells = tr.find('td')
      if (cells.length >= 2) taskType     = $(cells[1]).text().trim() || null
      if (cells.length >= 3) dispatchDate = $(cells[2]).text().trim() || null
      if (cells.length >= 4) status       = $(cells[3]).text().trim() || null
      if (cells.length > 5)  fromLocation = $(cells[5]).text().trim().replace(/\s+/g, ' ') || null
      if (cells.length > 6)  toLocation   = $(cells[6]).text().trim().replace(/\s+/g, ' ') || null
      if (cells.length > 7) {
        const vehText = $(cells[7]).text().trim()
        plate = vehText.split(/\s+/).filter(Boolean).pop() || null
      }
    }

    missions.push({
      missionNumber,
      detailHref: cand.href,
      taskType,
      dispatchDate,
      status,
      plate,
      fromLocation,
      toLocation,
    })
  }

  // Fallback 1 : si on a 0 missions mais que le HTML contient bien des numeros
  // longs (style 8293644), on essaie de les extraire directement.
  if (missions.length === 0) {
    const allMatches = html.match(/\b(\d{6,10})\b/g)
    const uniqueNums = Array.from(new Set(allMatches || [])).slice(0, 50)
    debugLog.push(`fallback: ${uniqueNums.length} num(s) detectes dans HTML brut`)
    if (uniqueNums.length > 0 && uniqueNums.length < 50) {
      // On loggue les premiers, sans les pousser dans missions[] (incertain)
      debugLog.push(`fallback nums sample: ${uniqueNums.slice(0, 5).join(', ')}`)
    }
  }

  // Dump structure summary in logs pour debug
  const tableCount = $('table').length
  const rowsCount = $('tr').length
  const linksCount = $('a').length
  debugLog.push(`tables: ${tableCount}, tr: ${rowsCount}, a: ${linksCount}`)
  const debug = `path=${usedPath} | url=${res.url} | tables=${tableCount} | tr=${rowsCount} | a=${linksCount} | ${debugLog.join(' | ')}`
  console.log(`[vab/list] ${missions.length} mission(s) trouvee(s). ${debug}`)

  if (missions.length === 0 && rowsCount === 0 && tableCount === 0) {
    const snippet = html.slice(0, 1000).replace(/\s+/g, ' ')
    console.warn(`[vab/list] HTML snippet (pas de table): ${snippet}`)
  }

  return { missions, debug }
}

/**
 * Champs scrapes depuis la page detail d'une mission VAB.
 * Permet d'inserer directement la mission en BDD sans passer par l'email.
 */
export interface VabMissionDetail {
  /** N° mission VAB (depuis la liste) */
  missionNumber:    string
  /** AssignmentId (depuis URL) */
  assignmentId:     string | null
  /** N° dossier interne VAB / contrat (2e partie du titre, ex: 34952598) */
  dossierNumber:    string | null
  /** Vrai N° DOSSIER VAB (1re partie du titre du détail, ex: 8387074) — autoritaire */
  dossierBase:      string | null
  taskType:         string | null
  /** Codes de panne (ex: "Accident de voiture") */
  codesDePanne:     string | null
  // From location (emplacement de)
  fromName:         string | null
  fromStreet:       string | null
  fromZip:          string | null
  fromCity:         string | null
  fromPhone:        string | null
  // To location
  toName:           string | null
  toStreet:         string | null
  toZip:            string | null
  toCity:           string | null
  toPhone:          string | null
  // General (client)
  clientName:       string | null
  clientPhone:      string | null
  /** Date intervention (A) ex: "14-05-2026 17:00:00" */
  interventionAt:   string | null
  // Vehicle
  vehiclePlate:     string | null
  vehicleBrand:     string | null
  vehicleModel:     string | null
  vehicleVin:       string | null
  vehicleYear:      string | null
  vehicleColor:     string | null
  vehicleFuel:      string | null
  vehicleTraction:  string | null
  /** Categorie vehicule (Voiture / Moto / Camion / ...) */
  vehicleCategory:  string | null
  /** Texte libre "Localisation du véhicule" (ex: "E25 PARKING HARRE (OUEST) --> DIRECTION LIEGE") */
  fromLocationFreeText: string | null
  // Raw HTML dump for debug
  rawSnippet:       string
}

/**
 * Recupere et parse la page detail d'une mission VAB. Extrait tous les
 * champs utilisables pour creer une mission dans incoming_missions sans
 * passer par l'email.
 */
/**
 * TYPE DE TÂCHE par AssignmentId, lu dans la colonne « Type de tâche » de la
 * liste. `listVabMissions` existe déjà, mais son mapping de colonnes est décalé
 * sur ce champ ; plutôt que de le refondre — il fait tourner l'import — on relit
 * ici la seule colonne dont la clôture a besoin.
 */
export async function vabTaskTypes(session: SessionCookies): Promise<Record<string, string>> {
  const res = await fetch(`${VAB_BASE}/Comet/Home.aspx`, {
    headers: { 'User-Agent': REAL_UA, Cookie: session.cookieHeader, 'Cache-Control': 'no-store' },
  })
  const html = await res.text()
  const out: Record<string, string> = {}
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const aid = (m[1].match(/AssignmentId=(\d+)/) || [])[1]
    if (!aid) continue
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c =>
      c[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&#233;/g, 'é').replace(/&#232;/g, 'è')
          .replace(/\s+/g, ' ').trim())
    if (cells.length >= 3) out[aid] = cells[2] || ''
  }
  return out
}

/**
 * LIVRAISON DE VÉHICULE DE REMPLACEMENT — à NE PAS clôturer automatiquement.
 *
 * « Il ne faut pas traiter la clôture de ces missions car il y a des infos du
 * conducteur à entrer » (Olivier 2026-08-26) : permis, identité, état du
 * véhicule prêté. Personne d'autre que l'humain qui a fait la remise ne les a.
 *
 * C'est aussi ce qui explique leur échec « écran on-site non trouvé » : une
 * livraison de VR n'a pas d'écran de panne, on cherchait un formulaire qui
 * n'existe pas pour elle.
 */
export function estVehiculeRemplacementVab(typeDeTache: string | null | undefined): boolean {
  return /remplacement|vervangwagen|replacement/i.test(String(typeDeTache || ''))
}

export async function fetchVabMissionDetail(
  session:    SessionCookies,
  detailHref: string,
  missionNumber: string,
): Promise<VabMissionDetail | { error: string }> {
  const detailUrl = detailHref.startsWith('http')
    ? detailHref
    : `${VAB_BASE}${detailHref.startsWith('/') ? detailHref : '/' + detailHref}`

  const res = await fetch(detailUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent':      REAL_UA,
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8',
      'Cookie':          session.cookieHeader,
    },
  })
  if (res.status !== 200) {
    return { error: `GET detail status ${res.status} (${detailUrl})` }
  }
  const html = await res.text()
  const $ = cheerio.load(html)
  const aidMatch = detailHref.match(/[?&]AssignmentId=(\d+)/i)
  const assignmentId = aidMatch ? aidMatch[1] : null

  // Pattern VAB COMET (OutSystems) confirme par l'inspection du HTML brut :
  //
  //   <div class="SpacerBottom5">
  //     <label class=' OSFillParent' style='' for='' >Nom</label>
  //     VERVIERS DEPANNAGE SA
  //   </div>
  //
  // Pour les tels : la valeur est dans <div><a><span class="Telephone">VAL</span></a></div>
  // Pour les vehicules : wrappe d'un <div class="ThemeGrid_Width6">
  //
  // Strategy : pour chaque <div class="SpacerBottom5">, on lit le label et
  // tout le reste du texte (excluant le label) = la valeur.
  //
  // Pour distinguer "Nom" dans "Emplacement de" vs "Emplacement à", on scope
  // par les containers identifies : id contient wtLocationFromContainer,
  // wtLocationToContainer, wtGeneralInfoContainer.

  /**
   * Extrait toutes les paires label→value des .SpacerBottom5 dans un scope.
   */
  function extractFields(scope: any): Record<string, string> {
    const fields: Record<string, string> = {}
    if (!scope || scope.length === 0) return fields
    scope.find('.SpacerBottom5').each((_idx: number, el: any) => {
      const $el = $(el)
      const $label = $el.find('label').first()
      if ($label.length === 0) return
      const labelText = $label.text().trim().replace(/\s+/g, ' ')
      if (!labelText) return

      // Retire le label du HTML pour ne garder que la valeur
      // Approche : clone, retire le label, lit le text restant
      const $clone = $el.clone()
      $clone.find('label').first().remove()
      const valueText = $clone.text().trim().replace(/\s+/g, ' ')
      if (valueText) {
        fields[labelText] = valueText
      }
    })
    return fields
  }

  // Trouve un Panel (encart .Panel > .Panel__title) par titre. Plus robuste
  // que les ids OutSystems (`wtLocationFromContainer2` etc.) qui changent
  // entre versions de la page VAB. Le titre, lui, est stable.
  function findPanelByTitle(titles: string[]): any {
    let result: any = null
    $('.Panel').each((_idx: number, panel: any) => {
      if (result) return
      const $panel = $(panel)
      const title = $panel.find('.Panel__title').first().text().trim().toLowerCase()
      if (titles.some(t => title.includes(t.toLowerCase()))) {
        result = $panel.find('.Panel_content').first()
        // Fallback : si pas de .Panel_content (variation OutSystems), retourne le panel lui-même
        if (!result || result.length === 0) result = $panel
      }
    })
    return result
  }

  // Containers par titre (stable a travers les versions OutSystems).
  // "Localisation du véhicule" = section "from" (où se trouve le vehicule)
  // "Emplacement à"            = section "to"   (destination, si applicable)
  // "Informations générales"   = client + intervention date (post-acceptation)
  // "Informations véhicule"    = plaque, marque, modèle, etc.
  const fromContainer    = findPanelByTitle(['Localisation du véhicule', 'Localisation du vehicule', 'Emplacement de'])
  const toContainer      = findPanelByTitle(['Emplacement à', 'Emplacement a', 'Destination'])
  const generalContainer = findPanelByTitle(['Informations générales', 'Informations generales'])
  const vehicleContainer = findPanelByTitle(['Informations véhicule', 'Informations vehicule'])

  // Extraction par section
  const fromFields    = extractFields(fromContainer)
  const toFields      = extractFields(toContainer)
  const generalFields = extractFields(generalContainer)
  const vehicleFields = extractFields(vehicleContainer)

  // Fallback robuste par ORDRE d'apparition dans le DOM : « Emplacement de »
  // précède toujours « Emplacement à ». Quand l'extraction par panneau rate
  // l'adresse de destination (cas NISSAN 2026-07-06 : Nom capté mais pas
  // Rue/Code postal/Ville), on relit toutes les paires label→valeur dans l'ordre
  // et on prend la 1re occurrence pour « from », la 2e pour « to ».
  const orderedFields: Record<string, string[]> = {}
  $('.SpacerBottom5').each((_idx: number, el: any) => {
    const $el = $(el)
    const $label = $el.find('label').first()
    if (!$label.length) return
    const key = $label.text().trim().replace(/\s+/g, ' ')
    if (!key) return
    const $clone = $el.clone()
    $clone.find('label').first().remove()
    const val = $clone.text().trim().replace(/\s+/g, ' ')
    if (!val) return
    if (!orderedFields[key]) orderedFields[key] = []
    orderedFields[key].push(val)
  })
  const nth = (label: string, n: number): string | null => (orderedFields[label] && orderedFields[label][n]) || null

  // Fallback Telephone : la valeur peut etre dans <a href="tel:..."> au lieu
  // du .SpacerBottom5 du label (pattern OutSystems sur certains champs).
  function findPhoneIn(scope: any): string | null {
    if (!scope || scope.length === 0) return null
    let phone: string | null = null
    scope.find('a[href^="tel:"]').each((_idx: number, el: any) => {
      if (phone) return
      const href = $(el).attr('href') || ''
      const tel = href.replace(/^tel:/i, '').trim()
      if (tel) phone = tel
    })
    if (!phone) {
      scope.find('.Telephone, span.Telephone').each((_idx: number, el: any) => {
        if (phone) return
        const t = $(el).text().trim()
        if (t && /\d/.test(t)) phone = t
      })
    }
    return phone
  }

  const fromPhoneFinal = (fromFields['Téléphone'] && /\d/.test(fromFields['Téléphone']))
    ? fromFields['Téléphone']
    : (fromFields['GSM'] && /\d/.test(fromFields['GSM']))
      ? fromFields['GSM']
      : findPhoneIn(fromContainer)
  const toPhoneFinal = (toFields['Téléphone'] && /\d/.test(toFields['Téléphone']))
    ? toFields['Téléphone']
    : (toFields['GSM'] && /\d/.test(toFields['GSM']))
      ? toFields['GSM']
      : findPhoneIn(toContainer)
  const generalPhoneFinal = (generalFields['Téléphone'] && /\d/.test(generalFields['Téléphone']))
    ? generalFields['Téléphone']
    : (generalFields['GSM'] && /\d/.test(generalFields['GSM']))
      ? generalFields['GSM']
      : findPhoneIn(generalContainer)

  // Type de tache extrait du <title> "Détails du remorquage" → "remorquage"
  const titleEl = $('title').text().trim()
  let taskTypeRaw: string | null = null
  const titleMatch = titleEl.match(/d[ée]tails du (\w+)/i)
  if (titleMatch) taskTypeRaw = titleMatch[1]

  // Codes de panne : <span ...wtListRecords1><ul><li>VAL</li></ul></span>
  let codesDePanne: string | null = null
  const $codes = $('[id*="wtListRecords1"]').first()
  if ($codes.length > 0) {
    codesDePanne = $codes.text().trim().replace(/\s+/g, ' ') || null
  }

  // Le champ "Type de véhicule" apparait 2x : 1ere = marque/modele, 2eme = categorie (Voiture)
  // vehicleFields['Type de véhicule'] ne prendra que la derniere. On parse manuellement.
  let vehicleMarqueModele: string | null = null
  let vehicleCategorie: string | null = null
  if (vehicleContainer && vehicleContainer.length > 0) {
    const typeOccurrences: string[] = []
    vehicleContainer.find('.SpacerBottom5').each((_idx: number, el: any) => {
      const $el = $(el)
      const $label = $el.find('label').first()
      if (!$label.length) return
      if ($label.text().trim().toLowerCase().includes('type de véhicule')) {
        const $clone = $el.clone()
        $clone.find('label').first().remove()
        const v = $clone.text().trim().replace(/\s+/g, ' ')
        if (v) typeOccurrences.push(v)
      }
    })
    if (typeOccurrences.length >= 1) vehicleMarqueModele = typeOccurrences[0]
    if (typeOccurrences.length >= 2) vehicleCategorie = typeOccurrences[1]
  }

  // Split marque/modele : "SKODA FABIA" → marque=SKODA, modele=FABIA
  let vehicleBrand: string | null = null
  let vehicleModel: string | null = null
  if (vehicleMarqueModele) {
    const parts = vehicleMarqueModele.split(/\s+/)
    if (parts.length >= 2) {
      vehicleBrand = parts[0]
      vehicleModel = parts.slice(1).join(' ')
    } else {
      vehicleBrand = vehicleMarqueModele
    }
  }

  // Extract dossier number depuis le TITRE du détail (ex: "8387074 / 34952598").
  //   m[1] = vrai N° DOSSIER VAB (autoritaire) — à préférer à `missionNumber`,
  //          qui vient de la LISTE via un scope large et peut attraper un numéro
  //          voisin/partagé (bug : 2 véhicules ≠ même dossier). Olivier 2026-08-13.
  //   m[2] = n° tâche / contrat interne.
  let dossierNumber: string | null = null
  let dossierBase:   string | null = null
  $('.HeaderTitle, .Heading1').each((_idx: number, el: any) => {
    if (dossierNumber) return
    const txt = $(el).text().trim()
    const m = txt.match(/(\d{6,10})\s*\/\s*(\d{6,10})/)
    if (m) { dossierBase = m[1]; dossierNumber = m[2] }
  })

  const detail: VabMissionDetail = {
    missionNumber,
    assignmentId,
    dossierNumber,
    dossierBase,
    taskType:       taskTypeRaw,
    codesDePanne,

    fromName:       fromFields['Nom'] || fromFields['Nom contact'] || fromFields['Personne'] || nth('Nom', 0),
    fromStreet:     fromFields['Rue'] || nth('Rue', 0),
    fromZip:        fromFields['Code postal'] || nth('Code postal', 0),
    fromCity:       fromFields['Ville'] || nth('Ville', 0),
    fromPhone:      fromPhoneFinal,
    // Texte libre type "ENFACE N5" ou "E25 PARKING HARRE (OUEST) --> DIRECTION LIEGE"
    fromLocationFreeText: fromFields['Localisation du véhicule'] || fromFields['Localisation du vehicule'] || null,

    toName:         toFields['Nom'] || toFields['Nom contact'] || nth('Nom', 1),
    toStreet:       toFields['Rue'] || nth('Rue', 1),
    toZip:          toFields['Code postal'] || nth('Code postal', 1),
    toCity:         toFields['Ville'] || nth('Ville', 1),
    toPhone:        toPhoneFinal,

    clientName:     generalFields['Nom du client'] || generalFields['Client'] || null,
    clientPhone:    generalPhoneFinal,
    interventionAt: generalFields['À'] || generalFields['A'] || null,

    vehiclePlate:   vehicleFields['Immatriculation'] || null,
    vehicleBrand,
    vehicleModel,
    vehicleVin:     vehicleFields['Numéro de châssis'] || vehicleFields['VIN'] || null,
    vehicleYear:    vehicleFields['Année de construction'] || null,
    vehicleColor:   vehicleFields['Couleur'] || null,
    vehicleFuel:    vehicleFields['Carburant'] || null,
    vehicleTraction: vehicleFields['Traction'] || null,
    vehicleCategory: vehicleCategorie,

    rawSnippet: [
      `taskType=${taskTypeRaw} codes=${codesDePanne || 'n/a'}`,
      `from(${Object.keys(fromFields).length}): ${JSON.stringify(fromFields)}`,
      `to(${Object.keys(toFields).length}): ${JSON.stringify(toFields)}`,
      `gen(${Object.keys(generalFields).length}): ${JSON.stringify(generalFields)}`,
      `veh(${Object.keys(vehicleFields).length}): ${JSON.stringify(vehicleFields)}`,
      `phones: from=${fromPhoneFinal || '∅'} to=${toPhoneFinal || '∅'} gen=${generalPhoneFinal || '∅'}`,
    ].join('\n').slice(0, 3000),
  }

  return detail
}

/**
 * Helper : extract tous les hidden inputs d'un form (cheerio).
 */
function getHiddenFields($: cheerio.CheerioAPI, $form: any): Record<string, string> {
  const fields: Record<string, string> = {}
  $form.find('input[type="hidden"]').each((_idx: number, el: any) => {
    const n = $(el).attr('name')
    const v = $(el).attr('value') ?? ''
    if (n) fields[n] = v
  })
  return fields
}

/**
 * Helper : envoie un postback ASP.NET en simulant un __doPostBack.
 * Renvoie le HTML resultant.
 */
async function aspnetPostBack(
  url: string,
  formAction: string,
  hidden: Record<string, string>,
  eventTarget: string,
  eventArgument: string,
  extraFields: Record<string, string>,
  cookieHeader: string,
  referer: string,
): Promise<{ html: string; status: number; finalUrl: string }> {
  const body = new URLSearchParams()
  // Reinjecte tous les hidden fields (CRITIQUE pour __VIEWSTATE et compagnie)
  for (const [k, v] of Object.entries(hidden)) body.set(k, v)
  // Force __EVENTTARGET / __EVENTARGUMENT pour simuler le __doPostBack JS
  body.set('__EVENTTARGET', eventTarget)
  body.set('__EVENTARGUMENT', eventArgument)
  // Ajoute les champs supplementaires (Email destinataire, Langue, etc.)
  for (const [k, v] of Object.entries(extraFields)) body.set(k, v)

  const submitUrl = formAction.startsWith('http')
    ? formAction
    : new URL(formAction, url).toString()

  const res = await fetch(submitUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent':      REAL_UA,
      'Content-Type':    'application/x-www-form-urlencoded',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8',
      'Cookie':          cookieHeader,
      'Referer':         referer,
      'Origin':          VAB_BASE,
    },
    body: body.toString(),
  })
  const html = await res.text()
  return { html, status: res.status, finalUrl: res.url }
}

/**
 * Declenche l'envoi par email d'une mission VAB via double postback ASP.NET.
 *
 * Le flow UI :
 * 1. GET page detail → capture __VIEWSTATE etc.
 * 2. POST postback "Email" button → page rerenderee avec modal email ouverte
 * 3. POST postback "D'accord" + champ Email + Langue → vrai envoi
 *
 * ASP.NET WebForms : chaque postback inclut TOUS les hidden inputs +
 * __EVENTTARGET = name du control declencheur (avec $ remplaces par : dans
 * certains cas, sinon le name brut).
 */
export async function sendVabMissionEmail(
  session:        SessionCookies,
  detailHref:     string,
  destinationEmail: string,
): Promise<{ ok: true; debug?: string } | { ok: false; error: string; debug?: string }> {
  const detailUrl = detailHref.startsWith('http')
    ? detailHref
    : `${VAB_BASE}${detailHref.startsWith('/') ? detailHref : '/' + detailHref}`

  const debugLog: string[] = []

  // ─── Etape 1 : GET page detail ─────────────────────────────────
  const detailRes = await fetch(detailUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'User-Agent':      REAL_UA,
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8',
      'Cookie':          session.cookieHeader,
    },
  })
  if (detailRes.status !== 200) {
    return { ok: false, error: `GET detail ${detailUrl} status ${detailRes.status}` }
  }
  const detailHtml = await detailRes.text()
  const $1 = cheerio.load(detailHtml)
  const form1 = $1('form').first()
  if (form1.length === 0) {
    return { ok: false, error: 'Pas de form trouve sur la page detail' }
  }
  const action1 = form1.attr('action') || detailUrl
  const hidden1 = getHiddenFields($1, form1)
  debugLog.push(`step1 hidden=${Object.keys(hidden1).length}`)

  // Cherche le bouton/lien "Email"
  let emailEventTarget: string | null = null
  let emailButtonName: string | null = null
  let emailButtonValue: string | null = null
  form1.find('input[type="submit"], input[type="button"], button, a').each((_idx, el) => {
    if (emailEventTarget || emailButtonName) return
    const $el = $1(el)
    const txt = $el.text().toLowerCase().trim()
    const val = ($el.attr('value') || '').toLowerCase().trim()
    const isEmailBtn = txt === 'email' || val === 'email' ||
      (txt.includes('email') && txt.length < 20) ||
      (val.includes('email') && val.length < 20)
    if (!isEmailBtn) return
    // Si c'est un LinkButton, le href contient __doPostBack('UniqueID','')
    const href = $el.attr('href') || ''
    const doPostBack = href.match(/__doPostBack\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/i)
    if (doPostBack) {
      emailEventTarget = doPostBack[1]
      debugLog.push(`step1 found LinkButton -> EVENTTARGET=${emailEventTarget}`)
    } else {
      // Si c'est un submit/button normal : name=value direct
      emailButtonName = $el.attr('name') || null
      emailButtonValue = $el.attr('value') || $el.text().trim() || 'Email'
      debugLog.push(`step1 found Button -> ${emailButtonName}=${emailButtonValue}`)
    }
  })

  if (!emailEventTarget && !emailButtonName) {
    return { ok: false, error: 'Bouton Email introuvable sur la page detail', debug: debugLog.join(' | ') }
  }

  // ─── Etape 2 : POST postback "Email" → ouvre la modal ─────────
  const extraStep2: Record<string, string> = {}
  if (emailButtonName) {
    extraStep2[emailButtonName] = emailButtonValue || 'Email'
  }
  const eventTarget1 = emailEventTarget || ''
  const post1 = await aspnetPostBack(detailUrl, action1, hidden1, eventTarget1, '', extraStep2, session.cookieHeader, detailUrl)
  debugLog.push(`step2 status=${post1.status}`)
  if (post1.status !== 200 && post1.status !== 302) {
    return { ok: false, error: `Postback Email status ${post1.status}`, debug: debugLog.join(' | ') }
  }

  // ─── Etape 3 : parse la modal email (nouveau form avec input destinataire + bouton D'accord) ─
  const $2 = cheerio.load(post1.html)
  const form2 = $2('form').first()
  if (form2.length === 0) {
    return { ok: false, error: 'Pas de form apres postback Email', debug: debugLog.join(' | ') }
  }
  const action2 = form2.attr('action') || detailUrl
  const hidden2 = getHiddenFields($2, form2)
  debugLog.push(`step3 hidden=${Object.keys(hidden2).length}`)

  // Trouve le champ email
  let emailFieldName: string | null = null
  form2.find('input[type="email"], input[type="text"]').each((_idx, el) => {
    if (emailFieldName) return
    const $el = $2(el)
    const name = $el.attr('name') || ''
    const id = $el.attr('id') || ''
    if (/email|adresse|mail/i.test(name) || /email|adresse|mail/i.test(id)) {
      emailFieldName = name
      debugLog.push(`step3 emailField=${name}`)
    }
  })

  // Trouve le champ langue (select)
  let langueFieldName: string | null = null
  let langueFRValue: string | null = null
  form2.find('select').each((_idx, el) => {
    if (langueFieldName) return
    const $el = $2(el)
    const name = $el.attr('name') || ''
    const id = $el.attr('id') || ''
    if (/lang|langue/i.test(name) || /lang|langue/i.test(id)) {
      langueFieldName = name
      // Trouve la valeur "FR" / "Francais"
      $el.find('option').each((_i, opt) => {
        if (langueFRValue) return
        const $opt = $2(opt)
        const val = $opt.attr('value') || ''
        const text = $opt.text().toLowerCase()
        if (val.toLowerCase() === 'fr' || /fran[çc]ais/i.test(text)) {
          langueFRValue = val
        }
      })
      debugLog.push(`step3 langueField=${name} val=${langueFRValue}`)
    }
  })

  // Trouve le bouton "D'accord"
  let okEventTarget: string | null = null
  let okButtonName: string | null = null
  let okButtonValue: string | null = null
  form2.find('input[type="submit"], input[type="button"], button, a').each((_idx, el) => {
    if (okEventTarget || okButtonName) return
    const $el = $2(el)
    const txt = $el.text().toLowerCase().trim()
    const val = ($el.attr('value') || '').toLowerCase().trim()
    const isOk = txt.includes('accord') || val.includes('accord') ||
      txt.includes("d'accord") || val.includes("d'accord")
    if (!isOk) return
    const href = $el.attr('href') || ''
    const doPostBack = href.match(/__doPostBack\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/i)
    if (doPostBack) {
      okEventTarget = doPostBack[1]
      debugLog.push(`step3 ok LinkButton -> ${okEventTarget}`)
    } else {
      okButtonName = $el.attr('name') || null
      okButtonValue = $el.attr('value') || $el.text().trim() || "D'accord"
      debugLog.push(`step3 ok Button -> ${okButtonName}=${okButtonValue}`)
    }
  })

  if (!okEventTarget && !okButtonName) {
    return { ok: false, error: 'Bouton "D\'accord" introuvable apres postback Email', debug: debugLog.join(' | ') }
  }

  // ─── Etape 4 : POST postback "D'accord" → vrai envoi ─────────
  const extraStep4: Record<string, string> = {}
  if (emailFieldName) extraStep4[emailFieldName] = destinationEmail
  if (langueFieldName && langueFRValue) extraStep4[langueFieldName] = langueFRValue
  if (okButtonName) extraStep4[okButtonName] = okButtonValue || "D'accord"
  const eventTarget2 = okEventTarget || ''
  const post2 = await aspnetPostBack(detailUrl, action2, hidden2, eventTarget2, '', extraStep4, session.cookieHeader, detailUrl)
  debugLog.push(`step4 status=${post2.status}`)

  if (post2.status !== 200 && post2.status !== 302 && post2.status !== 303) {
    return { ok: false, error: `Postback D'accord status ${post2.status}`, debug: debugLog.join(' | ') }
  }

  // Verifie si la reponse contient un message de succes/erreur
  const responseText = post2.html.slice(0, 500).toLowerCase()
  if (/erreur|invalid|incorrect/i.test(responseText)) {
    return { ok: false, error: `Reponse contient erreur. Snippet: ${post2.html.slice(0, 300)}`, debug: debugLog.join(' | ') }
  }

  console.log(`[vab/send] OK pour ${detailHref}. Debug: ${debugLog.join(' | ')}`)
  return { ok: true, debug: debugLog.join(' | ') }
}

/**
 * DÉCOUVERTE READ-ONLY (aucune action déclenchée) : GET la page détail et
 * inventorie tous les contrôles d'action (boutons/liens __doPostBack), les
 * hidden fields et l'action du form. Sert à cartographier la machine à états
 * VAB (Accept → Start → En route → Sur place → CheckVIN → signature → clôture)
 * AVANT de coder/déclencher quoi que ce soit (irréversible). Olivier 2026-08-08.
 */
export interface VabActionsDump {
  ok: boolean; error?: string; formAction?: string | null; htmlLen?: number
  message?: string | null   // message OutSystems visible (feedback/confirmation)
  hiddenNames?: string[]
  actions?: Array<{ label: string; target: string | null; arg: string; tag: string; name?: string; id?: string }>
  buttonTexts?: string[]
  buttons?: Array<{ text: string; id: string | null; name: string | null; target: string | null; onclick: string; href: string; tag: string }>
  postbackTargets?: string[]
  inputs?: Array<{ name: string; type: string; id: string | null; placeholder: string | null; value: string }>
  pageText?: string   // texte visible (modale/contenu) — pour lire ex. Contrat (REM/VR/jours)
}

// Parse une page VAB (détail mission) → boutons/actions/champs/message.
// Partagé par dumpVabActions (GET) et executeVabAction (résultat du POST).
function parseVabActions(html: string): Omit<VabActionsDump, 'ok' | 'error'> {
  const $ = cheerio.load(html)

  const hiddenNames: string[] = []
  $('input[type=hidden]').each((_, el) => { const n = $(el).attr('name'); if (n) hiddenNames.push(n) })

  // Extrait le __EVENTTARGET (+arg) d'un onclick/href : __doPostBack('T','A')
  // OU OsAjax(evt,'clientId','T','A',...) — VAB utilise surtout OsAjax (le 3e
  // argument = l'UniqueID serveur avec des $ = le vrai __EVENTTARGET).
  const extractTarget = (blob: string): { target: string; arg: string } | null => {
    const pb = blob.match(/__doPostBack\((?:&#39;|['"])([^'"&]+)(?:&#39;|['"])\s*,\s*(?:&#39;|['"])([^'"&]*)/)
    if (pb) return { target: pb[1], arg: pb[2] || '' }
    const os = blob.match(/OsAjax\([^,]+,\s*(?:&#39;|['"])[^'"&]*(?:&#39;|['"])\s*,\s*(?:&#39;|['"])([^'"&]+)(?:&#39;|['"])\s*,\s*(?:&#39;|['"])([^'"&]*)/)
    if (os) return { target: os[1], arg: os[2] || '' }
    return null
  }

  const actions: NonNullable<VabActionsDump['actions']> = []
  const seen = new Set<string>()
  $('a, button, input[type=submit], input[type=button], span[onclick], div[onclick]').each((_, el) => {
    const $el = $(el)
    const blob = `${$el.attr('onclick') || ''} ${$el.attr('href') || ''}`
    const ext = extractTarget(blob)
    const name = $el.attr('name')
    const isBtn = $el.is('input[type=submit]') || $el.is('input[type=button]') || $el.is('button')
    if (!ext && !(isBtn && name)) return
    const label = (($el.text() || '') || $el.attr('value') || '').replace(/\s+/g, ' ').trim().slice(0, 70)
    const target = ext ? ext.target : (name || null)
    const key = `${target}|${label}`
    if (seen.has(key)) return
    seen.add(key)
    actions.push({ label, target, arg: ext ? ext.arg : '', tag: (el as any).tagName, name, id: $el.attr('id') })
  })

  const buttonTexts: string[] = []
  $('.Button, [class*=Button], [class*=btn]').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim()
    if (t && t.length < 40 && !buttonTexts.includes(t)) buttonTexts.push(t)
  })

  const buttons: NonNullable<VabActionsDump['buttons']> = []
  const bseen = new Set<string>()
  $('.Button, [class*=Button], a[class*=Link], a[href^="javascript"], a[onclick], input[type=submit], input[type=button]').each((_, el) => {
    const $el = $(el)
    const text = (($el.text() || '') || $el.attr('value') || '').replace(/\s+/g, ' ').trim()
    if (!text || text.length > 45) return
    const id = $el.attr('id') || null
    const key = `${text}|${id}`
    if (bseen.has(key)) return
    bseen.add(key)
    const onclick = ($el.attr('onclick') || '')
    const ext = extractTarget(`${onclick} ${$el.attr('href') || ''}`)
    buttons.push({ text, id, name: $el.attr('name') || null, target: ext ? ext.target : ($el.attr('name') || null), onclick: onclick.slice(0, 240), href: ($el.attr('href') || '').slice(0, 160), tag: (el as any).tagName })
  })

  // Champs saisissables visibles (km, VIN, signature…) — pour piloter les étapes.
  const inputs: NonNullable<VabActionsDump['inputs']> = []
  $('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select').each((_, el) => {
    const $el = $(el)
    const name = $el.attr('name'); if (!name) return
    inputs.push({ name, type: ($el.attr('type') || (el as any).tagName || '').toLowerCase(), id: $el.attr('id') || null, placeholder: $el.attr('placeholder') || null, value: ($el.attr('value') || '').slice(0, 60) })
  })

  const pbAll = [...html.matchAll(/__doPostBack\(\s*['"]([^'"]+)['"]/g)].map(m => m[1])
  const osAll = [...html.matchAll(/OsAjax\([^,]+,\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]/g)].map(m => m[1])
  const postbackTargets = [...new Set([...pbAll, ...osAll])].slice(0, 120)

  // Message OutSystems (feedback/toast) éventuel.
  let message: string | null = null
  $('.Feedback_Message, [class*=Feedback], .OSFillParent .Text, .feedbackmessagewrapper').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim()
    if (t && t.length < 200 && !message) message = t
  })

  // Texte visible (modale en priorité, sinon contenu) — pour lire ex. le Contrat
  // (REM/VR possible + nb de jours max) après un clic.
  $('script, style').remove()
  const modalTxt = $('[class*=Modal], [class*=Popup], [class*=modal], [class*=popup], [class*=Dialog]').text().replace(/\s+/g, ' ').trim()
  const contentTxt = $('[class*=Content], .MainContent, main').text().replace(/\s+/g, ' ').trim()
  const pageText = (modalTxt.length > 20 ? modalTxt : contentTxt || $('body').text().replace(/\s+/g, ' ').trim()).slice(0, 4000)

  return { formAction: $('form').attr('action') || null, htmlLen: html.length, message, pageText, hiddenNames, actions, buttonTexts: buttonTexts.slice(0, 40), buttons, postbackTargets, inputs: inputs.slice(0, 40) }
}

// Collecte les valeurs des hidden inputs d'une page (pour ré-échoyer __OSVSTATE
// & co. dans le POST de l'action suivante).
function collectHidden(html: string): Record<string, string> {
  const $ = cheerio.load(html)
  const hidden: Record<string, string> = {}
  $('input[type=hidden]').each((_, el) => { const n = $(el).attr('name'); if (n) hidden[n] = $(el).attr('value') || '' })
  return hidden
}

/**
 * EXÉCUTE une action VAB (postback OutSystems) sur la mission courante.
 * GET la page (état + OSVSTATE frais) → POST le postback (__EVENTTARGET + tous
 * les hidden ré-échoyés + champs extra) → parse la page résultat (nouveaux
 * boutons + message). ⚠️ IRRÉVERSIBLE côté VAB : à déclencher en connaissance.
 * Olivier 2026-08-08 (clôture pilotée avec Franck).
 */
export async function executeVabAction(
  session: SessionCookies,
  detailHref: string,
  eventTarget: string,
  extraFields: Record<string, string> = {},
  eventArgument = '',
): Promise<VabActionsDump & { status?: number }> {
  const detailUrl = detailHref.startsWith('http')
    ? detailHref
    : `${VAB_BASE}${detailHref.startsWith('/') ? detailHref : '/' + detailHref}`
  // 1) GET état frais
  const getRes = await fetch(detailUrl, {
    method: 'GET', redirect: 'follow',
    headers: { 'User-Agent': REAL_UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'fr-BE,fr;q=0.9', 'Cookie': session.cookieHeader },
  })
  if (getRes.status !== 200) return { ok: false, error: `GET status ${getRes.status}` }
  const getHtml = await getRes.text()
  const hidden = collectHidden(getHtml)
  const formAction = cheerio.load(getHtml)('form').attr('action') || detailUrl
  // 2) POST postback (ré-écho de tous les hidden dont __OSVSTATE)
  const pb = await aspnetPostBack(detailUrl, formAction, hidden, eventTarget, eventArgument, extraFields, session.cookieHeader, detailUrl)
  // OutSystems peut répondre en 302 (redirect manual) → suivre pour récupérer l'état.
  let resultHtml = pb.html
  if (pb.status >= 300 && pb.status < 400) {
    const loc = pb.finalUrl || detailUrl
    const follow = await fetch(loc.startsWith('http') ? loc : `${VAB_BASE}/${loc.replace(/^\//, '')}`, {
      headers: { 'User-Agent': REAL_UA, 'Accept': 'text/html,*/*;q=0.8', 'Cookie': session.cookieHeader },
    })
    resultHtml = await follow.text()
  }
  return { ok: true, status: pb.status, ...parseVabActions(resultHtml) }
}

export async function dumpVabActions(
  session: SessionCookies,
  detailHref: string,
): Promise<VabActionsDump> {
  const detailUrl = detailHref.startsWith('http')
    ? detailHref
    : `${VAB_BASE}${detailHref.startsWith('/') ? detailHref : '/' + detailHref}`
  const res = await fetch(detailUrl, {
    method: 'GET', redirect: 'follow',
    headers: { 'User-Agent': REAL_UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'fr-BE,fr;q=0.9', 'Cookie': session.cookieHeader },
  })
  if (res.status !== 200) return { ok: false, error: `GET status ${res.status}` }
  const html = await res.text()
  return { ok: true, ...parseVabActions(html) }
}
