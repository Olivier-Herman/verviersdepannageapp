// src/lib/vab/sign-browser.ts
//
// Puppeteer — pilote UNIQUEMENT l'écran on-site de clôture breakdown VAB Comet
// (km + VIN/Vérifier + SIGNATURE canvas + Fin lieu de la panne), là où le HTTP
// pur échoue (widget canvas JS `Signature()` + popup « VIN inconnu » qui casse
// la chaîne __OSVSTATE). On rend ensuite la main à l'orchestrateur HTTP à
// l'écran des codes (cookies + __OSVSTATE courant). Décision Olivier 2026-08-11.
// Cf [[project_vab_comet_integration]].
//
// Env : prod/serverless → puppeteer-core + @sparticuz/chromium ; dev → puppeteer.

import type { Browser, Page } from 'puppeteer-core'

const BASE = 'https://comet.vab.be'
// ⚠️ UA desktop OBLIGATOIRE : avec l'UA headless par défaut, VAB renvoie le
// navigateur sur www.vab.be/404 en boucle (jamais le formulaire de login).
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const detailsUrl = (assignmentId: string) =>
  `${BASE}/Comet/BreakdownAssignments_Details.aspx?AssignmentId=${assignmentId}`

export interface VabBrowserResult {
  ok: boolean
  onCodeScreen: boolean
  /** L'écran de codes a été rempli ET confirmé → dossier soldé chez VAB. */
  codesConfirmed?: boolean
  cookieHeader: string      // à réutiliser par l'orchestrateur HTTP (même session)
  osvstate: string | null   // __OSVSTATE courant lu dans le DOM (handoff HTTP)
  steps: string[]
  error?: string
  diag?: string
}

/** Lance Chromium : @sparticuz en serverless, puppeteer complet en local. */
async function launchBrowser(): Promise<Browser> {
  const serverless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
  if (serverless) {
    const chromium = (await import('@sparticuz/chromium')).default as any
    const puppeteer = await import('puppeteer-core')
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: { width: 1400, height: 1000 },
    }) as unknown as Browser
  }
  const puppeteer = (await import('puppeteer')).default as any
  return puppeteer.launch({ headless: 'new', defaultViewport: { width: 1400, height: 1000 } })
}

/** Login natif dans le navigateur (plus fiable que l'injection de cookies). */
async function loginInBrowser(page: Page): Promise<void> {
  const email = process.env.VAB_EMAIL
  const password = process.env.VAB_PASSWORD
  if (!email || !password) throw new Error('VAB_EMAIL / VAB_PASSWORD requis')
  // Entrée par Home.aspx → VAB enchaîne des redirections JS (Home→NoPermission→
  // Login) qui détruisent le contexte : on POLL le champ user (tolérant aux navs),
  // avec retry externe complet (la course de redirection est intermittente).
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  let userField = null
  for (let attempt = 0; attempt < 3 && !userField; attempt++) {
    await page.goto(`${BASE}/Comet/Home.aspx`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    for (let i = 0; i < 25 && !userField; i++) {
      await sleep(1000)
      try { userField = await page.$('input[id*="wtUserNameInput"]') } catch { /* nav en cours */ }
    }
  }
  if (!userField) throw new Error('formulaire de login VAB introuvable (redirections)')
  // Stabiliser avant de taper (une nav peut encore se poser juste après l'apparition).
  await sleep(1500)
  for (let t = 0; t < 3; t++) {
    try {
      await page.click('input[id*="wtUserNameInput"]'); await page.keyboard.type(email)
      await page.click('input[id*="wtPasswordInput"]'); await page.keyboard.type(password)
      break
    } catch { await sleep(1500) }
  }
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
    page.click('a[id*="wtLoginButton"], input[id*="wtLoginButton"]').catch(() => {}),
  ])
  // Laisser la redirection post-login (→ Assignments) se poser.
  await sleep(2500)
}

async function clearAndType(page: Page, selector: string, value: string): Promise<boolean> {
  const el = await page.$(selector)
  if (!el) return false
  await page.evaluate((s) => { const e = document.querySelector(s) as HTMLInputElement | null; if (e) e.value = '' }, selector)
  await el.type(value)
  return true
}

/** Dessine un trait sur le canvas de signature (mouse events réels). */
/** Vrai écran de codes = la liste des solutions est REMPLIE (le select existe
 *  aussi, vide, sur l'écran de signature). Olivier 2026-08-14. */
async function isCodeScreen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')]
      .find(x => /SolutionCodeLevel1/i.test(x.id || x.getAttribute('name') || '')) as HTMLSelectElement | undefined
    return !!sel && sel.options.length > 1
  }).catch(() => false)
}

async function drawSignature(page: Page): Promise<boolean> {
  const sel = '[id*="wtSignatureContainer"] canvas, .SignatureContainer canvas'
  const canvas = await page.$(sel)
  if (!canvas) return false
  const box = await canvas.boundingBox()
  if (!box) return false
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 25 })
  await page.mouse.move(box.x + box.width / 2, box.y + 15, { steps: 25 })
  await page.mouse.up()
  await new Promise(r => setTimeout(r, 400))
  const len = await page.evaluate(() => {
    const s = document.querySelector('input[id*="wtInput_Signature"]') as HTMLInputElement | null
    return s ? s.value.length : 0
  })
  return len > 50
}

/** Popup « VIN inconnu » (Non-concordance châssis) = IFRAME → cliquer « Oui »
 *  DANS la frame (sinon la modale reste ouverte et masque le canvas). */
async function clickOuiInFrames(page: Page): Promise<boolean> {
  for (const fr of page.frames()) {
    try {
      const clicked = await fr.evaluate(() => {
        const el = [...document.querySelectorAll('a,button')].find(e =>
          /^oui$/i.test((e.textContent || '').trim()) || /YesButton/i.test((e as HTMLElement).id || ''))
        if (el) { (el as HTMLElement).click(); return true }
        return false
      })
      if (clicked) return true
    } catch { /* frame détachée */ }
  }
  return false
}

/** Clique un lien/bouton OutSystems par son texte visible (OsAjax gère le postback). */
async function clickByText(page: Page, src: string): Promise<boolean> {
  const handle = await page.evaluateHandle((rxSrc) => {
    const rx = new RegExp(rxSrc, 'i')
    return [...document.querySelectorAll('a,button')].find(e => rx.test(e.textContent || '')) || null
  }, src)
  const el = handle.asElement()
  if (!el) return false
  await (el as any).click()
  return true
}

/**
 * Déroule l'écran on-site dans un vrai navigateur puis rend la main à l'écran
 * des codes. On DESSINE réellement sur le canvas (ce que le HTTP ne sait pas faire).
 */
/** Ce que le chauffeur a déclaré, traduit en codes VAB. */
export interface VabCodes {
  /** 'tow' = le véhicule est remorqué (déclare la DEMANDE DE REM chez eux). */
  issue: 'tow' | 'fixed'
  /** Code panne « niveau1|niveau2 ». Défaut : Divers — Autre Problème. */
  breakdown?: string
  /** Remorquage : pays (21 = Belgique) et code postal de destination. */
  destCountry?: string
  destZip?: string
}

// Codes de la liste VAB (relevés sur leur écran, 22 solutions / 351 pannes).
const SOL_TOW   = '814|13938'    // Pas Résolue   — Remorquage
const SOL_FIXED = '12900|13917'  // Mobilité Rétablit — Problème Résolue
const BRK_OTHER = '4004|4066'    // Divers — Autre Problème

export async function vabCloseOnSiteBrowser(opts: {
  assignmentId: string
  km: string
  vinLastDigits: string
  /** Châssis COMPLET. Certains dossiers n'ont pas les 3 derniers chiffres à
   *  saisir mais un champ « Numéro de châssis » vide ET obligatoire — sans lui,
   *  « Fin lieu de la panne » ne fait rien. Vu le 14/08 sur 2HLP070. */
  vinFull?: string
  /** Fourni → on enchaîne sur l'écran de codes et on confirme. */
  codes?: VabCodes
}): Promise<VabBrowserResult> {
  const steps: string[] = []
  let browser: Browser | null = null
  let cookieHeader = ''
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.setUserAgent(DESKTOP_UA)
    await loginInBrowser(page)
    await page.goto(detailsUrl(opts.assignmentId), { waitUntil: 'domcontentloaded', timeout: 30000 })

    // On-site prêt = champ km OU canvas signature OU écran code (vélo « Fiets » :
    // pas de km → on ne bloque pas sur wtInput_MileageCheck).
    const ready = await page.waitForSelector('input[id*="wtInput_MileageCheck"], [id*="wtSignatureContainer"], select[id*="SolutionCodeLevel1"]', { timeout: 25000 }).catch(() => null)
    if (!ready) {
      const diag = await page.evaluate(() => `${document.title} | ${location.href} | ${document.body?.innerText?.slice(0, 160) || ''}`)
      return { ok: false, onCodeScreen: false, cookieHeader, osvstate: null, steps, error: 'écran on-site/code non trouvé', diag }
    }

    // VAB construit ses listes APRÈS l'affichage : tester tout de suite renvoie
    // un écran de codes vide et fait repartir la séquence dans le décor. On lui
    // laisse le temps — « prévoir un wait de 5 secondes n'est pas du luxe »
    // (Olivier 2026-08-14). On sort dès que l'un des deux écrans est certain.
    for (let i = 0; i < 4; i++) {
      if (await isCodeScreen(page)) break
      if (await page.$('input[id*="wtInput_MileageCheck"]')) {
        // Écran on-site : les listes ne viendront pas, inutile d'attendre plus.
        if (i >= 1) break
      }
      await new Promise(r => setTimeout(r, 5000))
    }

    // Même piège ici : la simple présence du select ne prouve rien.
    const alreadyCodes = await isCodeScreen(page)
    if (alreadyCodes) {
      steps.push('déjà écran code')
    } else {
      if (await clearAndType(page, 'input[id*="wtInput_MileageCheck"]', String(opts.km))) steps.push('km')

      // ⚠️ Le KILOMÉTRAGE a son propre bouton « Vérifier », exactement comme le
      // châssis (Olivier 2026-08-14). Sans ce clic, le drapeau « km vérifié »
      // n'est pas posé et « Fin lieu de la panne » ne fait rien — la séquence
      // semblait pourtant complète. Une pop-up d'arrondi peut suivre : on
      // l'accepte, comme pour le VIN inconnu.
      if (String(opts.km || '').trim()) {
        const cliqué = await page.evaluate(() => {
          const a = [...document.querySelectorAll('a, button')].find(e => /wtLink_CheckMileage/.test((e as HTMLElement).id || ''))
            || [...document.querySelectorAll('a, button')].find(e => /^\s*v[ée]rifier\s*$/i.test(e.textContent || ''))
          if (!a) return false
          ;(a as HTMLElement).click()
          return true
        }).catch(() => false)
        if (cliqué) {
          steps.push('vérifier kilométrage')
          await new Promise(r => setTimeout(r, 5000))
          // Pop-up « kilométrage arrondi » : répondre oui, dans la page et dans
          // les frames.
          for (const fr of page.frames()) {
            try {
              await fr.evaluate(() => {
                const el = [...document.querySelectorAll('a,button')]
                  .find(e => /^\s*(oui|ja|yes|ok)\s*$/i.test((e.textContent || '').trim()))
                if (el) (el as HTMLElement).click()
              })
            } catch { /* frame indisponible */ }
          }
          await new Promise(r => setTimeout(r, 3000))
        }
      }

      // Châssis complet attendu et vide → on le saisit.
      if (opts.vinFull) {
        const posé = await page.evaluate((vin: string) => {
          const c = document.querySelector('input[id*="wtChassisNumberInput"]') as HTMLInputElement | null
          if (!c || (c.value || '').length > 5) return false
          c.focus(); c.value = vin
          c.dispatchEvent(new Event('input', { bubbles: true }))
          c.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        }, opts.vinFull).catch(() => false)
        if (posé) { steps.push('châssis complet saisi'); await new Promise(r => setTimeout(r, 5000)) }
      }

      const chassisOk = await page.evaluate(() => {
        const c = document.querySelector('input[id*="wtChassisNumberInput"]') as HTMLInputElement | null
        return !!(c && c.value && c.value.length > 5)
      })
      if (!chassisOk) {
        if (await clearAndType(page, 'input[id*="wtLastDigitInputField"]', String(opts.vinLastDigits).slice(-3))) {
          await page.evaluate(() => {
            const v = document.querySelector('input[id*="wtLastDigitInputField"]') as HTMLInputElement
            v && v.dispatchEvent(new Event('change', { bubbles: true }))
          })
          await new Promise(r => setTimeout(r, 500))
          await clickByText(page, 'vérifier|verifier|check')
          await new Promise(r => setTimeout(r, 3000))
          // Popup « Non-concordance châssis » = IFRAME → cliquer « Oui » dedans
          // (bypass VIN inconnu). Sinon la modale masque le canvas → dessin bloqué.
          let clickedOui = false
          for (let t = 0; t < 8 && !clickedOui; t++) {
            clickedOui = await clickOuiInFrames(page)
            if (!clickedOui) await new Promise(r => setTimeout(r, 1000))
          }
          await new Promise(r => setTimeout(r, 2000))
          // Cocher « Unknown VIN » (wt436_wt20, apparu après Vérifier+Oui) : sinon
          // « Numéro de châssis doit être rempli » bloque Fin lieu de la panne.
          await page.evaluate(() => {
            const cb = document.querySelector('input[type=checkbox][id*="wt436_wt20"], input[type=checkbox][id*="_wt20"]') as HTMLInputElement | null
            if (cb && !cb.checked) cb.click()
          })
          await new Promise(r => setTimeout(r, 2000))
          steps.push('vin+verifier+unknownvin')
        }
      } else { steps.push('vin déjà validé') }

      // ⚠️ Sur certains dossiers, le canevas n'est pas encore ouvert : il reste un
      // bouton « Obtenir la signature ». On dessinait alors dans le vide, et
      // « Fin lieu de la panne » ne faisait rien — sans que rien ne le dise. Vu
      // sur 2HXU702 le 19/08, dont le kilométrage et le châssis étaient pourtant
      // déjà remplis chez eux.
      const aOuvrir = await page.evaluate(() => {
        const c = document.querySelector('[id*="wtSignatureContainer"] canvas, .SignatureContainer canvas')
        if (c) return false
        const b = [...document.querySelectorAll('a, button')].find(e => /wtLink_GetSignature/.test((e as HTMLElement).id || ''))
        if (!b) return false
        ;(b as HTMLElement).click(); return true
      }).catch(() => false)
      if (aOuvrir) { steps.push('ouvrir la signature'); await new Promise(r => setTimeout(r, 5000)) }

      const drawn = await drawSignature(page)
      if (drawn) steps.push('signature dessinée')
      else {
        // Repli NATIF : la page offre « Créer la signature en blanc ». Dessiner
        // dans le canvas est fragile (widget JS) ; ce lien fait le même travail
        // et c'est celui qu'un humain utilise quand le client n'est pas là.
        // Vu le 14/08 sur 8387746 : le dessin ne prenait pas, « Envoyer » ne
        // sauvait donc ni le kilométrage ni la signature. Olivier 2026-08-14.
        const blank = await page.evaluate(() => {
          const a = [...document.querySelectorAll('a, button')]
            .find(e => /cr[ée]er la signature en blanc/i.test(e.textContent || ''))
          if (!a) return false
          ;(a as HTMLElement).click()
          return true
        })
        if (!blank) return { ok: false, onCodeScreen: false, cookieHeader, osvstate: null, steps, error: 'signature impossible (ni canvas ni lien blanc)' }
        steps.push('signature en blanc')
        await new Promise(r => setTimeout(r, 1500))
      }

      // ⚠️ DERNIÈRE VÉRIFICATION avant d'envoyer : le champ « Numéro de châssis »
      // n'apparaît parfois qu'APRÈS la pop-up « VIN inconnu ». Quand on le
      // remplissait plus haut, il n'était pas encore dans la page — et VAB
      // bloquait ensuite sur un champ obligatoire vide, sans le dire. Vu le 16/08
      // sur 2HDJ908, dont le châssis était pourtant sur la fiche. On tape au
      // clavier plutôt que d'écrire la valeur : OutSystems écoute la frappe.
      if (opts.vinFull) {
        const vide = await page.evaluate(() => {
          const c = document.querySelector('input[id*="wtChassisNumberInput"]') as HTMLInputElement | null
          return !!c && (c.value || '').length <= 5
        }).catch(() => false)
        if (vide && await clearAndType(page, 'input[id*="wtChassisNumberInput"]', opts.vinFull)) {
          await page.evaluate(() => {
            const c = document.querySelector('input[id*="wtChassisNumberInput"]') as HTMLInputElement | null
            c && c.dispatchEvent(new Event('change', { bubbles: true }))
          })
          steps.push('châssis complet saisi (2e passe)')
          await new Promise(r => setTimeout(r, 5000))
        }
      }

      await clickByText(page, 'envoyer')
      await new Promise(r => setTimeout(r, 2500))
      // Preuve que l'envoi a pris : le kilométrage est retenu par la page.
      const kmSaved = await page.evaluate(() => {
        const el = [...document.querySelectorAll('input')].find(i => /MileageCheck/i.test(i.id || i.name || '')) as HTMLInputElement | undefined
        return el ? (el.value || '').trim() : ''
      }).catch(() => '')
      steps.push(kmSaved ? `envoyer (km retenu: ${kmSaved})` : 'envoyer (⚠ rien retenu)')

      // Diagnostic AVANT le clic final : quels champs l'écran attend-il encore ?
      // Deviner coûte un aller-retour complet à chaque essai ; regarder, un seul.
      const etat = await page.evaluate(() => {
        const out: string[] = []
        document.querySelectorAll('input[type=text], select, textarea').forEach((e: any) => {
          const id = (e.id || e.name || '').split('_').slice(-2).join('_')
          if (!id) return
          const v = (e.value ?? '').toString().slice(0, 24)
          const req = /Mandatory|Required/i.test(e.className || '')
          if (req || !v) out.push(`${id}=${JSON.stringify(v)}${req ? ' (obligatoire)' : ''}`)
        })
        return out.slice(0, 18).join(' · ')
      }).catch(() => '')
      if (etat) steps.push(`état écran: ${etat}`)

      await clickByText(page, 'fin lieu de la panne')
      await new Promise(r => setTimeout(r, 3500))
      // Popup « kilométrage arrondi » éventuel → « Oui » (dans les frames).
      for (const fr of page.frames()) {
        try { await fr.evaluate(() => { const el = [...document.querySelectorAll('a,button')].find(e => /^oui$/i.test((e.textContent || '').trim())); if (el) (el as HTMLElement).click() }) } catch { /* frame */ }
      }
      // Le postback Fin met du temps à poser l'écran code → poll.
      for (let i = 0; i < 8; i++) {
        if (await isCodeScreen(page)) break
        await new Promise(r => setTimeout(r, 5000))
      }
      steps.push('fin lieu de la panne')
    }

    let onCodeScreen = await isCodeScreen(page)

    // Écran de codes pas encore là : on RECHARGE la fiche. Vu le 14/08 sur
    // 56154118 — la séquence va bien jusqu'au bout, mais le postback « Fin lieu
    // de la panne » laisse une page intermédiaire ; l'écran de codes n'apparaît
    // qu'à la relecture du dossier. Olivier 2026-08-14.
    if (!onCodeScreen && !steps.some(x => x.includes('⚠ rien retenu'))) {
      await page.goto(detailsUrl(opts.assignmentId), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
      await new Promise(r => setTimeout(r, 2500))
      onCodeScreen = await isCodeScreen(page)
      if (onCodeScreen) steps.push('écran de codes (après rechargement)')
      else {
        // On dit CE QU'ON VOIT, pour ne pas chercher à l'aveugle la prochaine fois.
        const vu = await page.evaluate(() => {
          const t = [...document.querySelectorAll('a, button, input[type=submit]')]
            .map(e => (e.textContent || (e as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim())
            .filter(x => x && x.length < 28)
          return [...new Set(t)].slice(0, 14).join(' | ')
        }).catch(() => '')
        steps.push(`écran inattendu — boutons vus : ${vu}`)
      }
    }

    // ── ÉCRAN DE CODES ────────────────────────────────────────────────────
    // Pourquoi dans le NAVIGATEUR et pas en HTTP : les contrôles de ce
    // formulaire sont déclarés côté client (« Champ obligatoire ! », « Unité
    // monétaire attendue ! ») et le bouton Confirmer ne s'exécute qu'après leur
    // passage. Un POST direct est donc rejeté quoi qu'on envoie — cinq essais
    // le 14/08 pour s'en convaincre. Ici, les validateurs tournent comme pour
    // un humain. Olivier 2026-08-14.
    //
    // C'est le MÊME écran qui déclare le remorquage : choisir « Pas Résolue —
    // Remorquage » ouvre le formulaire de destination. Sans ce geste, VAB garde
    // un dossier de PANNE là où on a remorqué — 13 cas sur 10 jours.
    let codesConfirmed = false
    if (onCodeScreen && opts.codes) {
      codesConfirmed = await fillAndConfirmCodes(page, opts.assignmentId, opts.codes, steps)
    }

    const osvstate = await page.evaluate(() => {
      const h = document.querySelector('input[name="__OSVSTATE"]') as HTMLInputElement | null
      return h ? h.value : null
    })
    const cookies = await page.cookies()
    cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    return { ok: onCodeScreen, onCodeScreen, codesConfirmed, cookieHeader, osvstate, steps }
  } catch (e: any) {
    return { ok: false, onCodeScreen: false, cookieHeader, osvstate: null, steps, error: e?.message || String(e) }
  } finally {
    if (browser) await browser.close()
  }
}

/**
 * Remplit l'écran de codes et confirme. Renvoie true si l'écran a disparu.
 */
async function fillAndConfirmCodes(page: Page, assignmentId: string, c: VabCodes, steps: string[]): Promise<boolean> {
    let codesConfirmed = false
    {
      // Les listes arrivent APRÈS l'écran : juste après « Fin lieu de la panne »,
      // le select des solutions ne contient encore que son tiret. On l'attend, et
      // on recharge la fiche si besoin — sans risque désormais, tout est
      // enregistré. Vu le 14/08 : sans cette attente, les trois choix tombaient
      // dans le vide et « Confirmer » repartait en arrière.
      const optionsReady = async () => page.evaluate(() => {
        const sel = [...document.querySelectorAll('select')].find(x => /SolutionCodeLevel1/i.test(x.id || x.getAttribute('name') || ''))
        return sel ? (sel as HTMLSelectElement).options.length : 0
      }).catch(() => 0)
      for (let i = 0; i < 6 && (await optionsReady()) <= 1; i++) await new Promise(r => setTimeout(r, 5000))
      if ((await optionsReady()) <= 1) {
        await page.goto(detailsUrl(assignmentId), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
        await new Promise(r => setTimeout(r, 5000))
        for (let i = 0; i < 4 && (await optionsReady()) <= 1; i++) await new Promise(r => setTimeout(r, 5000))
      }
      const nbBrk = await page.evaluate(() => {
        const sel = [...document.querySelectorAll('select')].find(x => /BreakdownCodeLevel1/i.test(x.id || ''))
        return sel ? (sel as HTMLSelectElement).options.length : 0
      }).catch(() => 0)
      steps.push(`listes: solutions ${await optionsReady()} · pannes ${nbBrk}`)
      const pick = async (idPart: string, value: string) => {
        const sel = await page.$(`select[id*="${idPart}"]`)
        if (!sel) return false
        const ok = await page.evaluate((el: any, v: string) => {
          const has = [...el.options].some((o: any) => o.value === v)
          if (!has) return false
          el.value = v
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        }, sel, value)
        if (ok) await new Promise(r => setTimeout(r, 5000))   // VAB est lent entre deux écrans
        return ok
      }
      const type = async (idPart: string, value: string) => {
        const el = await page.$(`input[id*="${idPart}"]`)
        if (!el) return false
        // On vide par le DOM (le triple-clic n'est pas disponible ici), puis on
        // tape : VAB écoute la frappe, pas seulement la valeur.
        await page.evaluate((n: any) => { (n as HTMLInputElement).value = '' }, el)
        await el.type(value)
        return true
      }

      if (await pick('SolutionCodeLevel1', c.issue === 'tow' ? SOL_TOW : SOL_FIXED))
        steps.push(c.issue === 'tow' ? 'solution: remorquage' : 'solution: mobilité rétablie')
      if (await pick('BreakdownCodeLevel1', c.breakdown || BRK_OTHER)) steps.push('code panne')

      // Carnet d'entretien « Numérique » : sur « Lisible », VAB exige en plus le
      // garage et la date du dernier entretien, que personne ne collecte.
      const radioOk = await page.evaluate(() => {
        const r = [...document.querySelectorAll('input[type=radio]')] as HTMLInputElement[]
        const num = r.find(x => x.value === '3')
        if (!num) return false
        num.click()
        return true
      })
      if (radioOk) { steps.push('carnet: numérique'); await new Promise(r => setTimeout(r, 5000)) }

      // Coût supplémentaire : TOUJOURS 0 (Olivier). Détour idem.
      await type('BreakdownExtraCostInput', '0')
      await type('Input_DetourNrOfKm', '0')

      if (c.issue === 'tow') {
        if (c.destCountry && await pick('ComboBox_Destination_Country', c.destCountry)) steps.push('pays destination')
        if (c.destZip) {
          const zipOk = await page.evaluate((zip: string) => {
            const sel = [...document.querySelectorAll('select')].find(s => /ZipcodeCity/i.test(s.id)) as HTMLSelectElement | undefined
            if (!sel) return false
            const opt = [...sel.options].find(o => o.text.trim().startsWith(zip))
            if (!opt) return false
            sel.value = opt.value
            sel.dispatchEvent(new Event('change', { bubbles: true }))
            return true
          }, c.destZip)
          if (zipOk) { steps.push('ville destination'); await new Promise(r => setTimeout(r, 5000)) }
        }
      }

      // Confirmer (= wtLink_End). Une confirmation navigateur peut s'afficher.
      page.on('dialog', d => { d.accept().catch(() => {}) })
      const confirmed = await page.evaluate(() => {
        const a = [...document.querySelectorAll('a')].find(x => /^\s*Confirmer\s*$/i.test(x.textContent || ''))
        if (!a) return false
        ;(a as HTMLElement).click()
        return true
      })
      if (confirmed) {
        steps.push('confirmer')
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {})
        await new Promise(r => setTimeout(r, 5000))
        // Preuve : l'écran de codes a disparu.
        codesConfirmed = !(await isCodeScreen(page))
        steps.push(codesConfirmed ? 'dossier soldé' : 'confirmation refusée')
      }
    }
  return codesConfirmed
}

/**
 * Entrée DIRECTE sur l'écran de codes, pour un dossier qui a déjà passé la
 * signature. `vabCloseOnSiteBrowser` part du kilométrage et abandonne ici —
 * « signature impossible » — puisque le canvas n'existe plus.
 * Olivier 2026-08-14 : « clôture les dossiers un par un ».
 */
export async function vabConfirmCodesBrowser(opts: {
  assignmentId: string
  codes: VabCodes
}): Promise<VabBrowserResult> {
  const steps: string[] = []
  let browser: Browser | null = null
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.setUserAgent(DESKTOP_UA)
    await loginInBrowser(page)
    await page.goto(detailsUrl(opts.assignmentId), { waitUntil: 'domcontentloaded', timeout: 30000 })

    // L'écran met plusieurs secondes à peupler ses listes ; tant qu'elles sont
    // vides, les trois choix tombent dans le vide.
    let onCodeScreen = false
    for (let i = 0; i < 8 && !onCodeScreen; i++) {
      await new Promise(r => setTimeout(r, 5000))
      onCodeScreen = await isCodeScreen(page)
    }
    if (!onCodeScreen) {
      const diag = await page.evaluate(() => {
        const sels = [...document.querySelectorAll('select')].map(s => `${s.id}=${(s as HTMLSelectElement).options.length}`)
        return `${location.href} | selects: ${sels.join(', ') || 'aucun'} | ${(document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 220)}`
      }).catch(() => '')
      return { ok: false, onCodeScreen: false, cookieHeader: '', osvstate: null, steps, error: 'écran de codes non atteint', diag }
    }

    const codesConfirmed = await fillAndConfirmCodes(page, opts.assignmentId, opts.codes, steps)
    return { ok: codesConfirmed, onCodeScreen: true, codesConfirmed, cookieHeader: '', osvstate: null, steps }
  } catch (e: any) {
    return { ok: false, onCodeScreen: false, cookieHeader: '', osvstate: null, steps, error: e?.message || String(e) }
  } finally {
    if (browser) await browser.close()
  }
}
