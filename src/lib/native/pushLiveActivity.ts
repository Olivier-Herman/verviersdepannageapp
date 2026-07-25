// src/lib/native/pushLiveActivity.ts
//
// Push ActivityKit (v2) : met à jour une Live Activity « mission chauffeur »
// EN TEMPS RÉEL, même quand l'app est suspendue (écran verrouillé).
//
// Apple exige un push dédié pour les Live Activities :
//   - apns-push-type : liveactivity
//   - apns-topic     : `${BUNDLE_ID}.push-type.liveactivity`
//   - aps.event      : "update" | "end"
//   - aps.content-state : le nouvel état (doit matcher ContentState Swift =
//     MissionState : step/title/address/etaMinutes/badgeText/accent).
//
// Le push token de l'activité est fourni par le natif (event 'pushToken') et
// stocké sur incoming_missions.live_activity_push_token (ou, pour la démo, dans
// app_settings). Olivier 2026-07-28.

import http2 from 'node:http2'
import { getApnsJwt } from '@/lib/notifications/push-apns'
import { createAdminClient } from '@/lib/supabase'
import { missionToLAState, type MissionLAState } from './liveActivity'

export interface LiveActivityPushResult {
  ok: boolean
  status: number
  reason?: string
  invalid_token?: boolean
}

/**
 * Envoi bas niveau d'un push Live Activity vers un token d'activité.
 * `contentState` doit correspondre exactement à ContentState (MissionState) Swift.
 */
export async function sendLiveActivityApns(
  pushToken: string,
  opts: {
    event: 'update' | 'end'
    contentState: MissionLAState
    /** Fraîcheur : secondes avant que iOS grise l'activité (défaut 8 h). */
    staleSeconds?: number
    /** Pour event:'end' — secondes avant retrait auto de l'écran (défaut immédiat). */
    dismissSeconds?: number
    /** Alerte optionnelle (bandeau + son) accompagnant la MAJ. */
    alert?: { title: string; body: string }
  },
): Promise<LiveActivityPushResult> {
  const bundleId = process.env.APNS_BUNDLE_ID
  const sandbox  = process.env.APNS_USE_SANDBOX === 'true'
  if (!bundleId) return { ok: false, status: 0, reason: 'APNS_BUNDLE_ID manquant' }
  if (!pushToken) return { ok: false, status: 0, reason: 'push token vide' }

  let jwt: string
  try { jwt = await getApnsJwt() }
  catch (e: any) { return { ok: false, status: 0, reason: e?.message || 'JWT error' } }

  const nowSec = Math.floor(Date.now() / 1000)
  const aps: Record<string, any> = {
    timestamp: nowSec,
    event: opts.event,
    'content-state': opts.contentState,
  }
  if (opts.staleSeconds) aps['stale-date'] = nowSec + opts.staleSeconds
  if (opts.event === 'end') aps['dismissal-date'] = nowSec + (opts.dismissSeconds ?? 0)
  if (opts.alert) aps.alert = { title: opts.alert.title, body: opts.alert.body }

  const bodyBuf = Buffer.from(JSON.stringify({ aps }))
  const host = sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'

  return new Promise<LiveActivityPushResult>((resolve) => {
    let client: http2.ClientHttp2Session | null = null
    let settled = false
    const finish = (r: LiveActivityPushResult) => {
      if (settled) return
      settled = true
      try { client?.close() } catch { /* ignore */ }
      resolve(r)
    }

    try { client = http2.connect(`https://${host}`) }
    catch (e: any) { return finish({ ok: false, status: 0, reason: `connect: ${e.message}` }) }

    client.on('error', (err: any) =>
      finish({ ok: false, status: 0, reason: `http2: ${err.code || err.message}` }))

    const req = client.request({
      ':method':        'POST',
      ':path':          `/3/device/${pushToken}`,
      'authorization':  `bearer ${jwt}`,
      'apns-topic':     `${bundleId}.push-type.liveactivity`,
      'apns-push-type': 'liveactivity',
      'apns-priority':  '10',
      'content-type':   'application/json',
      'content-length': bodyBuf.length,
    })

    let status = 0
    let respBody = ''
    req.on('response', (h) => { status = Number(h[':status']) || 0 })
    req.on('data', (c) => { respBody += c.toString() })
    req.on('end', () => {
      if (status === 200) return finish({ ok: true, status: 200 })
      let reason = ''
      try { reason = JSON.parse(respBody)?.reason || '' } catch { /* non-JSON */ }
      const invalid = status === 410 || reason === 'BadDeviceToken' ||
        reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic'
      finish({ ok: false, status, reason: reason || `HTTP ${status}`, invalid_token: invalid })
    })
    req.on('error', (err: any) => finish({ ok: false, status: 0, reason: `req: ${err.code || err.message}` }))
    req.setTimeout(15000, () => { try { req.close() } catch { /* ignore */ } finish({ ok: false, status: 0, reason: 'timeout' }) })
    req.end(bodyBuf)
  })
}

/**
 * Push l'état COURANT d'une vraie mission vers sa Live Activity (best-effort).
 * À appeler après tout changement d'état (action chauffeur, dispatch, annulation…).
 */
export async function pushMissionLiveActivity(
  missionId: string,
  opts?: { event?: 'update' | 'end'; alert?: { title: string; body: string } },
): Promise<LiveActivityPushResult> {
  try {
    const sb = createAdminClient()
    const { data } = await sb
      .from('incoming_missions')
      .select('id, status, on_site_at, loaded_at, mission_type, incident_address, destination_address, live_activity_push_token')
      .eq('id', missionId)
      .maybeSingle()

    const token = (data as any)?.live_activity_push_token as string | undefined
    if (!data || !token) return { ok: false, status: 0, reason: 'no push token' }

    const state = missionToLAState({ ...(data as any), driver_eta_minutes: null })
    const event = opts?.event
      ?? (['done', 'completed', 'cancelled', 'parked'].includes((data as any).status) ? 'end' : 'update')

    const res = await sendLiveActivityApns(token, { event, contentState: state, staleSeconds: 8 * 3600, alert: opts?.alert })

    // Token périmé → on le nettoie pour ne pas repush indéfiniment.
    if (res.invalid_token) {
      await sb.from('incoming_missions').update({ live_activity_push_token: null }).eq('id', missionId).then(() => {}, () => {})
    }
    return res
  } catch (e: any) {
    return { ok: false, status: 0, reason: e?.message || 'error' }
  }
}
