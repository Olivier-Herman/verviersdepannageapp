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
const detailsUrl = (assignmentId: string) =>
  `${BASE}/Comet/BreakdownAssignments_Details.aspx?AssignmentId=${assignmentId}`

export interface VabBrowserResult {
  ok: boolean
  onCodeScreen: boolean
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
  // Login) qui détruisent le contexte : on POLL le champ user (tolérant aux navs)
  // plutôt qu'un waitForSelector qui casse.
  await page.goto(`${BASE}/Comet/Home.aspx`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  let userField = null
  for (let i = 0; i < 15 && !userField; i++) {
    await new Promise(r => setTimeout(r, 1200))
    try { userField = await page.$('input[id*="wtUserNameInput"]') } catch { /* nav en cours */ }
  }
  if (!userField) throw new Error('formulaire de login VAB introuvable (redirections)')
  await page.type('input[id*="wtUserNameInput"]', email)
  await page.type('input[id*="wtPasswordInput"]', password)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
    page.click('a[id*="wtLoginButton"], input[id*="wtLoginButton"]'),
  ])
  // Laisser la redirection post-login (→ Assignments) se poser.
  await new Promise(r => setTimeout(r, 2000))
}

async function clearAndType(page: Page, selector: string, value: string): Promise<boolean> {
  const el = await page.$(selector)
  if (!el) return false
  await page.evaluate((s) => { const e = document.querySelector(s) as HTMLInputElement | null; if (e) e.value = '' }, selector)
  await el.type(value)
  return true
}

/** Dessine un trait sur le canvas de signature (mouse events réels). */
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
export async function vabCloseOnSiteBrowser(opts: {
  assignmentId: string
  km: string
  vinLastDigits: string
}): Promise<VabBrowserResult> {
  const steps: string[] = []
  let browser: Browser | null = null
  let cookieHeader = ''
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await loginInBrowser(page)
    await page.goto(detailsUrl(opts.assignmentId), { waitUntil: 'domcontentloaded', timeout: 30000 })

    const ready = await page.waitForSelector('input[id*="wtInput_MileageCheck"], [id*="SolutionCode"]', { timeout: 20000 }).catch(() => null)
    if (!ready) {
      const diag = await page.evaluate(() => `${document.title} | ${location.href} | ${document.body?.innerText?.slice(0, 160) || ''}`)
      return { ok: false, onCodeScreen: false, cookieHeader, osvstate: null, steps, error: 'écran on-site/code non trouvé', diag }
    }

    const alreadyCodes = await page.$('[id*="SolutionCode"]')
    if (alreadyCodes) {
      steps.push('déjà écran code')
    } else {
      if (await clearAndType(page, 'input[id*="wtInput_MileageCheck"]', String(opts.km))) steps.push('km')

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
          await new Promise(r => setTimeout(r, 1500))
          const clickedOui = await clickByText(page, '^oui$|^yes$')
          if (!clickedOui) {
            await page.evaluate(() => {
              const cb = document.querySelector('input[type=checkbox][id*="wt20"]') as HTMLInputElement | null
              if (cb && !cb.checked) cb.click()
            })
          }
          await new Promise(r => setTimeout(r, 800))
          steps.push('vin+verifier')
        }
      } else { steps.push('vin déjà validé') }

      const drawn = await drawSignature(page)
      if (!drawn) return { ok: false, onCodeScreen: false, cookieHeader, osvstate: null, steps, error: 'canvas signature introuvable/non rempli' }
      steps.push('signature dessinée')

      await clickByText(page, 'envoyer')
      await new Promise(r => setTimeout(r, 1500))
      steps.push('envoyer')

      await clickByText(page, 'fin lieu de la panne')
      await page.waitForSelector('[id*="SolutionCode"]', { timeout: 20000 }).catch(() => {})
      steps.push('fin lieu de la panne')
    }

    const onCodeScreen = !!(await page.$('[id*="SolutionCode"]'))
    const osvstate = await page.evaluate(() => {
      const h = document.querySelector('input[name="__OSVSTATE"]') as HTMLInputElement | null
      return h ? h.value : null
    })
    const cookies = await page.cookies()
    cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    return { ok: onCodeScreen, onCodeScreen, cookieHeader, osvstate, steps }
  } catch (e: any) {
    return { ok: false, onCodeScreen: false, cookieHeader, osvstate: null, steps, error: e?.message || String(e) }
  } finally {
    if (browser) await browser.close()
  }
}
