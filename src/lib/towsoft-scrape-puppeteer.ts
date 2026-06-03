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
  // N° crochet digibox ou se trouvent les cles
  keysDigiboxSlot:   string | null
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
/**
 * Strip HTML tags + decode quelques entites + normalise whitespace.
 * Permet de chercher dans le texte rendu plutot que d ecrire des regex
 * sur la structure HTML qui peut varier.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
}

/** Cherche un label + valeur dans le texte (format "Label: valeur" ou "Label valeur"). */
function findLabelValue(text: string, labels: string[], maxLen = 200): string | null {
  for (const label of labels) {
    // Pattern : "Label" suivi de ":" optionnel + whitespace + valeur jusqu a fin de ligne / next label
    const re = new RegExp(`${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*:?\\s*([^\\n\\r]{1,${maxLen}})`, 'i')
    const m = text.match(re)
    if (m) {
      const v = m[1].trim()
      if (v && v.length > 1) return v
    }
  }
  return null
}

function parseTowsoftHtml(missionNum: string, html: string): TowsoftMissionInfo {
  // ───────── data-attributes + IDs/names (rapide) ─────────
  const refDossier  = pickData(html, 'po')
  const dateMission = pickData(html, 'date-appel')
  const timeMission = pickData(html, 'heure-appel')
  const marqueRaw   = pickData(html, 'vehicule-marque')      || pickById(html, 'marque')
  const plaqueRaw   = pickData(html, 'vehicule-immatricultation') || pickById(html, 'plaque')
  const modeleRaw   = pickById(html, 'modele')               || pickData(html, 'vehicule-modele')
  const vinRaw      = pickById(html, 'serie')                || pickData(html, 'vehicule-vin')

  // ───────── Fallback texte (parse rendu) ─────────
  const text = htmlToText(html)

  // Date de mise en parc — souvent format "Date de mise en parc\t10-04-2026 18:55:00"
  const parkedDateMatch = text.match(/Date de mise en parc\s+(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/i)
  const dateInterv = parkedDateMatch ? parkedDateMatch[1] : dateMission

  // Lieu d intervention
  const interventionAddr = findLabelValue(text, [
    "Lieu d'intervention\\s+Adresse",
    "Lieu d'intervention",
    'Adresse',
  ], 200)

  // Vehicule
  const plaque = plaqueRaw || findLabelValue(text, ['# Immatriculation', 'Immatriculation'], 20)
  const marque = marqueRaw || findLabelValue(text, ['Marque ou charge', 'Marque'], 50)
  const modele = modeleRaw || findLabelValue(text, ['Modèle'], 80)
  const vin    = vinRaw    || findLabelValue(text, ['NIV', 'VIN'], 30)

  // Motif + parc
  const motifMatch = text.match(/MotifParc\s+([^\n]{2,80})/i)
  const parcMatch  = text.match(/Parc\s+([0-9A-Z][^\n]{2,80})/i)

  // Source / type intervention
  const serviceMatch = text.match(/Nom du service\s*:?\s*([^\n]{3,80})/i)
  const natureMatch  = text.match(/Nature de l'intervention\s*:?\s*([^\n]{3,80})/i)

  // Owner / Client sur la route
  const ownerSection = text.match(/Client sur la route\s+([^\n]{2,80})/i)
  let ownerFirstName: string | null = null
  let ownerLastName: string | null = null
  if (ownerSection) {
    const parts = ownerSection[1].trim().split(/\s+/)
    if (parts.length >= 2) {
      ownerFirstName = parts[0]
      ownerLastName  = parts.slice(1).join(' ')
    } else if (parts.length === 1) {
      ownerLastName = parts[0]
    }
  }
  const ownerPhone   = findLabelValue(text, ['Tél', 'Tel', 'Téléphone'], 40)
  const ownerEmail   = findLabelValue(text, ['Email', 'Courriel'], 80)
  const ownerAddress = findLabelValue(text, ['Adresse client', 'Adresse propriétaire'], 200)

  // Police
  const policeZone  = findLabelValue(text, ['Zone de police', 'Zone police'], 60)
  const officerName = findLabelValue(text, ['Policier', 'Agent', 'Nom du policier'], 60)
  const pvNumber    = findLabelValue(text, ['N° PV', 'PV', 'Numéro PV'], 40)

  // Facturé à (responsable)
  const billedTo = findLabelValue(text, ['Responsable', 'Compagnie', 'Facturé à'], 80)

  // Remarques
  const remarksMatch = text.match(/Remarques générales de mission\s*\([^)]*\)\s*([^\n]{2,400})/i)
  const remarks = remarksMatch ? remarksMatch[1].trim() : null

  // Emplacement - Rangee = N° crochet digibox cles (peut etre vide "-")
  const keysMatch = text.match(/Emplacement\s*-\s*Rangée\s+([^\n]{1,40})/i)
  let keysDigiboxSlot: string | null = keysMatch ? keysMatch[1].trim() : null
  if (keysDigiboxSlot === '-' || keysDigiboxSlot === '') keysDigiboxSlot = null

  return {
    missionNum,
    refDossier:        refDossier || null,
    dateMission:       dateInterv || null,
    timeMission:       timeMission || null,
    marque:            marque || null,
    modele:            modele || null,
    plaque:            plaque ? plaque.toUpperCase() : null,
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
    billedTo:          billedTo || (serviceMatch ? serviceMatch[1].trim() : null),
    remarks:           remarks,
    keysDigiboxSlot:   keysDigiboxSlot,
    htmlLength:        html.length,
  }
}
