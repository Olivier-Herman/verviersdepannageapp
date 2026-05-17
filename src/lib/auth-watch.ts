// src/lib/auth-watch.ts
//
// Auth pour les endpoints /api/watch/*.
//
// L Apple Watch ne peut pas utiliser le cookie NextAuth (pas de WebView,
// Swift natif). On emet un JWT signe HS256 long terme (90 j) avec
// NEXTAUTH_SECRET comme cle HMAC. L iPhone genere le token via
// /api/watch/issue-token (NextAuth session normale), puis l envoie a la
// Watch via WatchConnectivity. La Watch le persiste en Keychain et l
// utilise en Authorization: Bearer pour tous les /api/watch/*.

import { SignJWT, jwtVerify } from 'jose'

const WATCH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60 // 90 jours

function getSecret(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET manquant')
  return new TextEncoder().encode(s)
}

export interface WatchTokenPayload {
  sub:  string  // user_id
  type: 'watch'
  iat:  number
  exp:  number
}

/** Emet un JWT Watch pour un user. Appele depuis /api/watch/issue-token. */
export async function issueWatchToken(userId: string): Promise<{ token: string; expires_at: string }> {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + WATCH_TOKEN_TTL_SECONDS
  const token = await new SignJWT({ type: 'watch' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getSecret())
  return { token, expires_at: new Date(exp * 1000).toISOString() }
}

/**
 * Verifie le header Authorization: Bearer <jwt> d une requete Watch.
 * Retourne le user_id si valide, sinon null.
 */
export async function verifyWatchAuth(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    if (payload.type !== 'watch') return null
    if (typeof payload.sub !== 'string' || !payload.sub) return null
    return payload.sub
  } catch {
    return null
  }
}
