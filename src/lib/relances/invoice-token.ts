// ============================================================
// Module Relance — Tokens HMAC pour liens factures cliquables
// ============================================================
// Pattern : signature HMAC-SHA256 d un payload {invoiceId, exp} pour
// authentifier les liens factures dans le PDF de relance. Le client
// peut ainsi cliquer sur un numero de facture dans le PDF -> ouvre
// dans son navigateur l URL signee qui retourne le PDF de la facture.
//
// Securite :
// - Le token contient l invoice_id + une date d expiration.
// - Signature HMAC verifiee cote serveur a chaque requete.
// - Une cle secrete env var INVOICE_LINK_SECRET permet de revoquer
//   tous les tokens en une fois (rotation manuelle).
// - Pas de cookie ni de session : le token est self-contained.

import crypto from 'crypto'

const SECRET = process.env.INVOICE_LINK_SECRET || process.env.NEXTAUTH_SECRET || ''
const DEFAULT_TTL_S = 365 * 24 * 60 * 60   // 1 an

if (!SECRET) {
  console.warn('[relances/invoice-token] Aucun INVOICE_LINK_SECRET ni NEXTAUTH_SECRET defini — les tokens factures ne seront pas securises')
}

interface TokenPayload {
  iid: number   // invoice_id
  exp: number   // unix epoch seconds
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

/**
 * Signe un invoice_id et retourne un token compact b64url
 * format : "<payload_b64>.<sig_b64>"
 */
export function signInvoiceToken(invoiceId: number, ttlSec: number = DEFAULT_TTL_S): string {
  const payload: TokenPayload = {
    iid: invoiceId,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  }
  const payloadStr = JSON.stringify(payload)
  const payloadB64 = b64urlEncode(Buffer.from(payloadStr, 'utf-8'))

  const sig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest()
  const sigB64 = b64urlEncode(sig)

  return `${payloadB64}.${sigB64}`
}

/**
 * Verifie un token et retourne l invoice_id si valide, sinon null.
 * Verifie : signature + non expire.
 */
export function verifyInvoiceToken(token: string): number | null {
  if (!token || !SECRET) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, sigB64] = parts

  const expectedSig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest()
  const givenSig = b64urlDecode(sigB64)
  if (expectedSig.length !== givenSig.length) return null
  if (!crypto.timingSafeEqual(expectedSig, givenSig)) return null

  let payload: TokenPayload
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf-8'))
  } catch {
    return null
  }
  if (typeof payload.iid !== 'number' || typeof payload.exp !== 'number') return null
  if (Date.now() / 1000 > payload.exp) return null   // expire

  return payload.iid
}
