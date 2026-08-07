// server.js — Agent eID local (Verviers Dépannage / VD Soft)
// =============================================================
// Tourne sur le PC COMPTOIR (Windows), à côté du navigateur qui affiche
// l'écran client (page kiosque /caisse/ecran/<key>). Le lecteur de carte
// d'identité belge (PC/SC, ex. ACS ACR39U) est branché en USB sur ce PC.
//
//   GET http://localhost:7181/read   → lit la carte présente et renvoie
//                                        { lastName, firstName, street, zip,
//                                          city, country, nationalNumber,
//                                          birthDate, nationality }
//   GET http://localhost:7181/health → healthcheck.
//
// La lecture de la carte est faite par read-eid.ps1 via WinSCard (API PC/SC
// NATIVE de Windows) → AUCUN module natif à compiler : `npm install` n'installe
// que express + cors (pur JS). Robuste sur un PC comptoir sans outils de build.
//
// Lecture SANS PIN : sur l'eID belge, les fichiers identité (EF 4031) et
// adresse (EF 4033) sont librement lisibles.
//
// Chrome autorise une page HTTPS à appeler http://localhost (exception
// "localhost = contexte sûr") → pas de blocage mixed-content, pas de ngrok.
//
// Brancher côté VD Soft : ouvrir la page kiosque avec
//   /caisse/ecran/facturation?eid=http://localhost:7181/read

const express = require('express')
const cors = require('cors')
const path = require('path')
const { execFile } = require('child_process')

const PORT = Number(process.env.EID_AGENT_PORT || 7181)
const SCRIPT = path.join(__dirname, 'read-eid.ps1')
const POWERSHELL = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell'

// Lance read-eid.ps1 et renvoie l'objet identité (ou lève une erreur avec code).
function readEid(dump) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT]
  if (dump) args.push('-Dump')
  return new Promise((resolve, reject) => {
    execFile(
      POWERSHELL,
      args,
      { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(new Error(stderr || err.message))
        let j
        try { j = JSON.parse(String(stdout).trim()) }
        catch (_) { return reject(new Error('Sortie PowerShell illisible : ' + String(stdout).slice(0, 200))) }
        if (j && j.error) { const e = new Error(j.error); e.code = j.error; e.detail = j.detail; return reject(e) }
        resolve(j)
      },
    )
  })
}

const app = express()
app.use(cors())

app.get('/health', (_req, res) => {
  res.json({ ok: true, engine: 'winscard-powershell', port: PORT })
})

app.get('/read', async (req, res) => {
  try {
    res.json(await readEid(!!req.query.debug))
  } catch (e) {
    const code = e && e.code
    if (code === 'NO_CARD')   return res.status(409).json({ error: 'NO_CARD',   message: 'Aucune carte détectée. Insérez la carte dans le lecteur.' })
    if (code === 'NO_READER') return res.status(409).json({ error: 'NO_READER', message: 'Aucun lecteur de carte détecté sur ce PC.' })
    if (code === 'NO_PCSC')   return res.status(500).json({ error: 'NO_PCSC',   message: 'Service Carte à puce Windows indisponible.' })
    console.error('[eid-agent] /read erreur:', e && (e.detail || e.message))
    res.status(500).json({ error: 'READ_FAILED', message: String(e && (e.detail || e.message) || e) })
  }
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[eid-agent] Agent eID en écoute sur http://localhost:${PORT}`)
  console.log(`[eid-agent] Test : http://localhost:${PORT}/health  puis  /read (carte insérée)`)
})
