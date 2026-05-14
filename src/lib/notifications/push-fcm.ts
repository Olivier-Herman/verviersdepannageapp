// src/lib/notifications/push-fcm.ts
//
// Helper pour envoyer un push vers Firebase Cloud Messaging (FCM v1, Android).
//
// Setup attendu :
//   1. Firebase Console → cree un projet (ou utilise existant)
//   2. Project Settings → Cloud Messaging API V1 (activer)
//   3. Project Settings → Service Accounts → Generate new private key → .json
//   4. Vercel env vars :
//        FCM_PROJECT_ID           (visible dans Project Settings)
//        FCM_CLIENT_EMAIL         (champ client_email du JSON)
//        FCM_PRIVATE_KEY          (champ private_key du JSON, \n litteraux OK)
//
// FCM exige un OAuth2 access_token genere a partir d'un JWT signe RS256 avec
// la cle privee du Service Account. On cache le token ~50min.

import { SignJWT, importPKCS8 } from 'jose'

let cachedAccessToken:        string | null = null
let cachedAccessTokenExpiry:  number        = 0

async function getFcmAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedAccessToken && cachedAccessTokenExpiry > now + 60) return cachedAccessToken

  const clientEmail = process.env.FCM_CLIENT_EMAIL
  const privateKey  = process.env.FCM_PRIVATE_KEY
  if (!clientEmail || !privateKey) {
    throw new Error('FCM non configure (FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY manquant)')
  }

  const pem = privateKey.replace(/\\n/g, '\n')
  const key = await importPKCS8(pem, 'RS256')

  // JWT signed assertion pour OAuth2 token endpoint
  const jwt = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key)

  // Exchange JWT for access_token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`FCM token exchange failed: ${res.status} ${text.slice(0, 200)}`)
  }
  const data = await res.json() as { access_token: string; expires_in: number }

  cachedAccessToken       = data.access_token
  cachedAccessTokenExpiry = now + Math.min(data.expires_in - 60, 50 * 60)
  return data.access_token
}

export interface FcmPayload {
  title:       string
  body:        string
  action_url?: string
  mission_id?: string
  notif_type?: string
  data?:       Record<string, any>
}

export interface FcmResult {
  ok:     boolean
  status: number
  reason?: string
  invalid_token?: boolean
}

export async function sendFcmPush(token: string, payload: FcmPayload): Promise<FcmResult> {
  const projectId = process.env.FCM_PROJECT_ID
  if (!projectId) {
    return { ok: false, status: 0, reason: 'FCM_PROJECT_ID manquant' }
  }

  let accessToken: string
  try { accessToken = await getFcmAccessToken() }
  catch (e: any) { return { ok: false, status: 0, reason: e.message || 'OAuth error' } }

  // FCM data fields doivent etre des strings (pas de nested objects)
  const dataFlat: Record<string, string> = {}
  if (payload.action_url) dataFlat.action_url = payload.action_url
  if (payload.mission_id) dataFlat.mission_id = payload.mission_id
  if (payload.notif_type) dataFlat.notif_type = payload.notif_type
  for (const [k, v] of Object.entries(payload.data || {})) {
    dataFlat[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }

  const message = {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      data: dataFlat,
      android: {
        priority: 'HIGH',
        notification: {
          sound: 'default',
          channel_id: 'verviers_default',
        },
      },
    },
  }

  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method:  'POST',
        headers: {
          'authorization': `Bearer ${accessToken}`,
          'content-type':  'application/json',
        },
        body: JSON.stringify(message),
      }
    )

    if (res.ok) return { ok: true, status: 200 }

    let reason = res.statusText
    let invalidToken = false
    try {
      const body = await res.json()
      reason = body?.error?.message || body?.error?.status || reason
      // FCM v1 retourne UNREGISTERED / NOT_FOUND / INVALID_ARGUMENT pour tokens morts
      if (body?.error?.details?.[0]?.errorCode === 'UNREGISTERED') invalidToken = true
      if (body?.error?.status === 'NOT_FOUND') invalidToken = true
      if (res.status === 404) invalidToken = true
    } catch { /* ignore */ }

    return { ok: false, status: res.status, reason, invalid_token: invalidToken }
  } catch (e: any) {
    return { ok: false, status: 0, reason: e.message || 'fetch error' }
  }
}
