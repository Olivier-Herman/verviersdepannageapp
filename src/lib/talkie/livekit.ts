// src/lib/talkie/livekit.ts — jeton d'accès au serveur vocal LiveKit (VPS) pour le
// talkie (Olivier 01/10/2026). JWT HS256 signé avec la clé du serveur : salle = nom
// secret du canal, identité = l'utilisateur. Variables : LIVEKIT_URL, LIVEKIT_API_KEY,
// LIVEKIT_API_SECRET (Vercel). Sans elles, le talkie reste sur la voix par Supabase.
import { createHmac, timingSafeEqual } from 'crypto'

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

export function livekitConfigured(): boolean {
  return !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET)
}

export function livekitToken(room: string, identity: string, name: string, ttlSec = 6 * 3600): { url: string; token: string } | null {
  const url = process.env.LIVEKIT_URL, key = process.env.LIVEKIT_API_KEY, secret = process.env.LIVEKIT_API_SECRET
  if (!url || !key || !secret) return null
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss: key, sub: identity, name, nbf: now - 10, exp: now + ttlSec,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  }))
  const sig = b64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest())
  return { url, token: `${header}.${payload}.${sig}` }
}

/** Suffixe d'identité du module iPhone natif (téléphone verrouillé) : distinct de la
 *  page, sinon LiveKit déconnecte l'une quand l'autre se connecte (même identité). */
export const NATIVE_SUFFIX = '#ptt'
export const baseIdentity = (identity: string) => identity.split('#')[0]

/** Vérifie un jeton émis par livekitToken (signature + validité) → identité et salle. */
export function verifyLivekitToken(token: string): { identity: string; room: string } | null {
  const secret = process.env.LIVEKIT_API_SECRET
  const parts = token.split('.')
  if (!secret || parts.length !== 3) return null
  const sig = Buffer.from(b64url(createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest()))
  const got = Buffer.from(parts[2])
  if (sig.length !== got.length || !timingSafeEqual(sig, got)) return null
  try {
    const p = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    const now = Math.floor(Date.now() / 1000)
    if (p.iss !== process.env.LIVEKIT_API_KEY || typeof p.exp !== 'number' || p.exp < now || typeof p.sub !== 'string' || !p.video?.room) return null
    return { identity: p.sub, room: String(p.video.room) }
  } catch { return null }
}
