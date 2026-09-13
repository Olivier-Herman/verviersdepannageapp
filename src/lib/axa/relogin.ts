// src/lib/axa/relogin.ts
//
// Reconnexion AUTOMATIQUE à go&assist (Olivier 13/09/2026 : « qu'est-ce qui
// t'empêche de le faire avec Puppeteer si j'indique mes identifiants dans
// Vercel ? »). Les refresh tokens du client web ont une durée de vie absolue
// de 24 h (prouvé : 29 échanges réussis, mort à 24 h pile). Le portail lui-même
// se reconnecte chaque jour ; on fait pareil, sans écran ni PC : Chrome sans
// tête (le même que pour VAB Comet), login Auth0 avec AXA_PORTAL_EMAIL /
// AXA_PORTAL_PASSWORD, lecture du refresh token dans le stockage du portail,
// amorçage. Si Auth0 exige un code ou une passkey, on s'arrête et on le dit.

import { launchBrowser } from '@/lib/vab/sign-browser'
import { setAxaRefreshToken, getAxaAccessToken } from '@/lib/axa/auth'

const PORTAL = 'https://go-and-assist.axapartners.com'

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

export async function reloginAxa(onStep?: (steps: string[]) => Promise<void> | void): Promise<AxaReloginResult> {
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
      if (tok) { steps.push('session déjà ouverte'); return await seed(tok, steps) }
      return { ok: false, steps, error: `page de connexion non reconnue (${page.url()})` }
    }
    steps.push('page de connexion Auth0')
    await page.type(idSel, email, { delay: 20 })
    // Deux gabarits : identifiant + mot de passe sur la même page, ou en deux temps.
    const pwdSel = 'input[name="password"], input#password, input[type="password"]'
    // Universal Login « identifiant d'abord » : la page porte un champ mot de passe
    // CACHÉ. On ne s'y fie pas : seul un champ visible compte.
    const pwdVisible = async () => page.$$eval(pwdSel, els => els.some(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 })).catch(() => false)
    if (!(await pwdVisible())) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
        page.keyboard.press('Enter'),
      ])
      for (let i = 0; i < 20 && !(await pwdVisible()); i++) await new Promise(r => setTimeout(r, 1000))
      if (!(await pwdVisible())) {
        const txt = await page.evaluate(() => document.body?.innerText?.replace(/\s+/g, ' ').slice(0, 200) || '').catch(() => '')
        return { ok: false, steps, error: `pas de champ mot de passe après l'identifiant (${page.url()}) : ${txt}` }
      }
      steps.push('identifiant validé')
    }
    await page.evaluate((sel: string) => { const el = [...document.querySelectorAll(sel)].find(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 }) as HTMLInputElement | undefined; el?.focus() }, pwdSel)
    await page.keyboard.type(password, { delay: 20 })
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
    steps.push('mot de passe envoyé')
    // Retour au portail ? Sinon : MFA / passkey / erreur — on lit ce qu'Auth0 affiche.
    for (let i = 0; i < 20; i++) {
      const url = page.url()
      if (url.startsWith(PORTAL)) break
      const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 400) || '').catch(() => '')
      if (/passkey|clé d.accès|security key|code|vérification|verification|authenticator|one-time/i.test(txt)) {
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
    return await seed(tok, steps, email)
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
