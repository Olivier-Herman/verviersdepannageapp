// src/lib/vab/close.ts
//
// Clôture d'une mission VAB Comet (remorquage/tow ET dépannage/breakdown),
// pilotée en « state-aware » : on lit la page courante, on identifie l'étape et
// on exécute l'action + les champs requis (signature, clés ; breakdown : VIN,
// codes). CHAÎNAGE __OSVSTATE obligatoire (on ré-injecte les hidden de la RÉPONSE
// précédente, jamais un GET frais entre étapes accumulant de l'état — sinon la
// signature est perdue). Wiring VAB = OsAjax → __EVENTTARGET direct dans le POST.
// Olivier 2026-08-08. Cf [[project_vab_comet_integration]].

import * as cheerio from 'cheerio'
import { loginVab } from './scraper'

const BASE = 'https://comet.vab.be'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

// Boutons de menu / langue à ignorer pour trouver l'action de progression.
const STATIC = ['nouvelles Missions', 'Paramètres', 'Preuve d’Intervention', "Preuve d'Intervention", 'Contrat', 'Email', 'Retourner', 'Envoyer', 'Néerlandais', 'Français', 'Allemand', 'Anglais', 'Generate Upload Token', 'Open Popup Upload']

interface Btn { text: string; target: string | null }
interface Parsed {
  buttons: Btn[]
  inputNames: string[]
  buttonTexts: string[]
  feedback: string
  completed: boolean
  html: string
}

function extractTarget(onclick: string, href: string): string | null {
  const blob = `${onclick} ${href}`
  const os = blob.match(/OsAjax\([^,]+,\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]/)
  if (os) return os[1]
  const pb = blob.match(/__doPostBack\(\s*['"]([^'"]+)['"]/)
  return pb ? pb[1] : null
}

function parse(html: string): Parsed {
  const $ = cheerio.load(html)
  const buttons: Btn[] = []
  const seen = new Set<string>()
  $('.Button, [class*=Button], a[onclick], a[href^="javascript"], input[type=submit], input[type=button]').each((_, el) => {
    const $el = $(el)
    const text = (($el.text() || '') || $el.attr('value') || '').replace(/\s+/g, ' ').trim()
    if (!text || text.length > 45) return
    const target = extractTarget($el.attr('onclick') || '', $el.attr('href') || '') || $el.attr('name') || null
    const key = `${text}|${target}`
    if (seen.has(key)) return
    seen.add(key)
    buttons.push({ text, target })
  })
  const inputNames: string[] = []
  $('input:not([type=hidden]), textarea, select').each((_, el) => { const n = $(el).attr('name'); if (n) inputNames.push(n) })
  const feedback = (html.match(/Feedback_Message_Wrapper[^>]*>\s*<[^>]*>([^<]{2,150})</) || [])[1]?.trim() || ''
  const completed = /successfully completed|Mission compl|assignment was successfully|Assignments\.aspx/i.test(html) && !/wtLink_End/.test(html)
  return { buttons, inputNames, buttonTexts: buttons.map(b => b.text), feedback, completed, html }
}

function collectHidden($: cheerio.CheerioAPI): Record<string, string> {
  const h: Record<string, string> = {}
  $('input[type=hidden]').each((_, el) => { const n = $(el).attr('name'); if (n) h[n] = $(el).attr('value') || '' })
  return h
}

// Options des <select> de codes (Solution / Panne) présents sur l'écran de clôture
// breakdown — sert à capturer le référentiel ET de garde-fou (on ne clôture pas
// sans code choisi). Olivier 2026-08-09.
function codeSelectOptions(html: string): Record<string, Array<{ value: string; text: string }>> {
  const $ = cheerio.load(html)
  const out: Record<string, Array<{ value: string; text: string }>> = {}
  $('select').each((_, el) => {
    const name = $(el).attr('name') || ''
    if (!/SolutionCode|BreakdownCode/i.test(name)) return
    const opts: Array<{ value: string; text: string }> = []
    $(el).find('option').each((_i, o) => {
      const value = $(o).attr('value') || ''
      const text = $(o).text().replace(/\s+/g, ' ').trim()
      if (value !== '' || text) opts.push({ value, text })
    })
    out[name] = opts
  })
  return out
}

async function osGet(cookie: string, url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie } })
  return await r.text()
}

// POST chaîné : ré-injecte TOUS les hidden de `html` (dont __OSVSTATE), pose le
// __EVENTTARGET + les champs extra, renvoie le HTML résultat.
async function osPost(cookie: string, url: string, html: string, target: string, extra: Record<string, string> = {}, arg = ''): Promise<string> {
  const $ = cheerio.load(html)
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(collectHidden($))) body.set(k, v)
  body.set('__EVENTTARGET', target)
  body.set('__EVENTARGUMENT', arg)
  for (const [k, v] of Object.entries(extra)) body.set(k, v)
  const fa = $('form').attr('action') || url
  const r = await fetch(new URL(fa, url).toString(), {
    method: 'POST', redirect: 'follow',
    headers: { 'User-Agent': UA, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: url, 'X-Requested-With': 'XMLHttpRequest' },
    body: body.toString(),
  })
  return await r.text()
}

// Pop-up « VIN inconnu » (breakdown) : quand les 3 chiffres saisis ne concordent
// pas avec le dossier VAB, Comet ouvre `BreakdownAssignments_Details_CheckVin_Popup.aspx`
// (viewstate PROPRE) demandant « le VIN ne correspond pas, continuer ? » → on clique
// « Oui » (`wtYesButtonLink`) = LE bypass. Renvoie true si cliqué. Olivier 2026-08-09
// (cURL réels). Cf [[project_vab_comet_integration]].
async function confirmCheckVinPopupIfAny(cookie: string): Promise<boolean> {
  const purl = `${BASE}/BreakdownAssignments_Details_CheckVin_Popup.aspx?_ts=${Date.now()}`
  let html: string
  try { html = await osGet(cookie, purl) } catch { return false }
  const $ = cheerio.load(html)
  let yes: string | null = null
  $('a, input, button').each((_, el) => {
    if (yes) return
    const t = extractTarget($(el).attr('onclick') || '', $(el).attr('href') || '')
    if (t && /YesButton/i.test(t)) yes = t
  })
  if (!yes) return false
  await osPost(cookie, purl, html, yes, {})
  return true
}

const nameEndsWith = (names: string[], suffix: string) => names.find(n => n.endsWith(suffix)) || null
const btnByTargetSuffix = (b: Btn[], suffix: string) => b.find(x => x.target && x.target.endsWith(suffix)) || null
function progression(b: Btn[]): Btn | null {
  return b.find(x => x.target && !STATIC.includes(x.text) && !x.target.endsWith('wtLink_End') && !x.target.endsWith('wtLink_GetSignature') && !/Upload/i.test(x.text)) || null
}

export interface VabCloseInput {
  assignmentId: string
  taskType?: 'tow' | 'breakdown'
  detailHref?: string
  signaturePng?: string      // dataURI PNG (sinon refus/absent requis)
  refusal?: boolean          // client refuse de signer
  notPresent?: boolean       // client absent
  keysNr?: string            // valeur option nb clés (ex __ossli_1 = 1 clé)
  keyLocation?: string       // valeur option emplacement (ex 465=Boîte à clés, 1043=Réception, 463=Client)
  vehicleLocation?: string   // « Localisation du véhicule » (wt347), ex "Parking"
  receiverName?: string      // Nom (qui réceptionne)
  receiverFirstName?: string // Prénom
  interventionDate?: string  // ⚠️ format À TIRETS « JJ-MM-AAAA » (slashes = « Date attendue ! »). Défaut = aujourd'hui.
  interventionTime?: string  // « HH:MM:SS ». Défaut = maintenant.
  present?: boolean          // « Quelqu'un est présent ? » (défaut true)
  extraFields?: Record<string, string>  // breakdown : VIN/codes/km (name->value)
  maxSteps?: number
}

function nowDateDash(): string { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}` }
function nowTime(): string { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:00` }

export interface VabCloseResult { ok: boolean; completed: boolean; steps: string[]; error?: string; lastButtons?: string[]; needsCodes?: Record<string, Array<{ value: string; text: string }>> }

export async function closeVabMission(input: VabCloseInput): Promise<VabCloseResult> {
  const sess = await loginVab()
  const href = input.detailHref
    || `${input.taskType === 'breakdown' ? 'Breakdown' : 'Tow'}Assignments_Details.aspx?AssignmentId=${input.assignmentId}`
  const url = `${BASE}/${href.replace(/^\//, '')}`
  const steps: string[] = []
  let html = await osGet(sess.cookieHeader, url)
  let signed = false
  let vinChecked = false

  for (let i = 0; i < (input.maxSteps || 14); i++) {
    const p = parse(html)
    if (p.completed) return { ok: true, completed: true, steps, lastButtons: p.buttonTexts }

    // Étape VIN (breakdown uniquement) : saisir les 3 derniers chiffres + « Vérifier »
    // une seule fois. Sans ce clic, le drapeau « VIN vérifié » n'est pas posé et
    // « Fin lieu de la panne » boucle sans progresser (le tow n'a pas cette étape).
    // Le VIN arrive dans extraFields (clé …wtLastDigitInputField). Olivier 2026-08-09.
    const vinInput = nameEndsWith(p.inputNames, 'wtLastDigitInputField')
    const checkVin = btnByTargetSuffix(p.buttons, 'wtLink_CheckVin')
    if (vinInput && checkVin && !vinChecked) {
      const vinVal = Object.entries(input.extraFields || {}).find(([k]) => k.endsWith('wtLastDigitInputField'))?.[1]
      if (vinVal) {
        // CheckVin sur la page principale (porte tous les champs cumulés : km/VIN/signature).
        html = await osPost(sess.cookieHeader, url, html, checkVin.target!, input.extraFields || {})
        // Pop-up « VIN inconnu » : si le VIN ne concorde pas, cliquer « Oui » (bypass).
        // Effet serveur : pose le drapeau « VIN vérifié » → EndIntervention progresse.
        const bypassed = await confirmCheckVinPopupIfAny(sess.cookieHeader)
        // Après le « Oui » de la pop-up, Comet refresh le widget VIN sur la page
        // principale (`wt436$RichWidgets_wt14$block$wt1`) → synchronise l'état sur
        // « VIN confirmé » sans quoi « Fin lieu de la panne » ne progresse pas.
        if (bypassed) {
          // Refresh du widget VIN après le « Oui » de la pop-up → pose « VIN confirmé »
          // dans la chaîne OSVSTATE. ⚠️ RESTE À FIABILISER : la réponse est un fragment
          // partiel OsAjax dont le nouvel __OSVSTATE n'est pas un <input hidden> standard
          // → collectHidden() ne le récupère pas encore, donc l'état ne se propage pas et
          // « Fin lieu de la panne » reboucle. À finir avec le HAR (format réponse OsAjax).
          // ⚠️ Ce target de refresh utilise des UNDERSCORES (pas des $) — cf cURL réel.
          const refreshTarget = checkVin.target!.replace(/wtLink_CheckVin$/, 'RichWidgets_wt14$block$wt1').replace(/\$/g, '_')
          html = await osPost(sess.cookieHeader, url, html, refreshTarget, input.extraFields || {})
        }
        vinChecked = true
        steps.push(bypassed ? 'check_vin (bypass VIN inconnu)' : 'check_vin')
        continue
      }
    }

    // Étape SIGNATURE (champ wtInput_Signature présent) : signer une fois.
    const sigInput = nameEndsWith(p.inputNames, 'wtInput_Signature')
    const getSig = btnByTargetSuffix(p.buttons, 'wtLink_GetSignature')
    if (sigInput && getSig && !signed) {
      const extra: Record<string, string> = {}
      if (input.refusal) extra[nameEndsWith(p.inputNames, 'wtCheck_Refusal') || ''] = 'on'
      else if (input.notPresent) extra[nameEndsWith(p.inputNames, 'wtCheck_NotPresent') || ''] = 'on'
      else if (input.signaturePng) extra[sigInput] = input.signaturePng
      else return { ok: false, completed: false, steps, error: 'Signature requise (dessin, refus ou absent)' }
      html = await osPost(sess.cookieHeader, url, html, getSig.target!, extra)
      signed = true
      steps.push('signature')
      continue
    }

    // Étape FINALE : bouton wtLink_End (+ date/heure intervention, nom, localisation
    // véhicule, nb clés, emplacement). ⚠️ Date à TIRETS sinon « Date attendue ! ».
    const endBtn = btnByTargetSuffix(p.buttons, 'wtLink_End')
    if (endBtn) {
      // Garde-fou breakdown : l'écran final porte des selects Code Solution / Code
      // Panne obligatoires. Si aucun code n'est fourni dans extraFields, NE PAS
      // clôturer (VAB rejetterait, ou pire clôturerait sans code) → on remonte les
      // options pour capturer le référentiel et laisser choisir. Olivier 2026-08-09.
      const codeOpts = codeSelectOptions(html)
      const hasCodeSelect = Object.keys(codeOpts).length > 0
      const codeProvided = Object.keys(input.extraFields || {}).some(k => /SolutionCode|BreakdownCode/i.test(k))
      if (hasCodeSelect && !codeProvided) {
        return { ok: false, completed: false, steps, lastButtons: p.buttonTexts, needsCodes: codeOpts, error: 'Codes Solution/Panne requis pour clôturer (breakdown)' }
      }
      const extra: Record<string, string> = { ...(input.extraFields || {}) }
      const put = (suffix: string, val?: string) => { const n = nameEndsWith(p.inputNames, suffix); if (n && val != null && val !== '') extra[n] = val }
      put('wtInterventionDate', input.interventionDate || nowDateDash())
      put('wtInterventionTime', input.interventionTime || nowTime())
      put('wtComboBox_KeysNr', input.keysNr)
      put('wtComboBoxKeyLocation', input.keyLocation)
      put('wt347', input.vehicleLocation)          // Localisation du véhicule
      put('wt283', input.receiverName)             // Nom
      put('wt359', input.receiverFirstName)        // Prénom
      if (input.present !== false) { const c = nameEndsWith(p.inputNames, 'wt55'); if (c) extra[c] = 'on' }  // Quelqu'un est présent ?
      html = await osPost(sess.cookieHeader, url, html, endBtn.target!, extra)
      steps.push('fin_mission')
      const after = parse(html)
      const done = after.completed || !btnByTargetSuffix(after.buttons, 'wtLink_End') || /Mission compl/i.test(html)
      return { ok: done, completed: done, steps, lastButtons: after.buttonTexts, error: done ? undefined : 'Submit final refusé (validation VAB)' }
    }

    // Sinon : action de progression (Accepter / Départ / Arrivé / Fin livraison / Start…).
    const prog = progression(p.buttons)
    if (!prog || !prog.target) return { ok: false, completed: false, steps, error: 'Aucune action de progression trouvée', lastButtons: p.buttonTexts }
    html = await osPost(sess.cookieHeader, url, html, prog.target, input.extraFields || {})
    steps.push(prog.text)
  }
  return { ok: false, completed: false, steps, error: 'maxSteps atteint sans clôture' }
}
