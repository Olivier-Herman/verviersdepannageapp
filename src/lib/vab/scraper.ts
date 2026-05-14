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

interface ScrapedMission {
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
 * Parse les headers Set-Cookie d'une reponse en cookie header reutilisable.
 * Garde uniquement les paires name=value (drop des attributs Path, Expires, ...).
 */
function parseCookies(res: Response): string {
  const setCookies = res.headers.getSetCookie?.() || []
  if (setCookies.length === 0) {
    const single = res.headers.get('set-cookie')
    if (single) setCookies.push(single)
  }
  const pairs: string[] = []
  for (const c of setCookies) {
    const firstPair = c.split(';')[0]?.trim()
    if (firstPair) pairs.push(firstPair)
  }
  return pairs.join('; ')
}

/**
 * Login sur comet.vab.be. Retourne un cookie de session reutilisable.
 *
 * Le formulaire de login VAB est /login (vu sur le screenshot).
 * Champs : Username + Password (POST URL-encoded).
 * Le serveur retourne 302 vers /Missions avec un cookie de session.
 */
export async function loginVab(): Promise<SessionCookies> {
  const username = process.env.VAB_EMAIL
  const password = process.env.VAB_PASSWORD
  if (!username || !password) {
    throw new Error('VAB_EMAIL et VAB_PASSWORD env vars sont requis')
  }

  // 1. GET /login pour recuperer le cookie initial + un eventuel CSRF token
  const initRes = await fetch(`${VAB_BASE}/login`, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'User-Agent':      'Mozilla/5.0 (compatible; Verviers-App/1.0)',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8',
    },
  })
  const initCookies = parseCookies(initRes)

  // Cherche un eventuel CSRF token dans le HTML (input hidden)
  let csrfToken: string | null = null
  let csrfFieldName: string | null = null
  try {
    const html = await initRes.text()
    const $ = cheerio.load(html)
    // Try common csrf field names
    const candidates = [
      'input[name="_token"]',
      'input[name="__RequestVerificationToken"]',
      'input[name="csrf_token"]',
      'input[name="authenticity_token"]',
      'input[name="csrfmiddlewaretoken"]',
      'input[type="hidden"][name*="token" i]',
    ]
    for (const sel of candidates) {
      const el = $(sel).first()
      const val = el.attr('value')
      const name = el.attr('name')
      if (val && name) {
        csrfToken = val
        csrfFieldName = name
        break
      }
    }
  } catch (e: any) {
    console.warn('[vab/login] init HTML parse failed (continue without CSRF):', e.message)
  }

  // 2. POST /login avec creds + eventuel CSRF
  const formData = new URLSearchParams()
  formData.set('Username', username)
  formData.set('Password', password)
  // Ajoute aussi des variants de noms communs (le serveur peut etre case-sensitive)
  formData.set('username', username)
  formData.set('password', password)
  formData.set('email', username)
  if (csrfToken && csrfFieldName) formData.set(csrfFieldName, csrfToken)

  const loginRes = await fetch(`${VAB_BASE}/login`, {
    method: 'POST',
    redirect: 'manual',  // important : on veut le Set-Cookie de la 302
    headers: {
      'User-Agent':      'Mozilla/5.0 (compatible; Verviers-App/1.0)',
      'Content-Type':    'application/x-www-form-urlencoded',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8',
      'Cookie':          initCookies,
      'Referer':         `${VAB_BASE}/login`,
      'Origin':          VAB_BASE,
    },
    body: formData.toString(),
  })

  // 302 vers /Missions = success. 200 = login KO (re-render formulaire avec erreur).
  if (loginRes.status !== 302 && loginRes.status !== 303) {
    const body = await loginRes.text().catch(() => '')
    const snippet = body.slice(0, 500)
    throw new Error(`VAB login echec (status ${loginRes.status}). HTML: ${snippet}`)
  }

  const sessionCookies = parseCookies(loginRes)
  if (!sessionCookies) {
    throw new Error('VAB login : aucun cookie de session retourne')
  }

  // Combine init cookies + session cookies pour les requetes suivantes
  const allCookies = [initCookies, sessionCookies].filter(Boolean).join('; ')
  console.log(`[vab/login] OK, cookie set (${allCookies.length} bytes)`)
  return { cookieHeader: allCookies }
}

/**
 * Liste les missions visibles sur la page /Missions de COMET.
 * Parse la table HTML pour extraire chaque ligne.
 */
export async function listVabMissions(session: SessionCookies): Promise<ScrapedMission[]> {
  const res = await fetch(`${VAB_BASE}/Missions`, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'User-Agent':      'Mozilla/5.0 (compatible; Verviers-App/1.0)',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8',
      'Cookie':          session.cookieHeader,
    },
  })

  if (res.status !== 200) {
    const body = await res.text().catch(() => '')
    throw new Error(`VAB /Missions echec (status ${res.status}). Snippet: ${body.slice(0, 300)}`)
  }

  const html = await res.text()
  const $ = cheerio.load(html)

  const missions: ScrapedMission[] = []

  // Strategy : trouver toutes les <tr> de la table missions.
  // On cherche les rows qui ont une cellule "N° DE MISSION" (numerique).
  // Robuste a la structure exacte : on parcourt toutes les tr et on filtre.
  $('table tr').each((_idx, tr) => {
    const cells = $(tr).find('td')
    if (cells.length < 4) return // header ou ligne vide

    // Hypothese : 1ere cellule = N° mission (numerique pur)
    const firstText = $(cells[0]).text().trim()
    const missionNumber = firstText.match(/^\d{5,}$/) ? firstText : null
    if (!missionNumber) return

    // Cherche le bouton Detail dans la derniere cellule (action)
    let detailHref: string | null = null
    $(tr).find('a').each((__, a) => {
      const href = $(a).attr('href') || ''
      const text = $(a).text().toLowerCase()
      if (text.includes('détail') || text.includes('detail') || href.toLowerCase().includes('details') || href.toLowerCase().includes('detail')) {
        detailHref = href
      }
    })

    // Extrait les autres cellules selon l'ordre vu sur le screenshot :
    // [0] N° DE MISSION | [1] TYPE DE TÂCHE | [2] DATE DISPATCH | [3] STATUS |
    // [4] UTILISATEUR | [5] LOCALISATION DE | [6] LOCALISATION À | [7] TYPE VÉHICULE | [8] FOURNISSEUR | [9] actions
    const taskType     = cells.length > 1 ? $(cells[1]).text().trim() : null
    const dispatchDate = cells.length > 2 ? $(cells[2]).text().trim() : null
    const status       = cells.length > 3 ? $(cells[3]).text().trim() : null
    // Pour plate : type vehicule contient la plaque selon le screenshot (col 7)
    const vehColIdx    = cells.length > 7 ? 7 : (cells.length - 3)
    const vehCellHtml  = cells.length > vehColIdx ? $(cells[vehColIdx]).text().trim() : null
    // La plaque suit le modele/marque sur 2 lignes — on prend la derniere
    const plate        = vehCellHtml ? vehCellHtml.split(/\s+/).filter(Boolean).pop() || null : null

    const fromLocation = cells.length > 5 ? $(cells[5]).text().trim().replace(/\s+/g, ' ') : null
    const toLocation   = cells.length > 6 ? $(cells[6]).text().trim().replace(/\s+/g, ' ') : null

    missions.push({
      missionNumber,
      detailHref,
      taskType,
      dispatchDate,
      status,
      plate,
      fromLocation,
      toLocation,
    })
  })

  console.log(`[vab/list] ${missions.length} mission(s) trouvee(s)`)
  return missions
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
      'User-Agent':      'Mozilla/5.0 (compatible; Verviers-App/1.0)',
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
      'User-Agent':      'Mozilla/5.0 (compatible; Verviers-App/1.0)',
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
