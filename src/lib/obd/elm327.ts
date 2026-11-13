// src/lib/obd/elm327.ts — lecture des réponses d'un boîtier OBD compatible ELM327 (Vgate iCar Pro 2S…).
// Pur traitement de texte, sans Bluetooth : testable sans boîtier (scripts/obd-elm327-check.ts). Olivier 05/11/2026,
// fiabilisé le 06/11/2026 : en-têtes allumés (ATH1), chaque calculateur est lu séparément, et une réponse qui n'est pas
// celle de la question posée n'est jamais décodée. « Pas de réponse » n'est jamais confondu avec « aucun code ».

/** Renvoyés par le lien Bluetooth à la place d'une réponse de la voiture. */
export const TIMEOUT = 'TIMEOUT', LIEN_PERDU = 'LIEN PERDU'

export type ReplyStatus = 'ok' | 'refus' | 'pas_de_reponse' | 'erreur'
export interface EcuMessage { ecu: string; data: number[]; can: boolean }
export interface Reply { status: ReplyStatus; messages: EcuMessage[]; detail?: string }

const ERREURS = /UNABLE TO CONNECT|CAN ERROR|BUS ERROR|BUS BUSY|FB ERROR|DATA ERROR|RX ERROR|BUFFER FULL|STOPPED|LV RESET|ACT ALERT|LP ALERT|ERR\d\d/i
const hex = (t: string) => parseInt(t, 16)

/** Coupe une ligne en calculateur + octets, selon le format de son en-tête. */
function splitFrame(line: string, legacy: boolean): { ecu: string; bytes: number[]; can: boolean; noHeader?: boolean } | null {
  const tokens = line.trim().split(/\s+/)
  if (!tokens.every(t => /^[0-9A-F]+$/i.test(t))) return null
  if (/^[0-9A-F]{3}$/i.test(tokens[0]) && tokens.length > 1) return { ecu: tokens[0].toUpperCase(), bytes: tokens.slice(1).map(hex), can: true }
  // CAN 29 bits : 18 DA F1 10 …, le calculateur est le 4e octet.
  if (tokens.length > 4 && /^18$/i.test(tokens[0]) && /^DA$/i.test(tokens[1]) && /^F1$/i.test(tokens[2])) return { ecu: tokens[3].toUpperCase(), bytes: tokens.slice(4).map(hex), can: true }
  // Anciens protocoles : 3 octets d'en-tête (le 3e = calculateur) et un octet de contrôle à la fin.
  if (legacy && tokens.length > 4) return { ecu: tokens[2].toUpperCase(), bytes: tokens.slice(3, -1).map(hex), can: false }
  return { ecu: '?', bytes: tokens.map(hex), can: false, noHeader: true }
}

/** Reconstitue les messages de chaque calculateur (trames CAN numérotées), même entremêlés. */
function assemble(raw: string, protocol: string | null): { messages: EcuMessage[]; corrompu: boolean } {
  const legacy = /^A?[1-5]$/i.test(protocol || '')
  const messages: EcuMessage[] = []
  const open = new Map<string, { data: number[]; len: number }>()
  let corrompu = false
  const lines = String(raw || '').replace(/>/g, '').split(/[\r\n]+/).map(l => l.trim()).filter(Boolean)
    .map(l => l.replace(/^SEARCHING\.*\s*/i, '')).filter(l => l && !/^BUS INIT/i.test(l) && !/^OK$/i.test(l))
  for (const line0 of lines) {
    // Boîtier qui ignorerait ATH1 : « 0: 43 02… », longueur « 00A » seule sur sa ligne.
    if (/^[0-9A-F]{3}$/i.test(line0)) continue
    const suite = /^[0-9A-F]:\s*/i.test(line0)
    const f = splitFrame(line0.replace(/^[0-9A-F]:\s*/i, ''), legacy)
    if (!f) { corrompu = true; continue }
    if (f.noHeader) {
      const last = messages[messages.length - 1]
      if (suite && last?.ecu === '?' && /^[1-9A-F]:/i.test(line0)) last.data.push(...f.bytes)
      else messages.push({ ecu: '?', data: f.bytes, can: suite })
      continue
    }
    if (!f.can) { messages.push({ ecu: f.ecu, data: f.bytes, can: false }); continue }
    const kind = f.bytes[0] >> 4
    if (kind === 0) messages.push({ ecu: f.ecu, data: f.bytes.slice(1, 1 + (f.bytes[0] & 0x0f)), can: true })
    else if (kind === 1) open.set(f.ecu, { data: f.bytes.slice(2), len: ((f.bytes[0] & 0x0f) << 8) | f.bytes[1] })
    else if (kind === 2) {
      const o = open.get(f.ecu)
      if (!o) { corrompu = true; continue }
      o.data.push(...f.bytes.slice(1))
      if (o.data.length >= o.len) { messages.push({ ecu: f.ecu, data: o.data.slice(0, o.len), can: true }); open.delete(f.ecu) }
    }
  }
  if (open.size) corrompu = true   // message long resté incomplet
  return { messages, corrompu }
}

/**
 * Réponse à une question « mode PID ». Seuls les messages qui répondent à CETTE question sont gardés : une réponse
 * en retard de la commande précédente ou un refus (7F) ne peut donc jamais être lu comme un code de panne.
 */
export function parseReply(raw: string, mode: number, pid: number | null = null, protocol: string | null = null): Reply {
  const text = String(raw || '')
  if (text.includes(LIEN_PERDU)) return { status: 'erreur', messages: [], detail: 'lien_perdu' }
  if (text.includes(TIMEOUT)) return { status: 'erreur', messages: [], detail: 'delai' }
  if (/UNABLE TO CONNECT/i.test(text)) return { status: 'erreur', messages: [], detail: 'voiture_muette' }
  if (ERREURS.test(text)) return { status: 'erreur', messages: [], detail: 'bus' }
  if (/NO DATA/i.test(text)) return { status: 'pas_de_reponse', messages: [] }
  if (/^\s*\?\s*>?\s*$/m.test(text)) return { status: 'erreur', messages: [], detail: 'commande' }
  const { messages, corrompu } = assemble(text, protocol)
  if (corrompu) return { status: 'erreur', messages: [], detail: 'corrompu' }
  const refus = messages.some(m => m.data[0] === 0x7f && m.data[1] === mode && m.data[2] !== 0x78)
  const kept = messages.filter(m => m.data[0] === mode + 0x40 && (pid == null || m.data[1] === pid))
    .sort((a, b) => a.ecu.localeCompare(b.ecu))
  if (kept.length) return { status: 'ok', messages: kept }
  if (refus) return { status: 'refus', messages: [] }
  if (!messages.length) return { status: 'pas_de_reponse', messages: [] }
  return { status: 'erreur', messages: [], detail: 'decalee' }
}

/** Code de panne lisible à partir de deux octets : 0x01 0x33 → P0133. */
export function dtcFromBytes(a: number, b: number): string | null {
  if (!a && !b) return null
  const letter = ['P', 'C', 'B', 'U'][(a >> 6) & 3]
  return `${letter}${(a >> 4) & 3}${(a & 0x0f).toString(16).toUpperCase()}${b.toString(16).toUpperCase().padStart(2, '0')}`
}

/**
 * Codes d'une réponse en mode 03 (mémorisés), 07 (en attente) ou 0A (permanents).
 * CAN : « 43 02 01 33 01 71 », le 2e octet = nombre de codes. Anciens protocoles : « 43 » + 3 codes par ligne, complétés de zéros.
 */
export function dtcsOf(reply: Reply): { code: string; ecu: string }[] {
  const out = new Map<string, string>()
  for (const m of reply.messages) {
    const can = m.ecu === '?' ? m.data.length % 2 === 0 : m.can
    const d = can ? m.data.slice(2, 2 + m.data[1] * 2) : m.data.slice(1)
    for (let i = 0; i + 1 < d.length; i += 2) { const c = dtcFromBytes(d[i], d[i + 1]); if (c && !out.has(c)) out.set(c, m.ecu) }
  }
  return [...out].map(([code, ecu]) => ({ code, ecu }))
}

/**
 * Codes d'un calculateur lus en UDS (19 02 FF) : « 59 02 masque » puis 4 octets par code (3 du code, 1 d'état).
 * Seuls les codes en défaut, en attente ou confirmés sont gardés : un code qui n'a que « test pas encore fait » n'est
 * pas une panne. Le 3e octet précise le défaut (« -29 ») sans changer le code.
 */
export function udsDtcsOf(reply: Reply): { code: string; ecu: string; detail: string; actif: boolean; confirme: boolean }[] {
  const out = new Map<string, { code: string; ecu: string; detail: string; actif: boolean; confirme: boolean }>()
  for (const m of reply.messages) {
    const d = m.data.slice(3)
    for (let i = 0; i + 3 < d.length; i += 4) {
      const [a, b, c, s] = d.slice(i, i + 4)
      if (!(s & 0x0d)) continue
      const code = dtcFromBytes(a, b)
      if (!code || out.has(m.ecu + code)) continue
      out.set(m.ecu + code, { code, ecu: m.ecu, detail: c.toString(16).toUpperCase().padStart(2, '0'), actif: !!(s & 0x01), confirme: !!(s & 0x08) })
    }
  }
  return [...out.values()]
}

/** Numéro de châssis (mode 09, PID 02) : le premier calculateur qui donne 17 caractères valides. */
export function vinOf(reply: Reply): string | null {
  const parEcu = new Map<string, number[]>()
  for (const m of reply.messages) parEcu.set(m.ecu, [...(parEcu.get(m.ecu) || []), ...m.data.slice(2)])
  for (const bytes of parEcu.values()) {
    const txt = bytes.map(b => (b >= 0x30 && b <= 0x5a ? String.fromCharCode(b) : '')).join('')
    const v = txt.match(/[A-HJ-NPR-Z0-9]{17}/)
    if (v) return v[0]
  }
  return null
}

/** Texte du mode 09 (référence ou nom du calculateur) du premier calculateur qui en donne. */
export function textOf(reply: Reply): string | null {
  // Anciens protocoles : une ligne par morceau de 4 caractères (« 49 04 01 30 33 38 39 », « 49 04 02 … ») ; on les recolle
  // par calculateur, sinon la référence s'arrête à « 0389 » au lieu de « 038906019PA 9325 » (Sharan 2009, 13/11/2026).
  const parEcu = new Map<string, number[]>()
  for (const m of reply.messages) parEcu.set(m.ecu, [...(parEcu.get(m.ecu) || []), ...m.data.slice(m.can ? 2 : 3)])
  for (const bytes of parEcu.values()) {
    const t = bytes.filter(b => b >= 0x20 && b <= 0x7e).map(b => String.fromCharCode(b)).join('').replace(/\s+/g, ' ').trim()
    if (t) return t.slice(0, 60)
  }
  return null
}

/** Le boîtier voit-il un calculateur de boîte (« TCM-TransmisCtrl » sur l'Opel du 07/11/2026) ? Signe d'une boîte automatique, pas une preuve. */
export function hasGearboxEcu(reply: Reply): boolean {
  return reply.messages.some(m => /TCM|TRANS|GEARBOX|GETRIEBE/i.test(m.data.slice(2).filter(b => b >= 0x20 && b <= 0x7e).map(b => String.fromCharCode(b)).join('')))
}

/** Mesures disponibles sur cette voiture : réponses à 0100, 0120, 0140… (masque de 32 bits par calculateur). */
export function supportedOf(reply: Reply, base: number): Set<number> {
  const out = new Set<number>()
  for (const m of reply.messages) {
    const d = m.data.slice(2, 6)
    d.forEach((byte, i) => { for (let b = 0; b < 8; b++) if (byte & (0x80 >> b)) out.add(base + i * 8 + b + 1) })
  }
  return out
}

export interface Monitor { mil: boolean; count: number; allumage: 'compression' | 'etincelle' | null; moniteurs: number; non_prets: number }

/** Mode 01 PID 01, tous calculateurs : témoin allumé si l'un le dit, codes additionnés, contrôles non terminés. */
export function monitorOf(reply: Reply): Monitor | null {
  if (!reply.messages.length) return null
  const out: Monitor = { mil: false, count: 0, allumage: null, moniteurs: 0, non_prets: 0 }
  const bits = (x: number) => x.toString(2).replace(/0/g, '').length
  reply.messages.forEach((m, i) => {
    const [a = 0, b = 0, c = 0, d = 0] = m.data.slice(2)
    if (a & 0x80) out.mil = true
    out.count += a & 0x7f
    if (i > 0) return  // le moteur répond normalement en premier (7E8) : son état de préparation fait foi
    out.allumage = m.data.length >= 4 ? (b & 0x08 ? 'compression' : 'etincelle') : null
    out.moniteurs = bits(b & 0x07) + bits(c)
    out.non_prets = bits(b & 0x07 & (b >> 4)) + bits(c & d)
  })
  return out
}

/** Octets utiles du premier calculateur qui répond (après l'écho du mode et du PID). */
export function valueOf(reply: Reply): number[] { return reply.messages[0]?.data.slice(2) || [] }

export const coolant = (r: Reply) => { const d = valueOf(r); return d.length ? d[0] - 40 : null }
export const rpm = (r: Reply) => { const d = valueOf(r); return d.length >= 2 ? Math.round((d[0] * 256 + d[1]) / 4) : null }
export const word = (r: Reply) => { const d = valueOf(r); return d.length >= 2 ? d[0] * 256 + d[1] : null }
export const moduleVoltage = (r: Reply) => { const d = valueOf(r); return d.length >= 2 ? Math.round((d[0] * 256 + d[1]) / 10) / 100 : null }
export const odometer = (r: Reply) => { const d = valueOf(r); return d.length >= 4 ? Math.round((d[0] * 2 ** 24 + d[1] * 2 ** 16 + d[2] * 256 + d[3]) / 10) : null }

/** Mode 01 PID 51 : table SAE J1979 (Olivier 06/11/2026 : le carburant vient de la voiture, jamais de la fiche). */
const CARBURANTS: Record<number, string> = {
  1: 'essence', 2: 'méthanol', 3: 'éthanol', 4: 'diesel', 5: 'GPL', 6: 'GNC', 7: 'propane', 8: 'électrique',
  9: 'bicarburant essence', 10: 'bicarburant méthanol', 11: 'bicarburant éthanol', 12: 'bicarburant GPL', 13: 'bicarburant GNC', 14: 'bicarburant propane',
  15: 'bicarburant électrique', 16: 'bicarburant électrique et thermique',
  17: 'hybride essence', 18: 'hybride éthanol', 19: 'hybride diesel', 20: 'hybride électrique', 21: 'hybride électrique et thermique', 22: 'hybride à récupération', 23: 'bicarburant diesel',
}
export const fuelType = (r: Reply): string | null => { const d = valueOf(r); return d.length ? CARBURANTS[d[0]] || null : null }

/** Commande AT RV : tension lue par le boîtier sur la prise (V), « 12.4V ». */
export function parseAtVoltage(raw: string): number | null { const m = String(raw || '').match(/(\d{1,2}[.,]\d)\s*V/i); return m ? Number(m[1].replace(',', '.')) : null }

/** Mode 02, image figée n° 0 : « 42 PID 00 valeur… ». */
export const freezeValue = (r: Reply): number[] => r.messages[0]?.data.slice(3) || []

/** Mode 04 (effacement) : la voiture a-t-elle accepté ? */
export const clearAccepted = (raw: string, protocol: string | null): boolean => parseReply(raw, 0x04, null, protocol).status === 'ok'

export interface Lecture { complete: boolean; muette: boolean; manques: string[] }

/**
 * La lecture permet-elle de dire « pas de code » ? Le mode 03 doit avoir répondu ; un silence ne compte que si le mode 01
 * confirme 0 code. Un témoin allumé sans aucun code, ou moins de codes que la voiture n'en annonce, n'est jamais complet.
 */
export function lectureOf(input: { perdu: boolean; premier: Reply; monitor: Monitor | null; stored: Reply; pending: Reply; nbStored: number }): Lecture {
  const { perdu, premier, monitor, stored, pending, nbStored } = input
  const manques: string[] = []
  if (perdu) manques.push('lien_perdu')
  const muette = premier.status !== 'ok'
  if (muette) return { complete: false, muette: true, manques: [...manques, 'voiture_muette'] }
  const confirme = stored.status === 'ok' || (stored.status === 'pas_de_reponse' && monitor?.count === 0)
  if (!confirme) manques.push('codes_memorises')
  if (pending.status === 'erreur' || pending.status === 'refus') manques.push('codes_en_attente')
  if (monitor && monitor.count > nbStored) manques.push('codes_manquants')
  if (monitor?.mil && nbStored === 0) manques.push('temoin_sans_code')
  return { complete: manques.length === 0, muette: false, manques }
}
