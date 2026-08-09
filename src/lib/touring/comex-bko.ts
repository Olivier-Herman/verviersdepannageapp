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

/** Ouvre une session COMEX BKO pour un compte donné et retourne le Cookie.
 * L'enchaînement (welcome → canILog → j_security_check → canILog) échoue par
 * intermittence côté COMEX (rotation de session Spring qui « ne prend pas » →
 * canILog renvoie "not logged…"). On RÉESSAIE jusqu'à 3× avec un court backoff :
 * un login raté renvoie 0 dossier et fausse toute la synchro BKO. Olivier 2026-08-09. */
export async function loginComexBko(account: BkoAccount): Promise<string> {
  const user = (account.user || '').toUpperCase()
  const pass = account.pass || ''
  if (!user || !pass) throw new Error('compte BKO incomplet')
  const hash = sha256(pass)
  const creds = new URLSearchParams({ j_username: user, j_password: hash }).toString()

  let lastErr = 'login COMEX BKO échoué'
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
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
    } catch (e: any) {
      lastErr = e?.message || 'login COMEX BKO échoué'
      if (attempt < 3) await new Promise(res => setTimeout(res, 500 * attempt))
    }
  }
  throw new Error(lastErr)
}

export interface BkoDossier {
  account:      string   // compte BKO source (label) — requis pour l'acceptation
  dossier:      string   // n° dossier (file ID) = clé de rapprochement (col 15)
  cidSeqAction: string   // séquence action (col 16)
  commande:     string   // n° commande Touring (col 4)
  prestation:   string   // DEP / REM+... (col 3)
  plaque:       string   // (col 19)
  km:           number   // km proposés COMEX (col 10) — -1 si non fixé
  montant:      number   // total COMEX HTVA = base (col 11) + majorations (col 12)
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
    // Colonne [0] : 0 = onglet « View Validate » (à valider), 1 = « View InWait »
    // (déjà validé). On ne garde QUE les dossiers à valider. Olivier 2026-07-28.
    if ((c[0] || '').trim() !== '0') continue
    out.push({
      account: accountLabel,
      dossier,
      cidSeqAction: (c[16] || '').trim(),
      commande:     (c[4]  || '').trim(),
      prestation:   (c[3]  || '').trim(),
      plaque:       (c[19] || '').trim(),
      km:           num(c[10]),
      // Total proposé = montant de base (col 11) + majorations (col 12, ex.
      // majoration nuit). COMEX n'a pas de colonne « total » : on somme.
      montant:      Math.round((num(c[11]) + num(c[12])) * 100) / 100,
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
 * DEBUG : dumpe TOUTES les colonnes brutes des lignes getDossList qui matchent
 * un dossier (sans filtre onglet), pour identifier l'index d'une valeur (ex.
 * total avec majoration nuit). Superadmin uniquement. Olivier 2026-07-31.
 */
export async function dumpDossColumns(dossier: string): Promise<Array<{ account: string; c0: string; cols: Record<number, string> }>> {
  const out: Array<{ account: string; c0: string; cols: Record<number, string> }> = []
  for (const acct of getBkoAccounts()) {
    let cookie = ''
    try { cookie = await loginComexBko(acct) } catch { continue }
    try {
      const r = await fetch(`${BASE}/secured/accord/getDossList.do?dojo.preventCache=${Math.floor(Math.random() * 1e12)}`, {
        headers: hdr(cookie), signal: AbortSignal.timeout(25000),
      })
      const buf = Buffer.from(await r.arrayBuffer())
      const text = new TextDecoder('iso-8859-15').decode(buf)
      for (const line of text.split('\n')) {
        if (!line.includes(';')) continue
        const c = line.split(';')
        if ((c[15] || '').trim() !== dossier.trim()) continue
        const cols: Record<number, string> = {}
        c.forEach((v, i) => { const t = (v || '').trim(); if (t) cols[i] = t })
        out.push({ account: acct.label, c0: (c[0] || '').trim(), cols })
      }
    } catch { /* ignore */ }
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// ACCORDS (onglet « Invoices » du BKO) — LECTURE SEULE.
// Permet de retrouver, pour chaque n° d'accord Touring, la liste des dossiers
// (missions) qu'il couvre → rapprochement automatique « déjà facturé ».
// Endpoints reverse-engineered : secured/invoices/getAccList.do (liste des
// accords) + getDossListWithNumAccord.do?numAccord=X (dossiers d'un accord).
// ────────────────────────────────────────────────────────────────────────────

export interface BkoAccord {
  numAccord:    string   // ex 2024AC002456
  creationDate: string   // dd/mm/yyyy hh:mm:ss
  sumTVAC:      number
  prestataire:  string
}

/** Liste des accords (facturés) côté BKO — onglet Invoices. Lecture seule. */
export async function listBkoAccords(cookie: string, noLimit = false): Promise<BkoAccord[]> {
  const body = new URLSearchParams({ flagNoLimit: noLimit ? 'true' : '' }).toString()
  const r = await fetch(`${BASE}/secured/invoices/getAccList.do?`, {
    method: 'POST', headers: hdr(cookie, true), body, signal: AbortSignal.timeout(25000),
  })
  if (!r.ok) throw new Error(`getAccList HTTP ${r.status}`)
  const text = new TextDecoder('iso-8859-15').decode(Buffer.from(await r.arrayBuffer()))
  const out: BkoAccord[] = []
  for (const line of text.split('\n')) {
    if (!line.includes(';')) continue
    const c = line.split(';')
    const numAccord = (c[0] || '').trim()
    if (!/^\d{4}AC\d+/.test(numAccord)) continue
    out.push({
      numAccord,
      creationDate: (c[1] || '').trim(),
      sumTVAC:      num(c[5]),
      prestataire:  (c[10] || '').trim(),
    })
  }
  return out
}

export interface BkoAccordDossier {
  cidDos:         string   // n° dossier = clé de rapprochement (col 15)
  prestationType: string   // DEP / REM / REM+TGR … (col 3)
  commande:       string   // (col 4)
  plaque:         string   // (col 19)
}

/** Dossiers (missions) couverts par un accord donné. Lecture seule. */
export async function listBkoDossiersForAccord(cookie: string, numAccord: string): Promise<BkoAccordDossier[]> {
  const body = new URLSearchParams({ numAccord }).toString()
  const r = await fetch(`${BASE}/secured/invoices/getDossListWithNumAccord.do?`, {
    method: 'POST', headers: hdr(cookie, true), body, signal: AbortSignal.timeout(25000),
  })
  if (!r.ok) throw new Error(`getDossListWithNumAccord HTTP ${r.status}`)
  const text = new TextDecoder('iso-8859-15').decode(Buffer.from(await r.arrayBuffer()))
  const out: BkoAccordDossier[] = []
  for (const line of text.split('\n')) {
    if (!line.includes(';')) continue
    const c = line.split(';')
    const cidDos = (c[15] || '').trim()
    if (!cidDos) continue
    out.push({
      cidDos,
      prestationType: (c[3]  || '').trim(),
      commande:       (c[4]  || '').trim(),
      plaque:         (c[19] || '').trim(),
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

// ── Détail d'un dossier (heures de pointage COMEX = celles reçues par Touring) ──
export interface BkoDossierDetail {
  fileDate:   string   // c2  date dossier  (DD/MM/YYYY HH:mm:ss)
  action:     string   // c3  REM / DEP
  orderNum:   string   // c4  n° commande
  assignDate: string   // c5
  acceptDate: string   // c6
  onRoadDate: string   // c7
  onSpotDate: string   // c8
  endDate:    string   // c9
  dossier:    string   // c15 file ID (2026BE…)
  seq:        string   // c16
  arcCode:    string   // c17 codes panne « cause desc result » (ex « 259 14 73 »)
  vin:        string   // c18
  plate:      string   // c19
  codTrajet:  string   // c20
  accord:     string   // c21
  prestataire: string  // c14 dépôt/prestataire
  brand:      string   // c28
  model:      string   // c29
  agent:      string   // c30
}

/** Parse UNE ligne (';'-séparée, format [dossier]) → heures + codes. Partagé par
 * getDossDetail, getDossListWithNumAccord et getDossList (même layout de colonnes). */
export function parseBkoDeroulementLine(line: string): BkoDossierDetail | null {
  if (!line.includes(';')) return null
  const c = line.split(';')
  const dossier = (c[15] || '').trim()
  if (!dossier) return null
  const g = (i: number) => (c[i] || '').trim()
  return {
    fileDate: g(2), action: g(3), orderNum: g(4),
    assignDate: g(5), acceptDate: g(6), onRoadDate: g(7), onSpotDate: g(8), endDate: g(9),
    prestataire: g(14), dossier, seq: g(16) || '0', arcCode: g(17), vin: g(18), plate: g(19),
    codTrajet: g(20), accord: g(21), brand: g(28), model: g(29), agent: g(30),
  }
}

/** Détail d'un dossier BKO (getDossDetail.do, section [dossier]). */
export async function getBkoDossierDetail(cookie: string, p: {
  cidDoss: string; cidSeqAction: string; commNum: string; typPrest: string; codTrajetComex: string; codStatutFactComex: string
}): Promise<BkoDossierDetail | null> {
  const body = new URLSearchParams({
    cidDoss: p.cidDoss, cidSeqAction: p.cidSeqAction, commNum: p.commNum,
    typPrest: p.typPrest, codTrajetComex: p.codTrajetComex, codStatutFactComex: p.codStatutFactComex,
  })
  const r = await fetch(`${BASE}/secured/invoices/getDossDetail.do?`, {
    method: 'POST', headers: hdr(cookie, true), body: body.toString(), signal: AbortSignal.timeout(20000),
  })
  if (!r.ok) return null
  const lines = new TextDecoder('iso-8859-15').decode(Buffer.from(await r.arrayBuffer())).split('\n')
  const idx = lines.findIndex(l => l.trim() === '[dossier]')
  return idx >= 0 ? parseBkoDeroulementLine(lines[idx + 1] || '') : null
}

/** Tous les dossiers d'un accord AVEC leurs heures (getDossListWithNumAccord — même
 * format que le détail, une ligne par dossier). Pas de getDossDetail par dossier. */
export async function listBkoDeroulementForAccord(cookie: string, numAccord: string): Promise<BkoDossierDetail[]> {
  const r = await fetch(`${BASE}/secured/invoices/getDossListWithNumAccord.do?`, {
    method: 'POST', headers: hdr(cookie, true), body: new URLSearchParams({ numAccord }).toString(), signal: AbortSignal.timeout(25000),
  })
  if (!r.ok) throw new Error(`getDossListWithNumAccord HTTP ${r.status}`)
  const text = new TextDecoder('iso-8859-15').decode(Buffer.from(await r.arrayBuffer()))
  return text.split('\n').map(parseBkoDeroulementLine).filter((x): x is BkoDossierDetail => !!x)
}

/** Dossiers en cours (non encore facturés) AVEC leurs heures (getDossList InWait/à valider). */
export async function listBkoDeroulementInWait(cookie: string): Promise<BkoDossierDetail[]> {
  const r = await fetch(`${BASE}/secured/accord/getDossList.do?dojo.preventCache=${Math.floor(Math.random() * 1e12)}`, {
    headers: hdr(cookie), signal: AbortSignal.timeout(25000),
  })
  if (!r.ok) throw new Error(`getDossList HTTP ${r.status}`)
  const text = new TextDecoder('iso-8859-15').decode(Buffer.from(await r.arrayBuffer()))
  return text.split('\n')
    .filter(l => { const c0 = (l.split(';')[0] || '').trim(); return c0 === '0' || c0 === '1' })
    .map(parseBkoDeroulementLine).filter((x): x is BkoDossierDetail => !!x)
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
