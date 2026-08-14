// src/lib/vab/close-codes.ts
//
// ÉCRAN DE CODES VAB + DEMANDE DE REMORQUAGE (Olivier 2026-08-14).
//
// Reversé à partir d'une capture réseau d'une clôture réelle faite à la main.
// C'est la dernière étape de la clôture d'une PANNE — et c'est aussi là que se
// déclare le remorquage chez eux, ce qui manquait sur 13 dossiers en 10 jours.
//
// La séquence, dans cet ordre :
//   1. Change  wtSolutionCodeLevel1   (814|13938 = Pas Résolue — Remorquage)
//   2. Change  wtBreakdownCodeLevel1  (+ le niveau 2 de la solution)
//   3. Change  wtBreakdownCodeLevel2
//   4. Clic    wtLink_End             → ouvre BreakdownEnd_Popup.aspx
//   5. Dans la pop-up :
//        · remorquage → wtLink_ClickTow (champ = END) puis wtLink_Ok (champ = TOW)
//        · dépannage  → wtLink_Ok       (champ = END)
//   6. Notify de retour sur la fiche.
//
// Trois pièges qui ont coûté cinq échecs avant la capture :
//   • `__AJAX` a un format précis : `1901,2442,<id_underscore>,0,0,0,0,0,0,`.
//     Sans lui, le serveur ignore purement et simplement le changement.
//   • le coût supplémentaire vit dans DEUX champs, et ils s'INVERSENT : pendant
//     les Change, `…_mask` porte « 0,00 » et le champ réel est vide ; au clic
//     final, le masque est vide et le champ porte « 0.00 » (avec un POINT).
//   • le bouton « Confirmer » de l'écran, c'est `wtLink_End`.

import * as cheerio from 'cheerio'

const BASE = 'https://comet.vab.be/Comet'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export interface VabCodeInput {
  assignmentId: string
  cookieHeader: string
  /** true = déclarer un REMORQUAGE chez VAB (bouton « Tow » de la pop-up). */
  tow: boolean
  solution?: string     // niveau 1 « L1|L2 »
  solutionL2?: string   // niveau 2
  breakdown?: string    // panne niveau 1
  breakdownL2?: string  // panne niveau 2 (sinon : le premier proposé)
}

export interface VabCodeResult { ok: boolean; steps: string[]; error?: string }

const SOL_TOW = '814|13938', SOL_TOW_L2 = '13939'    // Pas Résolue — Remorquage / Par Technicien
const SOL_FIX = '12900|13917'                        // Mobilité Rétablit — Problème Résolue
const BRK_OTHER = '4004|4066'                        // Divers — Autre Problème
const BRK_OTHER_L2 = '4591'                          // son niveau 2, relevé sur la capture
// Identifiants des liens de la pop-up de fin, relevés sur la capture. Ils sont
// stables (même page pour tous les dossiers) et servent de repli quand la
// lecture des handlers échoue.
const POP_TOW = 'WebPatterns_wt15_block_wtMainContent_wtLink_ClickTow'
const POP_OK  = 'WebPatterns_wt15_block_wtMainContent_wtLink_Ok'

const detailUrl = (aid: string) => `${BASE}/BreakdownAssignments_Details.aspx?AssignmentId=${aid}`
const ts = () => Date.now()

async function post(cookie: string, url: string, body: URLSearchParams, referer: string): Promise<string> {
  const r = await fetch(url, {
    method: 'POST', redirect: 'follow',
    headers: {
      'User-Agent': UA, Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'text/plain, */*; q=0.01',
      Origin: 'https://comet.vab.be', Referer: referer, 'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  })
  return r.text()
}

/** Tous les champs de la page, tels que le navigateur les renverrait. */
function formOf($: cheerio.CheerioAPI): URLSearchParams {
  const b = new URLSearchParams()
  $('input[type=hidden]').each((_, e) => { const n = $(e).attr('name'); if (n) b.set(n, $(e).attr('value') || '') })
  $('input[type=text], textarea').each((_, e) => { const n = $(e).attr('name'); if (n) b.set(n, $(e).attr('value') || '') })
  $('input[type=checkbox], input[type=radio]').each((_, e) => {
    const n = $(e).attr('name'); if (n) b.set(n, $(e).attr('checked') != null ? 'on' : 'off')
  })
  $('select').each((_, e) => {
    const n = $(e).attr('name'); if (!n) return
    b.set(n, $(e).find('option[selected]').attr('value') || '__ossli_0')
  })
  return b
}

/**
 * Le nouvel état arrive dans la réponse — mais PAS sous forme de champ HTML :
 * OutSystems renvoie un payload JavaScript où il vit dans `"hidden":{"__OSVSTATE":"…"}`.
 * Chercher un `<input value="…">` ne trouvait rien, donc chaque appel repartait
 * de l'état initial et le serveur ignorait tout en silence. C'est CE détail qui
 * a fait échouer les six tentatives précédentes. Olivier 2026-08-14.
 */
function absorb($: cheerio.CheerioAPI, fragment: string): boolean {
  const m = fragment.match(/"__OSVSTATE"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    || fragment.match(/__OSVSTATE[^>]*value="([^"]*)"/)
  if (!m) return false
  const v = m[1].replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/&amp;/g, '&')
  $('input[name="__OSVSTATE"]').attr('value', v)
  return true
}

/** Retrouve l'identifiant d'un lien OutSystems dans les handlers de la page.
 *  ⚠️ Les apostrophes y sont échappées en `&#39;` : chercher `'…'` ne trouve
 *  rien. Piège vu le 14/08. */
const linkId = (html: string, suffixe: string): string => {
  const m = html.match(new RegExp(`(?:'|&#39;)([A-Za-z0-9_]*${suffixe})(?:'|&#39;)`))
  return m ? m[1] : ''
}

const suffix = ($: cheerio.CheerioAPI, s: string) => {
  let f = ''
  $('select, input, textarea').each((_, e) => { const n = $(e).attr('name') || ''; if (!f && n.endsWith(s)) f = n })
  return f
}
const toId = (n: string) => n.replace(/\$/g, '_')

export async function closeVabCodeScreen(input: VabCodeInput): Promise<VabCodeResult> {
  const steps: string[] = []
  const cookie = input.cookieHeader
  const SOL  = input.solution   || (input.tow ? SOL_TOW : SOL_FIX)
  const SOL2 = input.solutionL2 || (input.tow ? SOL_TOW_L2 : '')
  const BRK  = input.breakdown  || BRK_OTHER

  try {
    const dUrl = detailUrl(input.assignmentId)
    let html = await (await fetch(dUrl, { headers: { 'User-Agent': UA, Cookie: cookie } })).text()
    const $ = cheerio.load(html)

    const nSol = suffix($, 'wtSolutionCodeLevel1')
    if (!nSol || $(`select[name="${nSol}"] option`).length <= 1) {
      return { ok: false, steps, error: 'écran de codes indisponible (listes vides)' }
    }
    const nSol2 = suffix($, 'wtSolutionCodesLevel2')
    const nBrk  = suffix($, 'wtBreakdownCodeLevel1')
    const nBrk2 = suffix($, 'wtBreakdownCodeLevel2')
    const nCost = suffix($, 'wtBreakdownExtraCostInput')

    // Pendant les Change : masque « 0,00 », champ vide.
    const costChange = nCost ? { [`${nCost}_mask`]: '0,00', [nCost]: '' } : {}
    // Au clic final : masque vide, champ « 0.00 ».
    const costEnd    = nCost ? { [`${nCost}_mask`]: '', [nCost]: '0.00' } : {}

    const change = async (name: string, extra: Record<string, string>) => {
      const b = formOf($)
      for (const [k, v] of Object.entries({ ...costChange, ...extra })) b.set(k, v)
      b.set('__EVENTTARGET', name); b.set('__EVENTARGUMENT', '')
      b.set('__AJAX', `1901,2442,${toId(name)},0,0,0,0,0,0,`)
      b.set('__AJAXEVENT', 'Change')
      const frag = await post(cookie, `${BASE}/BreakdownAssignments_Details.aspx?_ts=${ts()}`, b, dUrl)
      absorb($, frag)
      return frag
    }

    // 1 — code solution
    await change(nSol, { [nSol]: SOL })
    steps.push(input.tow ? 'solution : remorquage' : 'solution : mobilité rétablie')

    // 2 — code panne (en portant le niveau 2 de la solution)
    const sol2 = nSol2 && SOL2 ? { [nSol2]: SOL2 } : {}
    let frag = await change(nBrk, { [nSol]: SOL, ...sol2, [nBrk]: BRK })
    steps.push('code panne')

    // 3 — code panne niveau 2 : celui que VAB vient de proposer
    // Le niveau 2 est OBLIGATOIRE : sans lui, « Confirmer » redessine la page au
    // lieu de valider. On le lit sur la fiche RELUE après le choix du niveau 1 —
    // le fragment AJAX, lui, ne contient pas toujours la liste repeuplée.
    // Le niveau 2 est OBLIGATOIRE : sans lui, « Confirmer » redessine la page au
    // lieu de valider. Il n'existe QUE dans le fragment renvoyé par le choix du
    // niveau 1 — relire la fiche ne sert à rien, l'état vit dans __OSVSTATE et
    // un GET repart de zéro. Et dans ce fragment, le HTML est échappé en JSON :
    // les guillemets des attributs sont précédés d'un antislash.
    let brk2 = input.breakdownL2 || ''
    if (!brk2 && nBrk2) {
      const bloc = frag.match(/BreakdownCodeLevel2[\s\S]{0,20000}?<\\?\/select>/)?.[0] || frag
      const opts = [...bloc.matchAll(/<option value=\\?"(\d{3,6})\\?"/g)].map(m => m[1])
      brk2 = opts[0] || (BRK === BRK_OTHER ? BRK_OTHER_L2 : '')
      steps.push(`niveau 2 : ${opts.length} option(s) → ${brk2 || 'aucune'}`)
    }
    if (nBrk2 && brk2) {
      await change(nBrk2, { [nSol]: SOL, ...sol2, [nBrk]: BRK, [nBrk2]: brk2 })
      steps.push(`code panne niveau 2 (${brk2})`)
    }

    // 4 — Confirmer
    const endName = linkId(html, 'wtLink_End')
    if (!endName) return { ok: false, steps, error: 'bouton Confirmer introuvable' }
    const nEnd = endName.replace(/_/g, '$')
    {
      // ⚠️ La vraie requête n'envoie que 21 champs, pas toute la page. Envoyer
      // l'intégralité des champs cachés faisait redessiner l'écran au lieu de
      // valider. On reproduit STRICTEMENT la liste de la capture.
      const b = new URLSearchParams()
      for (const n of ['__OSVSTATE', '__VIEWSTATE', '__VIEWSTATEGENERATOR']) {
        b.set(n, $(`input[name="${n}"]`).attr('value') || '')
      }
      // Les deux cases à cocher « frais » de la section détours.
      $('input[type=checkbox]').each((_, e) => {
        const n = $(e).attr('name') || ''
        if (/wt410$|wt277$/.test(n)) b.set(n, 'off')
      })
      // Les champs texte de la zone frais/détours/remarque, vides.
      for (const suf of ['wtInput_ExtraCostReason', 'wtInput_DetourNrOfKm', 'wtInput_DetourReason',
                         'wt168', 'wtInput_ExtraTimeReason', 'wtInput_ExtraVehicleReason',
                         'wtInput_RemarksIntervention']) {
        const n = suffix($, suf); if (n) b.set(n, '')
      }
      for (const [k, v] of Object.entries({ ...costEnd, [nSol]: SOL, ...sol2, [nBrk]: BRK, ...(brk2 ? { [nBrk2]: brk2 } : {}) })) b.set(k, v)
      b.set('__EVENTTARGET', nEnd); b.set('__EVENTARGUMENT', '')
      // Les nombres qui suivent l'identifiant ne sont PAS décoratifs : la capture
      // montre `2252,40,1166,0,106,2263` là où j'envoyais des zéros, et avec des
      // zéros le serveur redessine la page au lieu de valider. Repris tels quels.
      b.set('__AJAX', `1901,2442,${endName},2252,40,1166,0,106,2263,`)
      const rEnd = await post(cookie, `${BASE}/BreakdownAssignments_Details.aspx?_ts=${ts()}`, b, dUrl)
      absorb($, rEnd)
      // Le serveur annonce lui-même le résultat : on le lit plutôt que de le
      // supposer. « Mission complétée et envoyée à VAB. » = le clic a porté.
      const dit = (rEnd.match(/Mission[^"\\]{0,60}VAB[^"\\]{0,10}/) || [])[0]
        || (rEnd.match(/"messages?"\s*:\s*"([^"]{5,90})"/) || [])[1]
        || (rEnd.match(/Champ obligatoire[^"]{0,40}/) || [])[0]
        || `${rEnd.length} octets`
      steps.push(`confirmer → ${dit}`)
    }

    // 5 — la pop-up de fin : c'est ELLE qui déclare le remorquage
    const popUrl = `${BASE}/BreakdownEnd_Popup.aspx`
    const popHtml = await (await fetch(`${popUrl}?_ts=${ts()}`, { headers: { 'User-Agent': UA, Cookie: cookie } })).text()
    const $p = cheerio.load(popHtml)
    // Le champ d'état de la pop-up (nom numérique) bascule END → TOW.
    let stateField = ''
    $p('input[type=hidden]').each((_, e) => { const n = $p(e).attr('name') || ''; if (!stateField && /^\d{6,}$/.test(n)) stateField = n })

    const popPost = async (linkSuffix: string, stateValue: string, fallback = '') => {
      const name = linkId(popHtml, linkSuffix) || fallback
      if (!name) return false
      const b = formOf($p)
      if (stateField) b.set(stateField, stateValue)
      b.set('__EVENTTARGET', name.replace(/_/g, '$')); b.set('__EVENTARGUMENT', '')
      b.set('__AJAX', `480,219,${name},58,49,0,0,`)
      const r = await post(cookie, `${popUrl}?_ts=${ts()}`, b, popUrl)
      absorb($p, r)
      return true
    }

    if (input.tow) {
      if (await popPost('wtLink_ClickTow', 'END', POP_TOW)) steps.push('demande de remorquage')
      if (await popPost('wtLink_Ok', 'TOW', POP_OK))        steps.push('validation remorquage')
    } else {
      if (await popPost('wtLink_Ok', 'END', POP_OK)) steps.push('validation fin')
    }

    // 6 — vérification réelle : l'écran de codes a-t-il disparu ?
    const after = await (await fetch(dUrl, { headers: { 'User-Agent': UA, Cookie: cookie } })).text()
    const encore = cheerio.load(after)('select[name$="wtSolutionCodeLevel1"] option').length > 1
    steps.push(encore ? 'toujours à l’écran de codes' : 'dossier soldé')
    return { ok: !encore, steps }
  } catch (e: any) {
    return { ok: false, steps, error: e?.message || String(e) }
  }
}
