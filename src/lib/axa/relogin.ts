// src/lib/axa/relogin.ts
//
// Reconnexion AUTOMATIQUE à go&assist (Olivier 13/09/2026 : « qu'est-ce qui
// t'empêche de le faire avec Puppeteer si j'indique mes identifiants dans
// Vercel ? »). Les refresh tokens du client web ont une durée de vie absolue
// de 24 h (prouvé : 29 échanges réussis, mort à 24 h pile). Le portail lui-même
// se reconnecte chaque jour ; on fait pareil, sans écran ni PC : Chrome sans
// tête (le même que pour VAB Comet), login Auth0 avec AXA_PORTAL_EMAIL /
// AXA_PORTAL_PASSWORD, lecture du refresh token dans le stockage du portail,
// amorçage. Depuis le 11/11/2026, Auth0 envoie un code par mail à chaque
// connexion : on le lit dans la boîte du compte (lib/axa/mfa-code.ts) et on le
// tape. Une passkey ou un code introuvable : on s'arrête et on le dit.

import { launchBrowser } from '@/lib/vab/sign-browser'
import { setAxaRefreshToken, getAxaAccessToken } from '@/lib/axa/auth'
import { waitAxaMfaCode, deleteAxaMfaMails } from '@/lib/axa/mfa-code'

const PORTAL = 'https://go-and-assist.axapartners.com'
const AUTH0  = 'https://axa-partners-eu-providers.eu.auth0.com'
/** Session Auth0 du robot (cookies « auth0 », « did »…), gardée d'une connexion à l'autre comme dans un vrai navigateur :
 *  AXA reconnaît l'appareil et la session encore ouverte, sans captcha ni code (Olivier 14/11/2026 : « je ne vais pas
 *  m'amuser à faire ça tous les jours »). Stockée côté serveur seulement (app_settings, clé de service). */
export const AXA_SESSION_KEY = 'axa_auth0_session'

async function lireSession(): Promise<any[]> {
  try {
    const { createAdminClient } = await import('@/lib/supabase')
    const { data } = await createAdminClient().from('app_settings').select('value').eq('key', AXA_SESSION_KEY).maybeSingle()
    const v = data?.value ? JSON.parse(data.value) : null
    return Array.isArray(v?.cookies) ? v.cookies : []
  } catch { return [] }
}
async function garderSession(page: any): Promise<number> {
  try {
    const cookies = (await page.cookies(AUTH0 + '/', PORTAL + '/')).filter((c: any) => c?.name && c?.value)
    if (!cookies.length) return 0
    const { createAdminClient } = await import('@/lib/supabase')
    await createAdminClient().from('app_settings').upsert({ key: AXA_SESSION_KEY, value: JSON.stringify({ at: new Date().toISOString(), cookies }) }, { onConflict: 'key' })
    return cookies.length
  } catch { return 0 }
}

export interface AxaReloginResult { ok: boolean; steps: string[]; error?: string; email?: string | null }

async function readRefreshToken(page: any): Promise<string | null> {
  return page.evaluate(() => {
    try {
      const direct = localStorage.getItem('userRefreshToken')
      if (direct && /^v1\./.test(direct)) return direct
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || ''
        if (k.startsWith('@@auth0spajs@@')) {
          try { const b = JSON.parse(localStorage.getItem(k) || '{}'); if (b?.body?.refresh_token) return b.body.refresh_token } catch {}
        }
      }
    } catch {}
    return null
  }).catch(() => null)
}

/**
 * Captcha d'Auth0 (« Enter the code shown above ») : le robot ne le résout pas. En reconnexion manuelle,
 * `askCaptcha` montre l'image à Mobi sur son téléphone et rend ce qu'il a tapé (Olivier 14/11/2026 : reconnexion
 * impossible depuis l'iPhone avec la méthode du jeton). Sans `askCaptcha` (reconnexions automatiques) : on s'arrête.
 */
export interface ReloginOptions { askCaptcha?: (pngBase64: string) => Promise<string | null> }

export async function reloginAxa(onStep?: (steps: string[]) => Promise<void> | void, opts: ReloginOptions = {}): Promise<AxaReloginResult> {
  const email = process.env.AXA_PORTAL_EMAIL, password = process.env.AXA_PORTAL_PASSWORD
  const raw: string[] = []
  // Chaque étape est écrite tout de suite (console + trace) : si la fonction est
  // tuée par le délai Vercel, on sait où elle en était.
  const steps = new Proxy(raw, { get(t, k) { if (k === 'push') return (...items: string[]) => { const n = t.push(...items); for (const it of items) console.log('[axa/relogin]', it); try { void onStep?.(t.slice()) } catch {} ; return n }; return (t as any)[k] } }) as string[]
  if (!email || !password) return { ok: false, steps, error: 'AXA_PORTAL_EMAIL / AXA_PORTAL_PASSWORD absents' }
  steps.push('lancement du navigateur')
  const browser = await launchBrowser()
  steps.push('navigateur prêt')
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(30000)
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')
    const gardes = await lireSession()
    if (gardes.length) {
      await page.setCookie(...gardes.map((c: any) => { const { size, session, partitionKey, sourceScheme, sourcePort, ...k } = c; return k })).catch(() => {})
      steps.push(`session AXA reprise (${gardes.length} cookies)`)
    }
    await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    steps.push('portail ouvert')
    // Page d'accueil du portail : bandeau cookies (OneTrust), case de consentement,
    // bouton « SIGN IN » (#authentication-login-button) → redirection Auth0.
    const idSel = 'input[name="username"], input[name="email"], input#username, input[type="email"]'
    await new Promise(r => setTimeout(r, 2500))
    const clicked = await page.evaluate(() => {
      const ot = document.querySelector('#onetrust-accept-btn-handler, #onetrust-reject-all-handler') as HTMLElement | null
      if (ot) ot.click()
      const cb = document.querySelector('form input[type=checkbox], input[type=checkbox]') as HTMLInputElement | null
      if (cb && !cb.checked) cb.click()
      const btn = (document.querySelector('#authentication-login-button') as HTMLElement | null)
        || [...document.querySelectorAll('button, a')].find(e => /sign in|se connecter|connexion|login/i.test((e as HTMLElement).innerText || '')) as HTMLElement | undefined
      if (btn) { btn.click(); return true }
      return false
    }).catch(() => false)
    if (clicked) steps.push('SIGN IN cliqué')
    try { await page.waitForSelector(idSel, { timeout: 30000 }) } catch {
      // Déjà connecté (session Auth0 vivante) ? Alors le token est peut-être là.
      const tok = await readRefreshToken(page)
      if (tok) { steps.push('session déjà ouverte'); const r = await seed(tok, steps); if (r.ok) { const n = await garderSession(page); if (n) steps.push('session AXA gardée') } return r }
      return { ok: false, steps, error: `page de connexion non reconnue (${page.url()})` }
    }
    steps.push('page de connexion Auth0')
    await page.type(idSel, email, { delay: 20 })
    const capSel = 'input[name="captcha"], input#captcha, input[name*="captcha" i]'
    const visible = (sel: string) => page.$$eval(sel, els => els.some(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 })).catch(() => false)
    /** Captcha à l'écran : image envoyée à Mobi, sa réponse tapée. Rend un message d'erreur, ou null si rien à faire / fait. */
    const resoudreCaptcha = async (): Promise<string | null> => {
      if (!(await visible(capSel))) return null
      if (!opts.askCaptcha) return 'captcha AXA à l’écran : reconnexion à faire depuis Admin › AXA go&assist (« Reconnecter maintenant », le captcha s’affiche sur ton téléphone)'
      const img = await page.$('img[alt*="captcha" i], img[src*="captcha" i], .ulp-captcha img, [class*="captcha" i] img, img[src^="data:image"]')
      const png = img ? await img.screenshot({ encoding: 'base64' }) as string : await page.screenshot({ encoding: 'base64' }) as string
      steps.push('captcha affiché : réponse demandée à Mobi')
      const rep = String(await opts.askCaptcha(png) || '').trim()
      if (!rep) return 'personne n’a tapé le captcha dans les 2 minutes'
      await page.$$eval(capSel, els => { for (const e of els) (e as HTMLInputElement).value = '' }).catch(() => {})
      await page.evaluate((sel: string) => { const el = [...document.querySelectorAll(sel)].find(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 }) as HTMLInputElement | undefined; el?.focus() }, capSel)
      await page.keyboard.type(rep, { delay: 40 })
      steps.push('captcha tapé')
      return null
    }
    // Deux gabarits : identifiant + mot de passe sur la même page, ou en deux temps.
    const pwdSel = 'input[name="password"], input#password, input[type="password"]'
    // Universal Login « identifiant d'abord » : la page porte un champ mot de passe
    // CACHÉ. On ne s'y fie pas : seul un champ visible compte.
    const pwdVisible = async () => page.$$eval(pwdSel, els => els.some(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 })).catch(() => false)
    if (!(await pwdVisible())) {
      // Un captcha mal lu revient avec une nouvelle image : jusqu'à 3 essais.
      for (let tour = 0; tour < 3; tour++) {
        const errCap = await resoudreCaptcha()
        if (errCap) return { ok: false, steps, error: errCap }
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
          page.keyboard.press('Enter'),
        ])
        for (let i = 0; i < 20 && !(await pwdVisible()) && !(await visible(capSel)); i++) await new Promise(r => setTimeout(r, 1000))
        if (await pwdVisible() || !(await visible(capSel))) break
        steps.push('captcha refusé, nouvelle image')
        const vide = await page.$$eval(idSel, els => els.some(e => !(e as HTMLInputElement).value)).catch(() => false)
        if (vide) await page.type(idSel, email, { delay: 20 })
      }
      for (let i = 0; i < 10 && !(await pwdVisible()); i++) await new Promise(r => setTimeout(r, 1000))
      if (!(await pwdVisible())) {
        const txt = await page.evaluate(() => document.body?.innerText?.replace(/\s+/g, ' ').slice(0, 200) || '').catch(() => '')
        return { ok: false, steps, error: `pas de champ mot de passe après l'identifiant (${page.url()}) : ${txt}` }
      }
      steps.push('identifiant validé')
    }
    await page.evaluate((sel: string) => { const el = [...document.querySelectorAll(sel)].find(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 }) as HTMLInputElement | undefined; el?.focus() }, pwdSel)
    await page.keyboard.type(password, { delay: 20 })
    { const errCap = await resoudreCaptcha(); if (errCap) return { ok: false, steps, error: errCap } }
    // Un code reçu avant cet instant appartient à une tentative précédente (marge horloge 15 s).
    const mfaSince = Date.now() - 15_000
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
    steps.push('mot de passe envoyé')
    // Retour au portail ? Sinon : MFA / passkey / erreur — on lit ce qu'Auth0 affiche.
    let codeSent = false
    for (let i = 0; i < 20; i++) {
      const url = page.url()
      if (url.startsWith(PORTAL)) break
      const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 400) || '').catch(() => '')
      // Code par mail : champ visible + texte « email … code ». Une seule fois.
      if (!codeSent && /e-?mail/i.test(txt) && /code/i.test(txt)) {
        const codeSel = 'input[name="code"], input#code, input[autocomplete="one-time-code"], input[inputmode="numeric"]'
        const hasField = await page.$$eval(codeSel, els => els.some(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 })).catch(() => false)
        if (hasField) {
          steps.push('code demandé par mail')
          const code = await waitAxaMfaCode(mfaSince, 120_000)
          if (!code) return { ok: false, steps, error: 'AXA a demandé un code par mail, mais aucun code n’est arrivé dans la boîte en 2 minutes.' }
          steps.push('code reçu')
          await page.evaluate((sel: string) => { const el = [...document.querySelectorAll(sel)].find(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 }) as HTMLInputElement | undefined; el?.focus() }, codeSel)
          await page.keyboard.type(code, { delay: 30 })
          // « Se souvenir de cet appareil » (Auth0 : 30 jours sans code) : cochée quand elle est proposée (14/11/2026).
          const souvenir = await page.evaluate(() => {
            const cases = [...document.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[]
            const c = cases.find(x => /remember|souvenir|trust|30|onthoud|vertrouw/i.test((x.closest('label')?.textContent || '') + ' ' + (document.querySelector(`label[for="${x.id}"]`)?.textContent || '') + ' ' + x.name))
            if (c && !c.checked) { c.click(); return true }
            return !!c?.checked
          }).catch(() => false)
          if (souvenir) steps.push('appareil mémorisé chez AXA')
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}),
            page.keyboard.press('Enter'),
          ])
          codeSent = true
          steps.push('code envoyé')
          continue
        }
      }
      // Proposition d'enregistrer une passkey après le code : on la refuse.
      if (codeSent && /passkey|clé d.accès/i.test(txt)) {
        const skipped = await page.evaluate(() => {
          const b = [...document.querySelectorAll('button, a')].find(e => /skip|not now|later|plus tard|continue without|ignorer|passer/i.test((e as HTMLElement).innerText || '')) as HTMLElement | undefined
          if (b) { b.click(); return true }
          return false
        }).catch(() => false)
        if (skipped) { steps.push('passkey refusée'); await new Promise(r => setTimeout(r, 2500)); continue }
      }
      if (codeSent && /invalid|incorrect|wrong|expired|expiré/i.test(txt) && /code/i.test(txt)) {
        return { ok: false, steps, error: `Code AXA refusé : ${txt.replace(/\s+/g, ' ').slice(0, 160)}` }
      }
      if (!codeSent && /passkey|clé d.accès|security key|code|vérification|verification|authenticator|one-time/i.test(txt)) {
        return { ok: false, steps, error: `Auth0 demande une vérification supplémentaire (MFA / passkey) — la reconnexion automatique n'est pas possible pour ce compte. Écran : ${txt.replace(/\s+/g, ' ').slice(0, 160)}` }
      }
      if (/wrong|incorrect|invalid|mot de passe|password/i.test(txt) && /wrong|incorrect|invalid|erron/i.test(txt)) {
        return { ok: false, steps, error: `Identifiants refusés par Auth0 : ${txt.replace(/\s+/g, ' ').slice(0, 160)}` }
      }
      await new Promise(r => setTimeout(r, 1500))
    }
    if (!page.url().startsWith(PORTAL)) return { ok: false, steps, error: `pas revenu sur le portail (${page.url()})` }
    steps.push('retour sur le portail')
    // Le SPA échange le code et pose le token dans localStorage : on attend un peu.
    let tok: string | null = null
    for (let i = 0; i < 20 && !tok; i++) { tok = await readRefreshToken(page); if (!tok) await new Promise(r => setTimeout(r, 1000)) }
    if (!tok) return { ok: false, steps, error: 'refresh token introuvable dans le stockage du portail' }
    steps.push('refresh token lu')
    const res = await seed(tok, steps, email)
    if (res.ok) { const n = await garderSession(page); steps.push(n ? `session AXA gardée (${n} cookies)` : 'session AXA non gardée') }
    // Connexion établie : le mail du code n'a plus d'utilité, on le supprime.
    if (res.ok && codeSent) {
      const n = await deleteAxaMfaMails(mfaSince).catch(() => 0)
      steps.push(n ? `mail du code supprimé (${n})` : 'mail du code non supprimé')
    }
    return res
  } catch (e: any) {
    return { ok: false, steps, error: e?.message || String(e) }
  } finally {
    await browser.close().catch(() => {})
  }
}

async function seed(tok: string, steps: string[], email?: string | null): Promise<AxaReloginResult> {
  await setAxaRefreshToken('web', tok)
  await getAxaAccessToken('web')   // échange immédiat + rotation persistée : le token lu n'est plus réutilisable
  steps.push('amorcé et échangé')
  return { ok: true, steps, email: email ?? null }
}
