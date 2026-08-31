// src/lib/vab/sync.ts
//
// Propagation automatique des pointages chauffeur vers VAB Comet (comme
// lib/touring/sync pour COMEX). Quand le chauffeur agit dans l'app sur une
// mission VAB, on déclenche l'étape Comet correspondante :
//   accept  → « Accepter »        (wtLink_Accept)
//   depart  → « Départ domicile » (wtLink_Start)
//   arrive  → « Arrivé endroit de la panne » (wtLink_StartIntervention)
//
// Ce sont des transitions d'état SIMPLES (un seul postback stateless) — fiables
// en headless (contrairement à la clôture on-site→codes, encore à cracker).
// Idempotent : si le bouton attendu n'est pas là (étape déjà faite ou pas encore
// possible), no-op. Best-effort : ne throw jamais. Olivier 2026-08-09.

import * as cheerio from 'cheerio'
import { loginVab } from './scraper'

const BASE = 'https://comet.vab.be'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

export type VabStep = 'accept' | 'depart' | 'arrive'

const TARGET_RE: Record<VabStep, RegExp> = {
  accept: /wtLink_Accept\b/,
  depart: /wtLink_Start\b/,
  arrive: /wtLink_StartIntervention\b/,
}
const LABEL: Record<VabStep, string> = {
  accept: 'accepté', depart: 'départ domicile', arrive: 'arrivé sur place',
}

function findTarget(html: string, re: RegExp): string | null {
  const $ = cheerio.load(html)
  let t: string | null = null
  $('a, input, button').each((_, e) => {
    if (t) return
    const blob = `${$(e).attr('onclick') || ''} ${$(e).attr('href') || ''}`
    const m = blob.match(/OsAjax\([^,]+,\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]/) || blob.match(/__doPostBack\(\s*['"]([^'"]+)['"]/)
    if (m && re.test(m[1])) t = m[1]
  })
  return t
}

/** Le bouton de l'étape est-il ENCORE là ? Tant qu'il y est, rien n'a bougé. */
async function boutonEncoreLa(cookie: string, url: string, step: VabStep): Promise<boolean> {
  const html = await (await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie, 'Cache-Control': 'no-store' } })).text()
  return !!findTarget(html, TARGET_RE[step])
}

// Tire un bouton (si présent) sur la page détail. Renvoie 'fired' | 'absent' | 'ignore'.
async function fireStep(cookie: string, url: string, step: VabStep): Promise<'fired' | 'absent' | 'ignore'> {
  const html = await (await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie } })).text()
  const target = findTarget(html, TARGET_RE[step])
  if (!target) return 'absent'   // bouton pas là → étape déjà faite / pas encore possible
  const $ = cheerio.load(html)
  const body = new URLSearchParams()
  $('input[type=hidden]').each((_, e) => { const n = $(e).attr('name'); if (n) body.set(n, $(e).attr('value') || '') })
  body.set('__EVENTTARGET', target)
  body.set('__EVENTARGUMENT', '')
  const fa = $('form').attr('action') || url
  const pr = await fetch(new URL(fa, url).toString(), {
    method: 'POST',
    headers: { 'User-Agent': UA, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Origin: BASE, Referer: url },
    body: body.toString(),
  })
  if (pr.status >= 400) throw new Error(`postback ${step} statut ${pr.status}`)

  // ── UN 200 N'EST PAS UNE PREUVE (Olivier 2026-08-31) ──────────────────────
  // « En acceptant la mission dans VD Soft, tu es censé valider chez VAB. »
  // C'est bien ce qu'on essayait de faire — et on écrivait « VAB Comet ↗ accepté »
  // dans le journal — mais leur serveur répondait 200 sans rien changer. Trois
  // fois de suite sur 2HTT471, et le dossier est resté « À accepter » quatre
  // jours. Un journal qui affirme une chose fausse est pire que pas de journal :
  // il empêche de chercher.
  //
  // On relit donc la page : tant que le bouton y est, l'étape n'est pas passée.
  await new Promise(r => setTimeout(r, 1500))
  return (await boutonEncoreLa(cookie, url, step)) ? 'ignore' : 'fired'
}

const ORDER: VabStep[] = ['accept', 'depart', 'arrive']

/**
 * Propage vers VAB Comet jusqu'à l'étape `upToStep` incluse, en RATTRAPANT les
 * étapes précédentes manquantes (chaîne accept→départ→arrivé). Chaque étape n'est
 * tirée que si son bouton est présent (idempotent) → si le chauffeur a déjà
 * accepté/roulé avant que le hook soit actif, le prochain pointage rattrape tout.
 * Best-effort : ne throw jamais vers l'appelant. Olivier 2026-08-09.
 */
export async function syncVabStep(sb: any, missionId: string, upToStep: VabStep): Promise<boolean> {
  const { data: m } = await sb.from('incoming_missions').select('id, external_id, source').eq('id', missionId).maybeSingle()
  if (!m || String(m.source).toLowerCase() !== 'vab') return false
  const aid = String(m.external_id || '').match(/\d+/)?.[0]
  if (!aid) return false
  const url = `${BASE}/BreakdownAssignments_Details.aspx?AssignmentId=${aid}`
  const upTo = ORDER.indexOf(upToStep)

  let sess: any
  try { sess = await loginVab() }
  catch (e: any) {
    await sb.from('mission_logs').insert({ mission_id: missionId, action: 'vab_sync_error', notes: `VAB Comet login : ${e?.message || e}`, metadata: { auto: true } }).then(() => {}, () => {})
    return false
  }

  const fired: string[] = []
  const ignorés: string[] = []
  let anyOk = false
  for (let i = 0; i <= upTo; i++) {
    const step = ORDER[i]
    try {
      const res = await fireStep(sess.cookieHeader, url, step)
      if (res === 'fired') { fired.push(LABEL[step]); anyOk = true }
      else if (res === 'ignore') {
        // Le postback part, VAB répond 200, et l'étape ne passe pas. On le dit,
        // et on n'enchaîne pas : les suivantes en dépendent de toute façon.
        ignorés.push(LABEL[step])
        break
      }
    } catch (e: any) {
      await sb.from('mission_logs').insert({ mission_id: missionId, action: 'vab_sync_error', notes: `VAB Comet ${LABEL[step]} : ${e?.message || e}`, metadata: { step, assignmentId: aid, auto: true } }).then(() => {}, () => {})
      break   // on n'enchaîne pas si une étape casse
    }
  }
  if (fired.length) {
    await sb.from('mission_logs').insert({
      mission_id: missionId, action: 'vab_synced',
      notes: `VAB Comet ↗ ${fired.join(' → ')} (auto)`, metadata: { steps: fired, upTo: upToStep, assignmentId: aid, auto: true },
    }).then(() => {}, () => {})
  }
  if (ignorés.length) {
    await sb.from('mission_logs').insert({
      mission_id: missionId, action: 'vab_sync_error',
      notes: `⚠️ VAB Comet : « ${ignorés.join(', ')} » envoyé mais NON PRIS EN COMPTE de leur côté — le dossier reste à cette étape chez eux.`,
      metadata: { ignored: ignorés, upTo: upToStep, assignmentId: aid, auto: true },
    }).then(() => {}, () => {})
  }
  return anyOk
}
