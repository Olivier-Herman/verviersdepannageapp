// src/lib/towsoft-scrape-puppeteer.ts
//
// Scraping d une fiche TowSoft via Browserless (Puppeteer cloud). Plus lourd
// que towsoft-scrape.ts (fetch direct) mais TowSoft semble exiger l execution
// JS pour reconnaitre la session — le fetch HTTP redirige systematiquement
// vers /login.php meme avec un cookie valide.
//
// Cout : ~10-15s + tokens Browserless par fiche scrappee. A utiliser de
// maniere ciblee (un scan = un appel max) pour ne pas exploser la facture.

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN!
const TOWSOFT_URL       = process.env.TOWSOFT_URL || 'https://verviers.towsoft.ca'
const TOWSOFT_USER      = process.env.TOWSOFT_USER!
const TOWSOFT_PASS      = process.env.TOWSOFT_PASS!

export interface TowsoftMissionInfo {
  missionNum:        string
  refDossier:        string | null
  dateMission:       string | null
  timeMission:       string | null
  marque:            string | null
  modele:            string | null
  plaque:            string | null
  vin:               string | null
  motif:             string | null
  parc:              string | null
  // Champs proprio (a parser si dispo dans le HTML)
  ownerFirstName:    string | null
  ownerLastName:     string | null
  ownerPhone:        string | null
  ownerEmail:        string | null
  ownerAddress:      string | null
  // Lieu intervention
  interventionAddr:  string | null
  // Police
  policeZone:        string | null
  officerName:       string | null
  pvNumber:          string | null
  // Assurance / facturation
  billedTo:          string | null
  remarks:           string | null
  // HTML brut pour debug eventuel
  htmlLength:        number
}

interface ScrapeResult {
  ok:    boolean
  data?: TowsoftMissionInfo
  html?: string  // si returnHtml=true (debug)
  error?: string
}

export async function scrapeTowsoftMissionPuppeteer(num: string | number, opts?: { returnHtml?: boolean }): Promise<ScrapeResult> {
  const missionNum = String(num).trim()
  if (!missionNum) return { ok: false, error: 'Numero requis' }
  if (!BROWSERLESS_TOKEN) return { ok: false, error: 'BROWSERLESS_TOKEN manquant' }
  if (!TOWSOFT_PASS)      return { ok: false, error: 'TOWSOFT_PASS manquant' }

  const returnHtml = Boolean(opts?.returnHtml)

  const script = `
    export default async function ({ page }) {
      await page.setDefaultTimeout(30000)
      // 1. Login
      await page.goto('${TOWSOFT_URL}/auth/login', { waitUntil: 'networkidle0' })
      await page.type('#nomusager', '${TOWSOFT_USER}')
      await page.type('#passusager', '${TOWSOFT_PASS}')
      await page.click('[type="submit"]')
      await page.waitForNavigation({ waitUntil: 'networkidle0' })
      // 2. Goto fiche
      await page.goto('${TOWSOFT_URL}/appel.php?num=${missionNum}', { waitUntil: 'networkidle0' })
      const html = await page.content()
      return { ok: true, html }
    }
  `

  try {
    const res = await fetch(`https://production-sfo.browserless.io/function?token=${BROWSERLESS_TOKEN}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/javascript' },
      body:    script,
    })
    if (!res.ok) {
      const err = await res.text()
      return { ok: false, error: `Browserless ${res.status} : ${err.slice(0, 300)}` }
    }
    const result = await res.json()
    if (!result?.ok || !result?.html) {
      return { ok: false, error: `Browserless retour invalide : ${JSON.stringify(result).slice(0, 300)}` }
    }
    const html = result.html as string
    const data = parseTowsoftHtml(missionNum, html)
    return { ok: true, data, html: returnHtml ? html : undefined }
  } catch (e: any) {
    return { ok: false, error: e.message || 'Erreur reseau' }
  }
}

// ───────────────────── Parsing helpers ─────────────────────

function pickData(html: string, attr: string): string | null {
  const m = html.match(new RegExp(`data-${attr}="([^"]*)"`, 'i'))
  return m ? m[1].trim() : null
}

function pickById(html: string, id: string): string | null {
  const m = html.match(new RegExp(`<[^>]+id="${id}"[^>]*>([^<]*)<`, 'i'))
  return m ? m[1].trim() : null
}

function pickByName(html: string, name: string): string | null {
  const m = html.match(new RegExp(`<input[^>]+name="${name}"[^>]*value="([^"]*)"`, 'i'))
  return m ? m[1].trim() : null
}

/**
 * Parser best-effort. Les TowSoft templates sont stables : on tape sur
 * data-attributes (data-vehicule-marque, data-po, etc.), IDs (#plaque,
 * #modele, etc.) et patterns table HTML (<td><strong>Label</strong>...</td>).
 * Tous les champs sont optionnels — retourne null si absent.
 */
function parseTowsoftHtml(missionNum: string, html: string): TowsoftMissionInfo {
  const refDossier  = pickData(html, 'po')
  const dateMission = pickData(html, 'date-appel')
  const timeMission = pickData(html, 'heure-appel')
  const marque      = pickData(html, 'vehicule-marque')      || pickById(html, 'marque')
  const plaque      = pickData(html, 'vehicule-immatricultation') || pickById(html, 'plaque')
  const modele      = pickById(html, 'modele')               || pickData(html, 'vehicule-modele')
  const vin         = pickById(html, 'serie')                || pickData(html, 'vehicule-vin')

  // Parc + motif depuis la table table
  const motifMatch = html.match(/<td><strong>MotifParc<\/strong><\/td>\s*<td[^>]*>([^<]*)<\/td>/i)
  const parcMatch  = html.match(/data-lafourriere[^>]*>\s*([^<]+)\s*</i) ||
                     html.match(/Parc\s+([^<\n]{5,60})</i)

  // Owner — TowSoft a souvent un bloc client
  const ownerFirstName = pickByName(html, 'prenom') || pickData(html, 'client-prenom')
  const ownerLastName  = pickByName(html, 'nom')    || pickData(html, 'client-nom')
  const ownerPhone     = pickByName(html, 'tel')    || pickData(html, 'client-tel')
  const ownerEmail     = pickByName(html, 'email')  || pickData(html, 'client-email')
  const ownerAddress   = pickByName(html, 'adresse') || pickData(html, 'client-adresse')

  // Lieu intervention (#lieu, data-lieu)
  const interventionAddr = pickByName(html, 'lieu') || pickById(html, 'lieu') || pickData(html, 'lieu')

  // Police
  const policeZone   = pickData(html, 'police-zone')   || pickByName(html, 'police_zone')
  const officerName  = pickData(html, 'police-agent')  || pickByName(html, 'police_agent')
  const pvNumber     = pickData(html, 'pv-num')        || pickByName(html, 'pv_num')

  // Facturé à
  const billedTo = pickByName(html, 'facture_a') || pickData(html, 'facture-a') || pickData(html, 'client-name')

  // Remarques
  const remarksMatch = html.match(/<textarea[^>]*name="remarques"[^>]*>([^<]*)<\/textarea>/i)
  const remarks = remarksMatch ? remarksMatch[1].trim() : null

  return {
    missionNum,
    refDossier:        refDossier || null,
    dateMission:       dateMission || null,
    timeMission:       timeMission || null,
    marque:            marque || null,
    modele:            modele || null,
    plaque:            plaque || null,
    vin:               vin || null,
    motif:             motifMatch ? motifMatch[1].trim() : null,
    parc:              parcMatch ? parcMatch[1].trim() : null,
    ownerFirstName:    ownerFirstName || null,
    ownerLastName:     ownerLastName || null,
    ownerPhone:        ownerPhone || null,
    ownerEmail:        ownerEmail || null,
    ownerAddress:      ownerAddress || null,
    interventionAddr:  interventionAddr || null,
    policeZone:        policeZone || null,
    officerName:       officerName || null,
    pvNumber:          pvNumber || null,
    billedTo:          billedTo || null,
    remarks,
    htmlLength:        html.length,
  }
}
