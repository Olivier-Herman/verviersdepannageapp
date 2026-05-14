// src/lib/notifications/push-apns.ts
//
// Helper pour envoyer un push vers Apple Push Notification service (APNs).
//
// Apple exige un JWT signé en ES256 avec la clé privée (.p8) configurée dans
// Apple Developer Console. Le JWT est valide 1h max, on le cache 50 min.
//
// Variables d'env Vercel (Production) :
//   APNS_KEY_ID       — 10 chars, ID de la clé Apple
//   APNS_TEAM_ID      — 10 chars, ID Apple Team
//   APNS_BUNDLE_ID    — ex 'com.verviersdepannage.app'
//   APNS_AUTH_KEY     — contenu complet du .p8 (avec les BEGIN/END PRIVATE KEY)
//   APNS_USE_SANDBOX  — 'true' pour dev (api.sandbox.push.apple.com), sinon prod

import { SignJWT, importPKCS8 } from 'jose'

let cachedJwt:        string | null = null
let cachedJwtExpiry:  number        = 0

async function getApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedJwt && cachedJwtExpiry > now + 60) return cachedJwt

  const keyId   = process.env.APNS_KEY_ID
  const teamId  = process.env.APNS_TEAM_ID
  const p8      = process.env.APNS_AUTH_KEY
  if (!keyId || !teamId || !p8) {
    throw new Error('APNs non configure (APNS_KEY_ID / APNS_TEAM_ID / APNS_AUTH_KEY manquant)')
  }

  // Le .p8 stocke parfois \n litteraux dans une env var → on normalise
  const pem = p8.replace(/\\n/g, '\n')
  const privateKey = await importPKCS8(pem, 'ES256')

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .sign(privateKey)

  cachedJwt       = jwt
  cachedJwtExpiry = now + 50 * 60  // 50 min, JWT APNs valide max 60 min
  return jwt
}

export interface ApnsPayload {
  title:       string
  body:        string
  /** URL ouverte au tap (deep link via UNNotificationCategory plus tard) */
  action_url?: string
  /** ID mission, propage cote app pour navigation */
  mission_id?: string
  /** Type de notif (cote app : choisir le son / l'action) */
  notif_type?: string
  /** Donnees custom */
  data?:       Record<string, any>
}

export interface ApnsResult {
  ok:     boolean
  status: number
  reason?: string
  /** Si Apple renvoie 410, le token est invalide → caller doit supprimer */
  invalid_token?: boolean
}

/**
 * Envoie un push APNs vers UN device token (iOS).
 * Retourne le statut HTTP + reason si erreur.
 */
export async function sendApnsPush(token: string, payload: ApnsPayload): Promise<ApnsResult> {
  const bundleId  = process.env.APNS_BUNDLE_ID
  const sandbox   = process.env.APNS_USE_SANDBOX === 'true'
  if (!bundleId) {
    return { ok: false, status: 0, reason: 'APNS_BUNDLE_ID manquant' }
  }

  let jwt: string
  try { jwt = await getApnsJwt() }
  catch (e: any) { return { ok: false, status: 0, reason: e.message || 'JWT error' } }

  const host = sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'
  const url  = `https://${host}/3/device/${encodeURIComponent(token)}`

  // Payload APNs format : aps + custom data
  const apsBody = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      'mutable-content': 1,
    },
    notif_type: payload.notif_type,
    action_url: payload.action_url,
    mission_id: payload.mission_id,
    ...payload.data,
  }

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'authorization':   `bearer ${jwt}`,
        'apns-topic':      bundleId,
        'apns-push-type':  'alert',
        'apns-priority':   '10',
        'content-type':    'application/json',
      },
      body: JSON.stringify(apsBody),
    })

    if (res.status === 200) return { ok: true, status: 200 }

    let reason = res.statusText
    try {
      const body = await res.json()
      if (body?.reason) reason = body.reason
    } catch { /* ignore non-JSON */ }

    // 410 Gone = device token desactive (app desinstallee, etc.) → marquer invalide
    // 400 BadDeviceToken = token malforme → invalide aussi
    const invalidToken = res.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered'

    return { ok: false, status: res.status, reason, invalid_token: invalidToken }
  } catch (e: any) {
    return { ok: false, status: 0, reason: e.message || 'fetch error' }
  }
}
