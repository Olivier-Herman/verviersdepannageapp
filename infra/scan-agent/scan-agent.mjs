#!/usr/bin/env node
// scan-agent.mjs — Agent Scan VD Soft, version Node (macOS / Linux / Windows).
//
// Même contrat que l'agent PowerShell (server-scan.ps1) : port 7182,
//   GET /health  -> { ok, printer, escl }
//   GET /scan    -> { ok, via, files: [{ name, mime, b64 }] }
//                   ?source=adf|flatbed &color=color|gray &dpi=300 &duplex=0|1
// → le bouton « Scanner » de la fiche ne fait aucune différence entre les deux.
//
// Un seul chemin ici : eSCL / AirScan (HTTP + XML, aucun pilote). C'est celui
// que macOS utilise nativement pour « Numériser » ; le repli WIA du paquet
// Windows n'a pas d'équivalent hors Windows.
//
// Config, par ordre de priorité :
//   1. argument            : node scan-agent.mjs 192.168.1.50
//   2. variable d'env      : SCAN_PRINTER_HOST=192.168.1.50 node scan-agent.mjs
//   3. config.json à côté  : { "printerHost": "192.168.1.50" }
//
// Zéro dépendance : Node 18+ suffit (fetch intégré).

import http from 'node:http'
import fs   from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.SCAN_AGENT_PORT || 7182)

function readConfig() {
  let cfg = { printerHost: '', defaultSource: 'adf', defaultDpi: 300 }
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8')) } } catch { /* optionnel */ }
  if (process.env.SCAN_PRINTER_HOST) cfg.printerHost = process.env.SCAN_PRINTER_HOST
  if (process.argv[2])               cfg.printerHost = process.argv[2]
  return cfg
}
const CFG = readConfig()

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a)

// Etat eSCL tenu a jour en tache de fond : /health doit repondre INSTANTANEMENT.
// Le navigateur ne l'attend qu'une seconde et demie avant de masquer le bouton —
// une sonde synchrone (jusqu'a 5 s quand l'imprimante est eteinte) le ferait
// disparaitre alors que tout va bien.
let esclOnline = false
let esclMisses = 0
let adfState = null      // true = document dans le chargeur, false = vide, null = inconnu
async function refreshEsclState() {
  if (!CFG.printerHost) { esclOnline = false; return }
  const before = esclOnline
  const up = !!(await esclBase(CFG.printerHost))
  // Une imprimante en veille profonde met parfois plusieurs secondes a repondre
  // a la premiere requete : on ne la declare eteinte qu'apres DEUX echecs
  // d'affilee, sinon le bouton clignoterait a chaque reveil.
  if (up) { esclMisses = 0; esclOnline = true; adfState = await adfLoaded(`http://${CFG.printerHost}/eSCL`) }
  else if (++esclMisses >= 2) esclOnline = false
  if (before !== esclOnline) log(`imprimante ${esclOnline ? 'joignable' : 'injoignable'} (${CFG.printerHost})`)
}

// ── eSCL ────────────────────────────────────────────────────────────────────
// http d'abord (le cas courant sur le LAN), https en repli (certificat auto-signé).
async function esclBase(host) {
  for (const base of [`http://${host}/eSCL`, `https://${host}/eSCL`]) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 6000)
      const r = await fetch(`${base}/ScannerCapabilities`, { signal: ctrl.signal })
      clearTimeout(t)
      if (r.ok) return { base, caps: await r.text() }
    } catch { /* on essaie le suivant */ }
  }
  return null
}

// Le scanner n'accepte QUE les resolutions qu'il annonce : demander 200 dpi a
// une machine qui propose 150 et 300 renvoie un HTTP 500, toujours le meme,
// impossible a distinguer d'un scanner occupe. On cale donc sur la valeur
// annoncee la plus proche, au lieu de propager l'erreur.
function snapDpi(caps, wanted) {
  const list = [...caps.matchAll(/<scan:DiscreteResolution>\s*<scan:XResolution>(\d+)<\/scan:XResolution>/g)]
    .map(m => Number(m[1]))
  if (!list.length) return wanted
  if (list.includes(wanted)) return wanted
  const best = list.reduce((a, b) => Math.abs(b - wanted) < Math.abs(a - wanted) ? b : a)
  log(`resolution ${wanted} dpi non proposee (${list.join(', ')}) -> ${best} dpi`)
  return best
}

function scanSettingsXml({ fmt, source, color, dpi, duplex }) {
  const input = source === 'flatbed' ? 'Platen' : 'Feeder'
  const mode  = color === 'gray' ? 'Grayscale8' : 'RGB24'
  // A4 exprimé en 1/300e de pouce — l'unité eSCL, indépendante de la résolution.
  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm" xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03">
  <pwg:Version>2.63</pwg:Version>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:Width>2480</pwg:Width>
      <pwg:Height>3508</pwg:Height>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>${input}</pwg:InputSource>
  <scan:ColorMode>${mode}</scan:ColorMode>
  <scan:XResolution>${dpi}</scan:XResolution>
  <scan:YResolution>${dpi}</scan:YResolution>
  <scan:Duplex>${duplex ? 'true' : 'false'}</scan:Duplex>
  <pwg:DocumentFormat>${fmt}</pwg:DocumentFormat>
  <scan:DocumentFormatExt>${fmt}</scan:DocumentFormatExt>
</scan:ScanSettings>`
}

// Un travail eSCL laissé ouvert bloque TOUS les suivants : le scanner répond
// alors 500 à chaque nouvelle demande, jusqu'à ce qu'on le libère. On lit donc
// l'état avant de commencer et on supprime ce qui traîne — sinon le premier
// scan de la journée marche et plus jamais aucun autre.
// Le Canon refuse le chargeur quand il est vide — et pas avec une erreur
// parlante : un HTTP 500 sec, le meme que pour « scanner occupe ». On lit donc
// l'etat du chargeur AVANT et on choisit la source tout seul : document dans le
// bac -> chargeur, sinon la vitre. L'utilisateur pose sa feuille ou il veut.
async function adfLoaded(base) {
  try {
    const r = await fetch(`${base}/ScannerStatus`)
    if (!r.ok) return null
    const xml = await r.text()
    const m = xml.match(/<scan:AdfState>([^<]+)<\/scan:AdfState>/)
    if (!m) return null
    return /Loaded/i.test(m[1])
  } catch { return null }
}

async function clearStaleJobs(base) {
  try {
    const r = await fetch(`${base}/ScannerStatus`)
    if (!r.ok) return
    const xml = await r.text()
    const uris = [...xml.matchAll(/<pwg:JobUri>([^<]+)<\/pwg:JobUri>/g)].map(m => m[1])
    for (const uri of uris) {
      const full = /^https?:\/\//.test(uri) ? uri : new URL(uri, base).toString()
      await fetch(full, { method: 'DELETE' }).catch(() => {})
      log(`travail eSCL residuel supprime : ${uri}`)
    }
  } catch { /* best effort */ }
}

async function esclScan({ host, source, color, dpi, duplex }) {
  const probe = await esclBase(host)
  if (!probe) throw new Error('ESCL_UNAVAILABLE')
  const fmt = probe.caps.includes('application/pdf') ? 'application/pdf' : 'image/jpeg'

  // Source reelle : ce que demande l'appelant, corrige par l'etat du chargeur.
  let realSource = source
  const loaded = await adfLoaded(probe.base)
  if (source !== 'flatbed' && loaded === false) { realSource = 'flatbed'; log('chargeur vide -> scan depuis la vitre') }
  if (source === 'flatbed' && loaded === true)  { log('document dans le chargeur, mais scan demande depuis la vitre') }

  const body = scanSettingsXml({ fmt, source: realSource, color, dpi: snapDpi(probe.caps, dpi), duplex })

  await clearStaleJobs(probe.base)

  // Une imprimante qui sort de veille refuse parfois la premiere demande : on
  // insiste deux fois avant d'abandonner, en liberant les travaux entre-temps.
  let job = null, lastStatus = 0
  for (let attempt = 1; attempt <= 5 && !job; attempt++) {
    try {
      const post = await fetch(`${probe.base}/ScanJobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        body,
      })
      lastStatus = post.status
      const loc = post.headers.get('location')
      if (loc) job = /^https?:\/\//.test(loc) ? loc : new URL(loc, probe.base).toString()
    } catch { lastStatus = 0 }
    if (!job) log(`creation du travail refusee (HTTP ${lastStatus || 'pas de reponse'}), tentative ${attempt}/5`)
    if (!job && attempt < 5) {
      await new Promise(r => setTimeout(r, 3000))
      await clearStaleJobs(probe.base)
    }
  }
  if (!job) throw new Error(lastStatus >= 500 ? 'ESCL_BUSY' : 'ESCL_NO_JOB')
  log(`travail cree (${realSource}, ${fmt})`)

  const pages = []
  try {
    for (let i = 0; i < 60; i++) {              // garde-fou anti-boucle
      let r
      try { r = await fetch(`${job}/NextDocument`) } catch { break }
      if (!r.ok) break                          // 404 = plus de page, fin normale
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length < 128) break               // page vide
      pages.push({ mime: fmt, buf })
      // Meme en PDF (tout est dans le premier document), on redemande une fois :
      // c'est ce 404 final qui ferme le travail cote scanner.
      if (fmt === 'application/pdf') {
        await fetch(`${job}/NextDocument`).catch(() => {})
        break
      }
    }
  } finally {
    await fetch(job, { method: 'DELETE' }).catch(() => {})   // ceinture et bretelles
  }

  if (!pages.length) throw new Error('ESCL_NO_PAGE')
  return pages
}

// ── Serveur HTTP local ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  // Chrome exige cet en-tete pour qu'une page HTTPS publique joigne localhost.
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)) }

  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end() }

  if (url.pathname === '/health') {
    return send(200, { ok: true, agent: 'scan-node', printer: CFG.printerHost, escl: esclOnline, wia: false, adf: adfState })
  }

  if (url.pathname === '/scan') {
    if (!CFG.printerHost) return send(500, { ok: false, error: 'ESCL_UNAVAILABLE' })
    const q = url.searchParams
    try {
      const pages = await esclScan({
        host:   CFG.printerHost,
        source: q.get('source') || CFG.defaultSource,
        color:  q.get('color')  || 'color',
        dpi:    Number(q.get('dpi') || CFG.defaultDpi),
        duplex: ['1', 'true', 'yes'].includes(q.get('duplex') || ''),
      })
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 15)
      const files = pages.map((p, i) => ({
        name: `scan-${stamp}${pages.length > 1 ? `-p${i + 1}` : ''}.${p.mime === 'application/pdf' ? 'pdf' : 'jpg'}`,
        mime: p.mime,
        b64:  p.buf.toString('base64'),
      }))
      log(`scan OK : ${files.length} fichier(s)`)
      return send(200, { ok: true, via: 'escl', files })
    } catch (e) {
      log(`scan KO : ${e.message}`)
      return send(500, { ok: false, error: e.message })
    }
  }

  send(404, { error: 'NOT_FOUND' })
})

// Au demarrage on insiste : le premier appel tombe souvent pendant que
// l'imprimante se reveille, et attendre la minute suivante ferait croire que
// l'agent ne trouve rien.
refreshEsclState()
setTimeout(refreshEsclState,  5_000).unref()
setTimeout(refreshEsclState, 20_000).unref()
setInterval(refreshEsclState, 60_000).unref()

server.listen(PORT, '127.0.0.1', () => {
  log(`Agent Scan VD Soft (Node) — http://localhost:${PORT}`)
  log(CFG.printerHost
    ? `Imprimante : ${CFG.printerHost}`
    : 'Aucune imprimante configurée → passe l\'IP en argument, en SCAN_PRINTER_HOST, ou dans config.json')
})
