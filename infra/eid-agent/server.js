// server.js — Agent eID local (Verviers Dépannage / VD Soft)
// =============================================================
// Tourne sur le PC COMPTOIR (Windows), à côté du navigateur qui affiche
// l'écran client (page kiosque /caisse/ecran/<key>). Le lecteur de carte
// d'identité belge (PC/SC, ex. ACS ACR39U) est branché en USB sur ce PC.
//
// La page kiosque (servie en HTTPS) appelle cet agent en localhost :
//   GET http://localhost:7181/read   → lit la carte présente et renvoie
//                                        { lastName, firstName, street, zip,
//                                          city, country, nationalNumber,
//                                          birthDate, nationality }
//   GET http://localhost:7181/health → healthcheck (état lecteur/carte)
//
// Chrome autorise une page HTTPS à appeler http://localhost (exception
// "localhost = contexte sûr") → pas de blocage mixed-content, pas de ngrok.
//
// Lecture SANS PIN : sur l'eID belge, les fichiers identité (EF 4031) et
// adresse (EF 4033) sont librement lisibles (seule la signature demande le
// PIN). On lit donc directement via APDU PC/SC, sans dépendre du middleware
// (le middleware BeID reste utile pour installer/valider le lecteur).
//
// Brancher côté VD Soft : ouvrir la page kiosque avec le paramètre
//   /caisse/ecran/facturation?eid=http://localhost:7181/read
// (ou définir NEXT_PUBLIC_EID_AGENT_URL au build). Sans ça, la page
// utilise une lecture MOCK.
//
// Versionné dans le repo (infra/eid-agent/). Toute modif ici, puis déployée
// sur le PC comptoir. Auto-démarrage via Planificateur de tâches Windows.

const express = require('express')
const cors = require('cors')

let pcsclite
try {
  pcsclite = require('@pokusew/pcsclite')
} catch (e) {
  console.error('[eid-agent] Module @pokusew/pcsclite introuvable. Lance `npm install` dans infra/eid-agent.')
  process.exit(1)
}

const PORT = Number(process.env.EID_AGENT_PORT || 7181)

// ── Suivi du lecteur / de la carte présente ────────────────────────────────
// On garde une référence au dernier lecteur ayant une carte insérée ; /read
// s'en sert pour se connecter à la demande.
let readyReader = null
let lastReaderName = null
let lastError = null

const pcsc = pcsclite()
pcsc.on('error', (err) => { lastError = String(err && err.message || err); console.error('[eid-agent] PCSC error:', lastError) })
pcsc.on('reader', (reader) => {
  lastReaderName = reader.name
  console.log('[eid-agent] Lecteur détecté :', reader.name)
  reader.on('error', (err) => console.error('[eid-agent] Lecteur erreur:', reader.name, err && err.message))
  reader.on('status', (status) => {
    const changes = reader.state ^ status.state
    if (!changes) return
    const present = (status.state & reader.SCARD_STATE_PRESENT) && !(status.state & reader.SCARD_STATE_MUTE)
    readyReader = present ? reader : (readyReader === reader ? null : readyReader)
  })
  reader.on('end', () => { if (readyReader === reader) readyReader = null; console.log('[eid-agent] Lecteur retiré :', reader.name) })
})

// ── Helpers PC/SC (promisifiés) ─────────────────────────────────────────────
const connect = (reader) => new Promise((res, rej) =>
  reader.connect({ share_mode: reader.SCARD_SHARE_SHARED }, (err, protocol) => err ? rej(err) : res(protocol)))
const disconnect = (reader) => new Promise((res) =>
  reader.disconnect(reader.SCARD_LEAVE_CARD, () => res()))
const transmit = (reader, apdu, protocol) => new Promise((res, rej) =>
  reader.transmit(Buffer.from(apdu), 512, protocol, (err, data) => err ? rej(err) : res(data)))

const sw = (resp) => ((resp[resp.length - 2] << 8) | resp[resp.length - 1])

// SELECT (par chemin depuis le MF) puis READ BINARY d'un EF de l'eID.
async function readFile(reader, protocol, pathBytes) {
  // 00 A4 08 0C Lc <path>   (P1=08 = select by path from MF, P2=0C = no FCI)
  const sel = [0x00, 0xA4, 0x08, 0x0C, pathBytes.length, ...pathBytes]
  const selResp = await transmit(reader, sel, protocol)
  if ((sw(selResp) & 0xFF00) !== 0x9000 && (sw(selResp) & 0xFF00) !== 0x6100) {
    throw new Error('SELECT échoué (SW=' + sw(selResp).toString(16) + ')')
  }
  let out = Buffer.alloc(0)
  let off = 0
  for (let i = 0; i < 32; i++) {           // garde-fou : max 32 lectures
    const rb = [0x00, 0xB0, (off >> 8) & 0xFF, off & 0xFF, 0xFF]
    const resp = await transmit(reader, rb, protocol)
    const body = resp.slice(0, resp.length - 2)
    out = Buffer.concat([out, body])
    if (body.length < 0xFF) break          // dernier bloc
    off += body.length
    if ((sw(resp) & 0xFF00) !== 0x9000) break
  }
  return out
}

// Découpe TLV simple (tag 1 octet, longueur 1 octet) → map tag → Buffer.
function parseTlv(buf) {
  const m = {}
  let i = 0
  while (i + 1 < buf.length) {
    const tag = buf[i]
    const len = buf[i + 1]
    if (tag === 0 || i + 2 + len > buf.length) break
    m[tag] = buf.slice(i + 2, i + 2 + len)
    i += 2 + len
  }
  return m
}

const str = (b) => (b ? b.toString('utf8').trim() : '')

// Fichiers eID belge : DF01/EF4031 = identité, DF01/EF4033 = adresse.
const EF_IDENTITY = [0x3F, 0x00, 0xDF, 0x01, 0x40, 0x31]
const EF_ADDRESS  = [0x3F, 0x00, 0xDF, 0x01, 0x40, 0x33]

async function readEid() {
  const reader = readyReader
  if (!reader) throw Object.assign(new Error('NO_CARD'), { code: 'NO_CARD' })
  let protocol
  try {
    protocol = await connect(reader)
    const idBuf = await readFile(reader, protocol, EF_IDENTITY)
    const adBuf = await readFile(reader, protocol, EF_ADDRESS)
    const id = parseTlv(idBuf)   // 6=NN, 7=nom, 8=prénoms, 10=nationalité, 12=naissance
    const ad = parseTlv(adBuf)   // 1=rue+n°, 2=CP, 3=commune
    return {
      lastName:       str(id[7]),
      firstName:      str(id[8]),
      nationalNumber: str(id[6]),
      birthDate:      str(id[12]),
      nationality:    str(id[10]) || 'Belge',
      street:         str(ad[1]),
      zip:            str(ad[2]),
      city:           str(ad[3]),
      country:        'Belgique',
    }
  } finally {
    if (protocol != null) { try { await disconnect(reader) } catch (_) {} }
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────
const app = express()
app.use(cors())                       // autorise l'appel depuis la page kiosque

app.get('/health', (_req, res) => {
  res.json({ ok: true, reader: lastReaderName, cardPresent: !!readyReader, error: lastError })
})

app.get('/read', async (_req, res) => {
  try {
    const data = await readEid()
    res.json(data)
  } catch (e) {
    if (e && e.code === 'NO_CARD') {
      return res.status(409).json({ error: 'NO_CARD', message: 'Aucune carte détectée dans le lecteur.' })
    }
    console.error('[eid-agent] /read erreur:', e && e.message)
    res.status(500).json({ error: 'READ_FAILED', message: String(e && e.message || e) })
  }
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[eid-agent] Agent eID en écoute sur http://localhost:${PORT}`)
  console.log(`[eid-agent] Test : http://localhost:${PORT}/health`)
})
