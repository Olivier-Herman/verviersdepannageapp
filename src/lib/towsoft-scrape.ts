// src/lib/towsoft-scrape.ts
//
// Scraping d une fiche mission Towsoft par numero. Port direct de
// Verviers-QR pages/api/inventory/scrape.js. Login simple via session
// cookie (pas de Puppeteer/Browserless requis pour la lecture).
//
// Env vars deja en place : TOWSOFT_USER + TOWSOFT_PASS.

const TOWSOFT_URL  = process.env.TOWSOFT_URL || 'https://verviers.towsoft.ca'
const TOWSOFT_USER = process.env.TOWSOFT_USER || 'VDBot'
const TOWSOFT_PASS = process.env.TOWSOFT_PASS

export interface TowsoftMissionInfo {
  missionNum:  string
  refDossier:  string | null
  dateMission: string | null
  marque:      string | null
  modele:      string | null
  plaque:      string | null
  vin:         string | null
  motif:       string | null
  parc:        string | null
}

// Cache session cookie (1 par process, dure ~1h cote Towsoft)
let cachedCookie: string | null = null

async function loginTowsoft(): Promise<string> {
  if (!TOWSOFT_PASS) throw new Error('TOWSOFT_PASS manquant en env vars')
  const res = await fetch(`${TOWSOFT_URL}/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `nomusager=${encodeURIComponent(TOWSOFT_USER)}&passusager=${encodeURIComponent(TOWSOFT_PASS)}`,
    redirect: 'manual',
  })
  const cookie = res.headers.get('set-cookie')
  if (!cookie) throw new Error('Login Towsoft echoue (pas de cookie en reponse)')
  // Prend uniquement le 1er segment (avant le premier `;`)
  return cookie.split(';')[0]
}

async function getCookie(): Promise<string> {
  if (!cachedCookie) cachedCookie = await loginTowsoft()
  return cachedCookie
}

function extractDataAttr(html: string, attr: string): string | null {
  const match = html.match(new RegExp(`data-${attr}="([^"]*)"`, 'i'))
  return match ? match[1] : null
}

function extractById(html: string, id: string): string | null {
  const match = html.match(new RegExp(`<td[^>]*id="${id}"[^>]*>([^<]*)<`, 'i'))
  return match ? match[1].trim() : null
}

function extractParcMotif(html: string): { motif: string | null; parc: string | null } {
  const motifMatch = html.match(/<td><strong>MotifParc<\/strong><\/td>\s*<td[^>]*>([^<]*)<\/td>/i)
  const parcMatch  = html.match(/data-lafourriere[^>]*>\s*([^<]+)\s*</i)
  const parcMatch2 = html.match(/Parc\s+([^<\n]{5,60})</i)
  return {
    motif: motifMatch ? motifMatch[1].trim() : null,
    parc:  parcMatch ? parcMatch[1].trim() : (parcMatch2 ? parcMatch2[1].trim() : null),
  }
}

/**
 * Lit une fiche mission Towsoft par numero. Best-effort.
 * Re-login automatique si la session expire.
 */
export async function scrapeTowsoftMission(num: string | number): Promise<TowsoftMissionInfo> {
  const missionNum = String(num).trim()
  if (!missionNum) throw new Error('Numero de mission requis')

  let cookie = await getCookie()
  let response = await fetch(`${TOWSOFT_URL}/appel.php?num=${missionNum}`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  })

  // Re-login si la session a expire
  if (response.status === 302 || (response.headers.get('location') || '').includes('login')) {
    cachedCookie = null
    cookie = await getCookie()
    response = await fetch(`${TOWSOFT_URL}/appel.php?num=${missionNum}`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    })
  }

  const html = await response.text()
  if (html.includes('auth/login') || html.includes('nomusager')) {
    cachedCookie = null
    throw new Error('Session Towsoft expiree, reessaye')
  }

  // Extraction des donnees depuis les data-attributes + tables HTML
  const missionId   = extractDataAttr(html, 'appel-id') || extractDataAttr(html, 'facture-no')
  const refDossier  = extractDataAttr(html, 'po')
  const dateMission = extractDataAttr(html, 'date-appel')
  const marque      = extractDataAttr(html, 'vehicule-marque') || extractById(html, 'marque')
  const plaque      = extractDataAttr(html, 'vehicule-immatricultation') || extractById(html, 'plaque')
  const modele      = extractById(html, 'modele')
  const vin         = extractById(html, 'serie')
  const { motif, parc } = extractParcMotif(html)

  if (!missionId && !plaque) {
    throw new Error('Mission introuvable ou acces refuse')
  }

  return {
    missionNum:  missionId || missionNum,
    refDossier:  refDossier || null,
    dateMission: dateMission || null,
    marque:      marque || null,
    modele:      modele || null,
    plaque:      plaque || null,
    vin:         vin || null,
    motif:       motif || null,
    parc:        parc || null,
  }
}
