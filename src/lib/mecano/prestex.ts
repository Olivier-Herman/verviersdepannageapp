// src/lib/mecano/prestex.ts
//
// Client de la base technique Touring « Prestex » (prestex.touring.be).
// Manuel Patrouilleur (dépannage) + Remorquage & traction, par marque/modèle,
// sous forme de fiches PDF. Reverse-engineered 2026-08-03 (cf. mémoire
// project_prestex_mecano_agent). Lecture seule, usage interne dépanneurs.
//
// Auth : ASP classique. GET racine (pose ASPSESSIONID) → POST CheckUser.asp.
// Navigation : Manuel.asp / Remorquage.asp ?ReptSel=\Manual\Français\<Section>\<Marque>
// avec BACKSLASHES littéraux + accents encodés en latin1 (Français → Fran%E7ais).

const BASE = 'https://prestex.touring.be'
const UA   = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

export type PrestexSection = 'patrouilleur' | 'remorquage'
const SECTION_DIR: Record<PrestexSection, string> = { patrouilleur: 'Patrouilleur', remorquage: 'Remorquage' }
const SECTION_ASP: Record<PrestexSection, string> = { patrouilleur: 'Manuel.asp', remorquage: 'Remorquage.asp' }

export interface PrestexDoc {
  section:  PrestexSection
  brand:    string
  model:    string   // dossier modèle+années (ex. "A3 2020-")
  doc_num:  string   // préfixe numérique (ex. "7", "8", "17")
  doc_type: string   // type déduit (tips / ouverture / electricite / …)
  label:    string   // libellé fichier sans extension
  url:      string   // chemin absolu du PDF sur prestex
}

/** Encode un chemin : non-ASCII en latin1 %XX, espaces %20, backslash littéral. */
function pathEnc(path: string): string {
  let out = ''
  for (const ch of path) {
    const code = ch.charCodeAt(0)
    if (ch === '\\') out += '\\'
    else if (ch === ' ') out += '%20'
    else if (code < 128 && /[A-Za-z0-9\-_.~/#&()]/.test(ch)) out += ch
    else if (code < 256) out += '%' + code.toString(16).toUpperCase().padStart(2, '0')
    else out += encodeURIComponent(ch)
  }
  return out
}
const reptEnc = pathEnc

/** Décode les %XX comme des octets latin1 (le serveur est en iso-8859-1). */
function l1decode(s: string): string {
  return s.replace(/%[0-9A-Fa-f]{2}/g, m => String.fromCharCode(parseInt(m.slice(1), 16)))
}

class Jar {
  private j = new Map<string, string>()
  add(res: Response) {
    const scs = (res.headers as any).getSetCookie?.() || (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])
    for (const c of scs) { const f = c.split(';')[0].trim(); const e = f.indexOf('='); if (e < 0) continue; const n = f.slice(0, e).trim(), v = f.slice(e + 1).trim(); if (v) this.j.set(n, v) }
  }
  header() { return [...this.j.entries()].map(([n, v]) => `${n}=${v}`).join('; ') }
}

export interface PrestexSession { cookie: string }

export async function prestexLogin(): Promise<PrestexSession> {
  // Login Prestex = compte patrouille simple (user=pass, ex. d68267/d68267),
  // DIFFÉRENT du mot de passe COMEX → pas de fallback vers TOURING_WEB_*_PASS.
  const user = process.env.PRESTEX_USER
  const pass = process.env.PRESTEX_PASS
  if (!user || !pass) throw new Error('[prestex] identifiants manquants (PRESTEX_USER/PRESTEX_PASS)')
  const jar = new Jar()
  jar.add(await fetch(`${BASE}/fr/ExtranetLight/site/`, { headers: { 'User-Agent': UA }, redirect: 'manual' }))
  const body = `StrUser=${encodeURIComponent(user)}&StrPass=${encodeURIComponent(pass)}&BtnValide=%A0%A0%A0%A0Enter%A0%A0%A0%A0`
  const login = await fetch(`${BASE}/fr/ExtranetLight/site/CheckUser.asp`, {
    method: 'POST', redirect: 'manual',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': jar.header() },
    body,
  })
  jar.add(login)
  if (login.status !== 302) throw new Error(`[prestex] login inattendu status=${login.status}`)
  return { cookie: jar.header() }
}

async function getHtml(session: PrestexSession, url: string): Promise<string> {
  const r = await fetch(`${BASE}${url}`, { headers: { 'User-Agent': UA, 'Cookie': session.cookie }, redirect: 'manual' })
  return new TextDecoder('iso-8859-1').decode(Buffer.from(await r.arrayBuffer()))
}

/** Déduit un type normalisé depuis le n° et le libellé du document. */
function docType(num: string, label: string): string {
  const l = label.toLowerCase()
  if (num === '7'  || /t&t|t&c|tips|trucs|conseils/.test(l)) return 'tips'
  if (num === '8'  || /ouvr|ouverture/.test(l))               return 'ouverture'
  if (num === '3'  || /électric|electric/.test(l))            return 'electricite'
  if (num === '5'  || /gestion moteur/.test(l))               return 'gestion_moteur'
  if (num === '1'  || /identif|photo/.test(l))                return 'identification'
  if (/17|désactivation|neutralisation|haute tension|hv|ht/.test(l)) return 'hv_securite'
  if (/18|erg|emergency|response|rescue/.test(l))             return 'emergency'
  if (/remorqu|traction|ancrage|treuil|transport|neutre|attel/.test(l)) return 'remorquage'
  return 'autre'
}

/** Liste les fiches PDF d'une marque pour une section (dépannage ou remorquage). */
export async function prestexListBrand(session: PrestexSession, section: PrestexSection, brand: string): Promise<PrestexDoc[]> {
  const rept = `\\Manual\\Français\\${SECTION_DIR[section]}\\${brand}`
  const html = await getHtml(session, `/fr/ExtranetLight/site/CE/TTC/${SECTION_ASP[section]}?ReptSel=${reptEnc(rept)}`)
  const prefix = `/Manual/Français/${SECTION_DIR[section]}/${brand}/`
  const out: PrestexDoc[] = []
  const seen = new Set<string>()
  // Les chemins contiennent des espaces littéraux ET des %20 (latin1) → on
  // autorise tout sauf les délimiteurs d'attribut, puis on décode en latin1.
  for (const m of html.matchAll(/\/Manual\/[^"'<>)]+?\.pdf/gi)) {
    const url = l1decode(m[0]).trim()                     // chemin lisible (ç, espaces)
    if (!url.startsWith(prefix) || seen.has(url)) continue
    seen.add(url)
    const rest  = url.slice(prefix.length)                // "<Modèle>/<n Label>.pdf"
    const slash = rest.indexOf('/')
    if (slash < 0) continue
    const model = rest.slice(0, slash).trim()
    const file  = rest.slice(slash + 1).replace(/\.pdf$/i, '')
    const numM  = file.match(/^\s*(\d+[a-z]?)\s+(.*)$/i)
    const doc_num = numM ? numM[1] : ''
    const label   = (numM ? numM[2] : file).trim()
    out.push({ section, brand, model, doc_num, doc_type: docType(doc_num, label), label, url })
  }
  return out
}

/** Télécharge un PDF (Buffer). urlPath = chemin lisible (sera ré-encodé latin1). */
export async function prestexDownloadPdf(session: PrestexSession, urlPath: string): Promise<Buffer> {
  const r = await fetch(`${BASE}${pathEnc(urlPath)}`, { headers: { 'User-Agent': UA, 'Cookie': session.cookie }, redirect: 'manual' })
  if (!r.ok) throw new Error(`[prestex] download ${r.status} ${urlPath}`)
  return Buffer.from(await r.arrayBuffer())
}

/** Liste des marques disponibles (depuis la racine du manuel). */
export async function prestexListBrands(session: PrestexSession): Promise<string[]> {
  const html = await getHtml(session, `/fr/ExtranetLight/site/CE/TTC/Manuel.asp`)
  const brands = new Set<string>()
  for (const m of html.matchAll(/ReptSel=\\Manual\\Fran[^\\]*\\Patrouilleur\\([^"'#\\]+)/gi)) {
    brands.add(decodeURIComponent(m[1]).trim())
  }
  return [...brands]
}
