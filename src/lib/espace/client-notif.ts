// src/lib/espace/client-notif.ts
//
// VD Assistance (Olivier 10/10/2026) : le client en panne est rassuré par une notification à chaque étape clé —
// demande acceptée, chauffeur en route, chauffeur arrivé. Web push (navigateur, app installée sur Android) et APNs
// (app iPhone VD Assistance). Une seule fois par étape et par mission ; jamais bloquant.

import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase'
import { sendApnsPush } from '@/lib/notifications/push-apns'

export type EtapeClient = 'acceptee' | 'en_route' | 'sur_place'
const APNS_TOPIC = 'com.verviersdepannage.assistance'   // identifiant de l'app iPhone VD Assistance

const TEXTES: Record<EtapeClient, { title: string; body: string }> = {
  acceptee: { title: 'Demande acceptée', body: 'Un dépanneur va partir vers vous. Gardez votre téléphone à portée de main.' },
  en_route: { title: 'Votre chauffeur est en route', body: 'Il arrive. Restez près de votre véhicule, en sécurité.' },
  sur_place: { title: 'Votre chauffeur est arrivé', body: 'Il est sur place.' },
}

export async function prevenirClient(missionId: string, etape: EtapeClient): Promise<void> {
  try {
    const sb = createAdminClient()
    const { data: m } = await sb.from('incoming_missions').select('id, espace_client_id').eq('id', missionId).maybeSingle()
    if (!m?.espace_client_id) return
    // Une seule notification par étape (le chauffeur peut repasser deux fois par le même bouton).
    const action = `client_notifie_${etape}`
    const { count } = await sb.from('mission_logs').select('id', { count: 'exact', head: true }).eq('mission_id', m.id).eq('action', action)
    if (count) return
    const { data: c } = await sb.from('espace_clients').select('id, active').eq('id', m.espace_client_id).maybeSingle()
    if (!c?.active) return
    const { data: abos } = await sb.from('espace_client_push').select('id, kind, token, subscription').eq('client_id', c.id)
    await sb.from('mission_logs').insert({ mission_id: m.id, action, notes: `Client prévenu : ${TEXTES[etape].title}` }).then(() => {}, () => {})
    if (!abos?.length) return
    const t = TEXTES[etape]
    const url = '/assistance'
    const morts: string[] = []
    if (abos.some(a => a.kind === 'web') && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY)
    }
    for (const a of abos) {
      try {
        if (a.kind === 'web' && a.subscription) {
          await webpush.sendNotification(a.subscription as any, JSON.stringify({ ...t, url, tag: `vd-assist-${m.id}`, icon: '/noprecache/assistance/icon-192.png' }))
        } else if (a.kind === 'apns') {
          const r = await sendApnsPush(a.token, { title: t.title, body: t.body, notif_type: 'client_assistance', action_url: url, mission_id: m.id } as any, { topic: APNS_TOPIC })
          if (r.invalid_token) morts.push(a.id)
        }
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) morts.push(a.id)
        else console.warn('[VD Assistance] notification KO', e?.message)
      }
    }
    if (morts.length) await sb.from('espace_client_push').delete().in('id', morts)
  } catch (e: any) {
    console.warn('[VD Assistance] prévenir client KO', e?.message)
  }
}
