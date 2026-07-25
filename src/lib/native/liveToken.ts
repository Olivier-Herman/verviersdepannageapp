// src/lib/native/liveToken.ts
//
// Token signé (HMAC) pour les actions de la Live Activity depuis les App Intents
// iOS (qui n'ont pas le cookie de session). Le token porte l'id du chauffeur et
// une expiration ; il est vérifié par /api/missions/live-action.
//
// Auto-suffisant (pas de dépendance) : base64url(payload).hmacSHA256(payload).
// Olivier 2026-07-28.

import crypto from 'crypto'

const SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret'
const TTL_MS = 30 * 24 * 60 * 60 * 1000   // 30 jours

interface LiveTokenPayload { uid: string; exp: number }

export function signLiveToken(uid: string): string {
  const payload: LiveTokenPayload = { uid, exp: Date.now() + TTL_MS }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig  = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyLiveToken(token: string): { uid: string } | null {
  try {
    const [body, sig] = String(token || '').split('.')
    if (!body || !sig) return null
    const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
    // Comparaison à temps constant.
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as LiveTokenPayload
    if (!payload.uid || !payload.exp || Date.now() > payload.exp) return null
    return { uid: payload.uid }
  } catch { return null }
}
