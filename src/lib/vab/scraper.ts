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
  for (const cand of candidateLinks) {
    // Extract AssignmentId depuis l'URL (toujours dispo)
    const aidMatch = cand.href.match(/[?&]AssignmentId=(\d+)/i)
    const assignmentId = aidMatch ? aidMatch[1] : null

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
    debugLog.push(`cand-ok: ${missionNumber} via ${scopeUsed}`)

    // Dedup
    if (missions.some(m => m.missionNumber === missionNumber)) continue

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
 * Declenche l'envoi par email d'une mission VAB.
 *
 * Le flow UI :
 * 1. Ouvre la page de detail (peut requerir cookie + token)
 * 2. Clique "Email" → modal "Envoyer mission"
 * 3. Click "D'accord" → POST avec langue=FR + email destinataire
 *
 * On simule en HTTP : GET detail → extract eventuel CSRF → POST email form.
 *
 * NB: on ne connait pas l'URL exacte du POST email — premiere tentative :
 *   /Mission/SendEmail/{id} ou similaire (a ajuster si fail).
 */
export async function sendVabMissionEmail(
  session:        SessionCookies,
  detailHref:     string,
  destinationEmail: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 1. Resoud l'URL absolue du detail
  const detailUrl = detailHref.startsWith('http')
    ? detailHref
    : `${VAB_BASE}${detailHref.startsWith('/') ? detailHref : '/' + detailHref}`

  // 2. GET detail pour recuperer CSRF + cookies a jour
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
  const $ = cheerio.load(detailHtml)

  // Extract CSRF token si present
  let csrfToken: string | null = null
  let csrfFieldName: string | null = null
  const csrfCandidates = [
    'input[name="_token"]',
    'input[name="__RequestVerificationToken"]',
    'input[type="hidden"][name*="token" i]',
  ]
  for (const sel of csrfCandidates) {
    const el = $(sel).first()
    const val = el.attr('value')
    const name = el.attr('name')
    if (val && name) {
      csrfToken = val
      csrfFieldName = name
      break
    }
  }

  // Cherche le formulaire d'envoi email pour determiner l'action URL exacte.
  // Strategy : trouver un <form> contenant un input "email" ou un bouton "D'accord".
  let emailFormAction = '' as string
  $('form').each((_idx, form) => {
    if (emailFormAction) return
    const $form = $(form)
    const hasEmailInput = $form.find('input[type="email"], input[name*="email" i], input[name*="adresse" i]').length > 0
    const hasOkButton = $form.find('button, input[type="submit"]').toArray().some(btn => {
      const txt = $(btn).text().toLowerCase() + ($(btn).attr('value') || '').toLowerCase()
      return txt.includes('accord') || txt.includes('ok') || txt.includes('envoyer')
    })
    if (hasEmailInput || hasOkButton) {
      emailFormAction = $form.attr('action') || ''
    }
  })

  // Fallback : tente /Mission/SendEmail/{id} avec l'id extrait de detailHref
  const idMatch = detailHref.match(/(\d{5,})(?:[^\d]|$)/)
  const fallbackUrl = idMatch ? `${VAB_BASE}/Mission/SendEmail/${idMatch[1]}` : null

  const submitUrl = emailFormAction
    ? (emailFormAction.startsWith('http') ? emailFormAction
       : `${VAB_BASE}${emailFormAction.startsWith('/') ? emailFormAction : '/' + emailFormAction}`)
    : fallbackUrl

  if (!submitUrl) {
    return { ok: false, error: 'Impossible de determiner l URL de submission email' }
  }

  // 3. POST submit avec langue + email
  const body = new URLSearchParams()
  body.set('Email', destinationEmail)
  body.set('email', destinationEmail)
  body.set('Adresse électronique', destinationEmail)
  body.set('Langue', 'FR')
  body.set('Language', 'FR')
  if (csrfToken && csrfFieldName) body.set(csrfFieldName, csrfToken)

  const sendRes = await fetch(submitUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent':      REAL_UA,
      'Content-Type':    'application/x-www-form-urlencoded',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8',
      'Cookie':          session.cookieHeader,
      'Referer':         detailUrl,
      'Origin':          VAB_BASE,
    },
    body: body.toString(),
  })

  if (sendRes.status !== 200 && sendRes.status !== 302 && sendRes.status !== 303) {
    const text = await sendRes.text().catch(() => '')
    return { ok: false, error: `POST email ${submitUrl} status ${sendRes.status}. Body: ${text.slice(0, 300)}` }
  }

  console.log(`[vab/send] OK pour ${detailHref}`)
  return { ok: true }
}
