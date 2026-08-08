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
  keysNr?: string            // valeur option (ex __ossli_1)
  keyLocation?: string       // valeur option (ex 463=Client)
  extraFields?: Record<string, string>  // breakdown : VIN/codes/km (name->value)
  maxSteps?: number
}

export interface VabCloseResult { ok: boolean; completed: boolean; steps: string[]; error?: string; lastButtons?: string[] }

export async function closeVabMission(input: VabCloseInput): Promise<VabCloseResult> {
  const sess = await loginVab()
  const href = input.detailHref
    || `${input.taskType === 'breakdown' ? 'Breakdown' : 'Tow'}Assignments_Details.aspx?AssignmentId=${input.assignmentId}`
  const url = `${BASE}/${href.replace(/^\//, '')}`
  const steps: string[] = []
  let html = await osGet(sess.cookieHeader, url)
  let signed = false

  for (let i = 0; i < (input.maxSteps || 14); i++) {
    const p = parse(html)
    if (p.completed) return { ok: true, completed: true, steps, lastButtons: p.buttonTexts }

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

    // Étape FINALE : bouton wtLink_End (+ nb clés / emplacement).
    const endBtn = btnByTargetSuffix(p.buttons, 'wtLink_End')
    if (endBtn) {
      const extra: Record<string, string> = { ...(input.extraFields || {}) }
      const keysNrName = nameEndsWith(p.inputNames, 'wtComboBox_KeysNr')
      const keyLocName = nameEndsWith(p.inputNames, 'wtComboBoxKeyLocation')
      if (keysNrName && input.keysNr) extra[keysNrName] = input.keysNr
      if (keyLocName && input.keyLocation) extra[keyLocName] = input.keyLocation
      html = await osPost(sess.cookieHeader, url, html, endBtn.target!, extra)
      steps.push('fin_mission')
      const after = parse(html)
      return { ok: true, completed: after.completed || !btnByTargetSuffix(after.buttons, 'wtLink_End'), steps, lastButtons: after.buttonTexts }
    }

    // Sinon : action de progression (Accepter / Départ / Arrivé / Fin livraison / Start…).
    const prog = progression(p.buttons)
    if (!prog || !prog.target) return { ok: false, completed: false, steps, error: 'Aucune action de progression trouvée', lastButtons: p.buttonTexts }
    html = await osPost(sess.cookieHeader, url, html, prog.target, input.extraFields || {})
    steps.push(prog.text)
  }
  return { ok: false, completed: false, steps, error: 'maxSteps atteint sans clôture' }
}
