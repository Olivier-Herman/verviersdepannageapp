// src/lib/obd/elm327.ts — lecture des réponses d'un boîtier OBD compatible ELM327 (Vgate iCar Pro 2S…).
// Pur traitement de texte, sans Bluetooth : testable sans boîtier. Diagnostic OBD, Olivier 05/11/2026.
//
// Le boîtier répond en texte : octets hexadécimaux séparés d'espaces, une ou plusieurs lignes, puis « > ».
// En-têtes coupés (ATH0) ; les réponses CAN sur plusieurs trames arrivent numérotées « 0: … », « 1: … ».

/** Lignes utiles d'une réponse (sans écho, invite « > », SEARCHING…, ni longueur de trame CAN « 014 »). */
export function responseLines(raw: string): string[] {
  return String(raw || '').replace(/>/g, '').split(/[\r\n]+/).map(l => l.trim())
    .filter(l => l && !/^(SEARCHING|BUS INIT|OK$|ELM|\?)/i.test(l) && !/^[0-9A-F]{3}$/i.test(l))
    .map(l => l.replace(/^[0-9A-F]:\s*/i, ''))
}

/** Le boîtier ou la voiture n'a pas répondu (pas de donnée exploitable). */
export function isNoData(raw: string): boolean {
  return /NO DATA|UNABLE TO CONNECT|CAN ERROR|BUS ERROR|STOPPED|ERROR/i.test(String(raw || ''))
}

const bytesOf = (line: string): number[] => (line.match(/[0-9A-F]{2}/gi) || []).map(h => parseInt(h, 16))

/** Octets de la réponse à une commande « mode PID » : tout ce qui suit l'écho du mode (+0x40) et du PID. */
export function payload(raw: string, mode: number, pid?: number): number[] {
  const all = responseLines(raw).flatMap(bytesOf)
  const i = all.findIndex((b, k) => b === mode + 0x40 && (pid == null || all[k + 1] === pid))
  if (i < 0) return []
  return all.slice(i + (pid == null ? 1 : 2))
}

/** Code de panne lisible à partir de deux octets : 0x01 0x33 → P0133. */
export function dtcFromBytes(a: number, b: number): string | null {
  if (!a && !b) return null
  const letter = ['P', 'C', 'B', 'U'][(a >> 6) & 3]
  return `${letter}${(a >> 4) & 3}${(a & 0x0f).toString(16).toUpperCase()}${b.toString(16).toUpperCase().padStart(2, '0')}`
}

/**
 * Codes de panne d'une réponse en mode 03 (mémorisés), 07 (en attente) ou 0A (permanents).
 * CAN : « 43 02 01 33 01 71 » (2e octet = nombre de codes). Anciens protocoles : 3 codes par ligne, complétés de zéros.
 */
export function parseDtcs(raw: string, mode: 3 | 7 | 0x0a = 3): string[] {
  if (isNoData(raw)) return []
  const out: string[] = []
  const lines = responseLines(raw).map(bytesOf).filter(b => b.length)
  // Toutes les trames d'une réponse CAN multi-trames forment un seul message ; un seul « 43 » en tête.
  const flat = lines.flat()
  const heads = flat.filter(b => b === mode + 0x40).length
  if (lines.length > 1 && heads === lines.length) {
    // Ancien protocole : une ligne = « 43 » + 3 codes.
    for (const l of lines) { const d = l.slice(1); for (let i = 0; i + 1 < d.length; i += 2) { const c = dtcFromBytes(d[i], d[i + 1]); if (c) out.push(c) } }
  } else {
    let d = flat.slice(flat.indexOf(mode + 0x40) + 1)
    if (d.length % 2 === 1) d = d.slice(1)   // CAN : nombre de codes en tête
    for (let i = 0; i + 1 < d.length; i += 2) { const c = dtcFromBytes(d[i], d[i + 1]); if (c) out.push(c) }
  }
  return [...new Set(out)]
}

/** Numéro de châssis (mode 09, PID 02) : les caractères ASCII du message, dont les 17 derniers valides. */
export function parseVin(raw: string): string | null {
  if (isNoData(raw)) return null
  const bytes = payload(raw, 0x09, 0x02)
  const txt = bytes.map(b => (b >= 0x30 && b <= 0x5a ? String.fromCharCode(b) : '')).join('')
  const m = txt.match(/[A-HJ-NPR-Z0-9]{17}$/) || txt.match(/[A-HJ-NPR-Z0-9]{17}/)
  return m ? m[0] : null
}

/** Mode 01 PID 01 : témoin moteur allumé, nombre de codes. */
export function parseMonitorStatus(raw: string): { mil: boolean; count: number } | null {
  const d = payload(raw, 0x01, 0x01)
  if (!d.length) return null
  return { mil: (d[0] & 0x80) !== 0, count: d[0] & 0x7f }
}

/** Mode 01 PID 05 : température du liquide de refroidissement (°C). */
export function parseCoolant(raw: string): number | null { const d = payload(raw, 0x01, 0x05); return d.length ? d[0] - 40 : null }

/** Mode 01 PID 0C : régime moteur (tr/min). */
export function parseRpm(raw: string): number | null { const d = payload(raw, 0x01, 0x0c); return d.length >= 2 ? Math.round((d[0] * 256 + d[1]) / 4) : null }

/** Mode 01 PID 42 : tension du module de commande (V). */
/** Mode 01 PID 51 : carburant déclaré par la voiture, quand elle le donne (Olivier 06/11/2026). */
const CARBURANTS: Record<number, string> = { 1: 'essence', 2: 'méthanol', 3: 'éthanol', 4: 'diesel', 5: 'GPL', 6: 'GNC', 8: 'électrique', 17: 'hybride essence', 18: 'hybride diesel', 19: 'hybride électrique', 20: 'hybride', 21: 'hybride rechargeable' }
export function parseFuelType(raw: string): string | null { const d = payload(raw, 0x01, 0x51); return d.length ? CARBURANTS[d[0]] || null : null }

export function parseModuleVoltage(raw: string): number | null { const d = payload(raw, 0x01, 0x42); return d.length >= 2 ? Math.round((d[0] * 256 + d[1]) / 10) / 100 : null }

/** Commande AT RV : tension lue par le boîtier sur la prise (V), « 12.4V ». */
export function parseAtVoltage(raw: string): number | null { const m = String(raw || '').match(/(\d{1,2}[.,]\d)\s*V/i); return m ? Number(m[1].replace(',', '.')) : null }

/** Mode 04 (effacement) : la voiture a-t-elle accepté ? « 44 » = oui. */
export function clearAccepted(raw: string): boolean {
  return !isNoData(raw) && responseLines(raw).some(l => /^44\b/.test(l.replace(/\s/g, '').slice(0, 2)) || /^44/.test(l))
}
