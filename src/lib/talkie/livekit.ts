// src/lib/talkie/livekit.ts — jeton d'accès au serveur vocal LiveKit (VPS) pour le
// talkie (Olivier 01/10/2026). JWT HS256 signé avec la clé du serveur : salle = nom
// secret du canal, identité = l'utilisateur. Variables : LIVEKIT_URL, LIVEKIT_API_KEY,
// LIVEKIT_API_SECRET (Vercel). Sans elles, le talkie reste sur la voix par Supabase.
import { createHmac } from 'crypto'

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
