// src/lib/notifications/push-apns.ts
//
// Helper pour envoyer un push vers Apple Push Notification service (APNs).
//
// Apple exige HTTP/2 obligatoirement. Le fetch natif undici de Vercel
// Node runtime ne fait pas toujours l'upgrade ALPN h2 → on utilise donc
// le module 'node:http2' natif directement, plus fiable.
//
// JWT signe en ES256 avec la cle privee (.p8), valide 1h, cache 50min.
//
// Variables d'env Vercel (Production) :
//   APNS_KEY_ID       — 10 chars, ID de la cle Apple
//   APNS_TEAM_ID      — 10 chars, ID Apple Team
//   APNS_BUNDLE_ID    — ex 'com.verviersdepannage.app'
//   APNS_AUTH_KEY     — contenu complet du .p8 (avec les BEGIN/END PRIVATE KEY)
//   APNS_USE_SANDBOX  — 'true' pour dev (api.sandbox.push.apple.com), sinon prod

import { SignJWT, importPKCS8 } from 'jose'
import http2 from 'node:http2'

let cachedJwt:        string | null = null
let cachedJwtExpiry:  number        = 0

export async function getApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedJwt && cachedJwtExpiry > now + 60) return cachedJwt

  const keyId   = process.env.APNS_KEY_ID
  const teamId  = process.env.APNS_TEAM_ID
  const p8      = process.env.APNS_AUTH_KEY
  if (!keyId || !teamId || !p8) {
    throw new Error('APNs non configure (APNS_KEY_ID / APNS_TEAM_ID / APNS_AUTH_KEY manquant)')
  }

  const pem = p8.replace(/\\n/g, '\n')
  const privateKey = await importPKCS8(pem, 'ES256')

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .sign(privateKey)

  cachedJwt       = jwt
  cachedJwtExpiry = now + 50 * 60
  return jwt
}

export interface ApnsPayload {
  title:       string
  body:        string
  action_url?: string
  mission_id?: string
  notif_type?: string
  data?:       Record<string, any>
  /**
   * 'alert' (default) : notif visible avec son.
   * 'background' : silent push (content-available=1, no alert) — utilise
   * pour reveiller l app Watch et la faire refetch /api/watch/missions/today.
   */
  push_type?: 'alert' | 'background'
}

export interface ApnsOptions {
  /**
   * Override du topic APNs. Default = APNS_BUNDLE_ID. Pour la Watch,
   * passer `${APNS_BUNDLE_ID}.watchkitapp`.
   */
  topic?: string
}

export interface ApnsResult {
  ok:     boolean
  status: number
  reason?: string
  invalid_token?: boolean
}

export async function sendApnsPush(
  token:    string,
  payload:  ApnsPayload,
  options?: ApnsOptions,
): Promise<ApnsResult> {
  const bundleId  = process.env.APNS_BUNDLE_ID
  const sandbox   = process.env.APNS_USE_SANDBOX === 'true'
  if (!bundleId) {
    return { ok: false, status: 0, reason: 'APNS_BUNDLE_ID manquant' }
  }
  const topic = options?.topic || bundleId

  let jwt: string
  try { jwt = await getApnsJwt() }
  catch (e: any) {
    console.error('[push-apns] JWT error:', e.message)
    return { ok: false, status: 0, reason: e.message || 'JWT error' }
  }

  const host = sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'

  // Mapping son par type (fichiers .caf bundles dans le wrapper iOS).
  // Pour ajouter des sons differencies, drag&drop le .caf dans Xcode
  // (target App → Build Phases → Copy Bundle Resources) puis ajouter
  // l'entree ci-dessous. Si le fichier est absent du bundle, iOS fallback
  // silencieusement sur 'default'.
  const SOUND_BY_TYPE: Record<string, string> = {
    new_mission_received:        'sounds.caf',
    mission_assigned_manual:     'sounds.caf',
    auto_dispatch_dispo_request: 'sounds.caf',
    auto_dispatch_refused:       'sounds.caf',
    auto_dispatch_timeout:       'sounds.caf',
    escalation_call:             'sounds.caf',
    payment_validated:           'sounds.caf',
    check_vehicule_due:          'sounds.caf',
    email_parse_error:           'sounds.caf',
    garde_uncovered:             'sounds.caf',
  }
  const sound = (payload.notif_type && SOUND_BY_TYPE[payload.notif_type]) || 'sounds.caf'

  const isBackground = payload.push_type === 'background'
  const apsBody = isBackground
    ? {
        // Silent push : pas d alert visible, juste content-available=1
        // pour reveiller l app et lui permettre de refetch.
        aps: { 'content-available': 1 },
        notif_type: payload.notif_type,
        action_url: payload.action_url,
        mission_id: payload.mission_id,
        ...payload.data,
      }
    : {
        aps: {
          alert: { title: payload.title, body: payload.body },
          sound,
          'mutable-content': 1,
        },
        notif_type: payload.notif_type,
        action_url: payload.action_url,
        mission_id: payload.mission_id,
        ...payload.data,
      }
  const bodyBuf = Buffer.from(JSON.stringify(apsBody))

  return new Promise<ApnsResult>((resolve) => {
    let client: http2.ClientHttp2Session | null = null
    let settled = false

    const finish = (result: ApnsResult) => {
      if (settled) return
      settled = true
      try { client?.close() } catch { /* ignore */ }
      resolve(result)
    }

    try {
      client = http2.connect(`https://${host}`)
    } catch (e: any) {
      return finish({ ok: false, status: 0, reason: `connect failed: ${e.message}` })
    }

    client.on('error', (err: any) => {
      console.error('[push-apns] http2 client error:', err.message, 'code:', err.code)
      finish({ ok: false, status: 0, reason: `http2 error: ${err.code || err.message}` })
    })

    const req = client.request({
      ':method':         'POST',
      ':path':           `/3/device/${token}`,
      'authorization':   `bearer ${jwt}`,
      'apns-topic':      topic,
      'apns-push-type':  isBackground ? 'background' : 'alert',
      // Background push : priority 5 obligatoire (priority 10 = bloque par Apple).
      'apns-priority':   isBackground ? '5' : '10',
      'content-type':    'application/json',
      'content-length':  bodyBuf.length,
    })

    let status = 0
    let respBody = ''

    req.on('response', (headers) => {
      status = Number(headers[':status']) || 0
    })
    req.on('data', (chunk) => { respBody += chunk.toString() })
    req.on('end', () => {
      if (status === 200) {
        return finish({ ok: true, status: 200 })
      }
      let reason = ''
      try {
        const json = JSON.parse(respBody)
        reason = json?.reason || ''
      } catch { /* non-JSON */ }
      const invalidToken =
        status === 410 ||
        reason === 'BadDeviceToken' ||
        reason === 'Unregistered' ||
        reason === 'DeviceTokenNotForTopic'
      finish({ ok: false, status, reason: reason || `HTTP ${status}`, invalid_token: invalidToken })
    })
    req.on('error', (err: any) => {
      console.error('[push-apns] http2 req error:', err.message, 'code:', err.code)
      finish({ ok: false, status: 0, reason: `req error: ${err.code || err.message}` })
    })

    req.setTimeout(15000, () => {
      console.error('[push-apns] timeout 15s')
      try { req.close() } catch { /* ignore */ }
      finish({ ok: false, status: 0, reason: 'timeout' })
    })

    req.end(bodyBuf)
  })
}
