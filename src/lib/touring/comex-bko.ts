// src/lib/touring/comex-bko.ts
//
// Client de la plateforme Touring COMEX BKO (apps.touring.be/comex_bko) —
// back-office d'AUTO-FACTURATION Touring (distinct de /Comex = dispatch).
//
// Auth JEE/Spring : j_username=VERVIERS (MAJ) + j_password=sha256(motdepasse).
// Flux OBLIGATOIRE (le pré-vol canILog crée la « saved request » Spring) :
//   1. GET  /web/welcome.do                → JSESSIONID
//   2. POST /web/secured/canILog.do        → pré-vol (sinon "not logged")
//   3. POST /web/j_security_check          → 303, rotation session
//   4. GET  /web/secured/canILog.do        → "logged"
//
// Données : CSV délimité ';', charset ISO-8859-15. Olivier 2026-07-27.

import crypto from 'crypto'

const BASE = 'https://apps.touring.be/comex_bko/web'
const UA   = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

// Plusieurs comptes BKO tournent en parallèle (transition : à terme un seul).
// Chaque compte a ses PROPRES dossiers → on interroge tous les comptes et on
// tague chaque dossier avec son compte (l'acceptation doit repasser par la
// même session). Olivier 2026-07-27.
export interface BkoAccount { label: string; user: string; pass: string }

export function getBkoAccounts(): BkoAccount[] {
  const accts: BkoAccount[] = []
  if (process.env.TOURING_BKO_PASS)
    accts.push({ label: (process.env.TOURING_BKO_USER || 'VERVIERS'), user: (process.env.TOURING_BKO_USER || 'VERVIERS'), pass: process.env.TOURING_BKO_PASS })
  if (process.env.TOURING_BKO_PASS2)
    accts.push({ label: (process.env.TOURING_BKO_USER2 || 'D68357'), user: (process.env.TOURING_BKO_USER2 || 'D68357'), pass: process.env.TOURING_BKO_PASS2 })
  return accts
}

function grabJsession(res: Response, current: string): string {
  const cookies = (res.headers as any).getSetCookie?.() as string[] | undefined
  const list = cookies && cookies.length ? cookies : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])
  for (const c of list) {
    const first = c.split(';')[0]?.trim() || ''
    if (/^JSESSIONID=/.test(first)) return first
  }
  return current
}

function hdr(cookie: string, form = false): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': UA,
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': `${BASE}/secured/accord.do`,
    'Accept': '*/*',
  }
  if (cookie) h['Cookie'] = cookie
  if (form)   h['Content-Type'] = 'application/x-www-form-urlencoded'
  return h
}

/** Ouvre une session COMEX BKO pour un compte donné et retourne le Cookie. */
export async function loginComexBko(account: BkoAccount): Promise<string> {
  const user = (account.user || '').toUpperCase()
  const pass = account.pass || ''
  if (!user || !pass) throw new Error('compte BKO incomplet')
  const hash = sha256(pass)
  const creds = new URLSearchParams({ j_username: user, j_password: hash }).toString()

  let cookie = ''
  // 1) welcome
  let r = await fetch(`${BASE}/welcome.do`, { headers: hdr(cookie), signal: AbortSignal.timeout(20000) })
  cookie = grabJsession(r, cookie)
  // 2) pré-vol canILog (crée la saved request)
  r = await fetch(`${BASE}/secured/canILog.do`, { method: 'POST', headers: hdr(cookie, true), body: creds, redirect: 'manual', signal: AbortSignal.timeout(20000) })
  cookie = grabJsession(r, cookie)
  // 3) j_security_check → 303 + rotation session
  r = await fetch(`${BASE}/j_security_check`, { method: 'POST', headers: hdr(cookie, true), body: creds, redirect: 'manual', signal: AbortSignal.timeout(20000) })
  cookie = grabJsession(r, cookie)
  // 4) confirmation
  r = await fetch(`${BASE}/secured/canILog.do`, { headers: hdr(cookie), signal: AbortSignal.timeout(20000) })
  const txt = (await r.text()).trim()
  if (!/^logged/.test(txt)) throw new Error(`login COMEX BKO échoué (canILog="${txt.slice(0, 40)}")`)
  return cookie
}

export interface BkoDossier {
  account:      string   // compte BKO source (label) — requis pour l'acceptation
  dossier:      string   // n° dossier (file ID) = clé de rapprochement (col 15)
  cidSeqAction: string   // séquence action (col 16)
  commande:     string   // n° commande Touring (col 4)
  prestation:   string   // DEP / REM+... (col 3)
  plaque:       string   // (col 19)
  km:           number   // km proposés COMEX (col 10) — -1 si non fixé
  montant:      number   // total COMEX HTVA (col 11)
  trajet:       string   // codTrajetComex P01/P04… (col 20)
  brand:        string   // (col 28)
  model:        string   // (col 29)
  insurer:      string   // assureur (col 43)
  fileDate:     string   // date dossier (col 2)
}

const num = (s: string | undefined) => { const n = Number((s || '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }

/** Liste des dossiers « en attente » côté COMEX BKO (onglet InWait). */
export async function listComexBkoDossiers(cookie: string, accountLabel = ''): Promise<BkoDossier[]> {
  const r = await fetch(`${BASE}/secured/accord/getDossList.do?dojo.preventCache=${Math.floor(Math.random() * 1e12)}`, {
    headers: hdr(cookie), signal: AbortSignal.timeout(25000),
  })
  if (!r.ok) throw new Error(`getDossList HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const text = new TextDecoder('iso-8859-15').decode(buf)
  const out: BkoDossier[] = []
  for (const line of text.split('\n')) {
    if (!line.includes(';')) continue
    const c = line.split(';')
    const dossier = (c[15] || '').trim()
    if (!dossier) continue
    out.push({
      account: accountLabel,
      dossier,
      cidSeqAction: (c[16] || '').trim(),
      commande:     (c[4]  || '').trim(),
      prestation:   (c[3]  || '').trim(),
      plaque:       (c[19] || '').trim(),
      km:           num(c[10]),
      montant:      num(c[11]),
      trajet:       (c[20] || '').trim(),
      brand:        (c[28] || '').trim(),
      model:        (c[29] || '').trim(),
      insurer:      (c[43] || '').trim(),
      fileDate:     (c[2]  || '').trim(),
    })
  }
  return out
}

/**
 * Interroge TOUS les comptes BKO configurés, SÉQUENTIELLEMENT (un compte après
 * l'autre — jamais deux sessions concurrentes). Retourne les dossiers taggés par
 * compte + les erreurs par compte (best-effort : un compte KO n'empêche pas les
 * autres). Olivier 2026-07-27.
 */
export async function listAllComexBko(): Promise<{ dossiers: BkoDossier[]; errors: { account: string; error: string }[] }> {
  const accounts = getBkoAccounts()
  const dossiers: BkoDossier[] = []
  const errors: { account: string; error: string }[] = []
  for (const acct of accounts) {
    try {
      const cookie = await loginComexBko(acct)
      const rows = await listComexBkoDossiers(cookie, acct.label)
      dossiers.push(...rows)
    } catch (e: any) {
      errors.push({ account: acct.label, error: e?.message || 'échec' })
    }
  }
  return { dossiers, errors }
}

/**
 * Accepte (valide) un dossier côté COMEX BKO :
 *   1. setKmDossierExt.do  → pose les km (on reprend les km COMEX proposés).
 *   2. setDossStatut.do    → codStatutFactComex=inWait (validé → attente génération).
 * ⚠️ Écriture réelle sur la plateforme Touring.
 */
export async function acceptComexBkoDossier(
  cookie: string,
  d: { dossier: string; cidSeqAction: string; commande: string; km: number },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const base = { cidDoss: d.dossier, cidSeqAction: d.cidSeqAction, numCommande: d.commande }
    const kmBody = new URLSearchParams({ ...base, kmPropose: String(d.km) }).toString()
    const rk = await fetch(`${BASE}/secured/accord/setKmDossierExt.do?`, { method: 'POST', headers: hdr(cookie, true), body: kmBody, signal: AbortSignal.timeout(20000) })
    if (!rk.ok) return { ok: false, error: `setKm HTTP ${rk.status}` }
    const stBody = new URLSearchParams({ ...base, codStatutFactComex: 'inWait' }).toString()
    const rs = await fetch(`${BASE}/secured/accord/setDossStatut.do?`, { method: 'POST', headers: hdr(cookie, true), body: stBody, signal: AbortSignal.timeout(20000) })
    if (!rs.ok) return { ok: false, error: `setStatut HTTP ${rs.status}` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'échec accept COMEX' }
  }
}
