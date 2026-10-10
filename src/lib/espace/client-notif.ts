// src/lib/espace/client-notif.ts
//
// VD Assistance (Olivier 10/10/2026) : le client en panne est rassuré par une notification à chaque étape clé —
// demande acceptée, chauffeur en route, chauffeur arrivé. Web push (navigateur, app installée sur Android) et APNs
// (app iPhone VD Assistance). Une seule fois par étape et par mission ; jamais bloquant.

import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase'
import { sendApnsPush } from '@/lib/notifications/push-apns'

export type EtapeClient = 'acceptee' | 'en_route' | 'sur_place' | 'au_depot' | 'livre'
const APNS_TOPIC = 'com.verviersdepannage.assistance'   // identifiant de l'app iPhone VD Assistance

const TEXTES: Record<EtapeClient, { title: string; body: string }> = {
  acceptee: { title: 'Demande acceptée', body: 'Un dépanneur va partir vers vous. Gardez votre téléphone à portée de main.' },
  en_route: { title: 'Votre chauffeur est en route', body: 'Il arrive. Restez près de votre véhicule, en sécurité.' },
  sur_place: { title: 'Votre chauffeur est arrivé', body: 'Il est sur place.' },
  // Remorquage hors des heures d'ouverture du garage : mise en parc chez nous, livraison au garage ensuite.
  au_depot: { title: 'Votre véhicule est à notre dépôt', body: 'Il sera livré à votre garage dès son ouverture.' },
  livre: { title: 'Véhicule livré à votre garage', body: 'Votre garage prend le relais.' },
}

// ── Dynamic Island / écran verrouillé (app iPhone) : état de la Live Activity « AssistanceActivityAttributes ».
// ContentState Swift = { step: Int (0 reçue · 1 acceptée · 2 en route · 3 sur place · 4 terminée), title, subtitle }.
const ETAPES_LA: Record<EtapeClient | 'terminee' | 'annulee', { step: number; title: string; subtitle: string }> = {
  acceptee: { step: 1, title: 'Demande acceptée', subtitle: 'Un dépanneur va partir vers vous' },
  en_route: { step: 2, title: 'Chauffeur en route', subtitle: 'Restez près de votre véhicule' },
  sur_place: { step: 3, title: 'Chauffeur arrivé', subtitle: 'Il est sur place' },
  au_depot: { step: 3, title: 'Au dépôt', subtitle: 'Livraison au garage dès son ouverture' },
  livre: { step: 4, title: 'Livré au garage', subtitle: 'Votre garage prend le relais' },
  terminee: { step: 4, title: 'Intervention terminée', subtitle: 'Merci de votre confiance' },
  annulee: { step: 4, title: 'Demande annulée', subtitle: 'Votre demande est annulée' },
}

/** Met à jour (ou termine) la Live Activity du client, si l'app iPhone en a démarré une pour cette mission. */
export async function majActiviteClient(missionId: string, etape: keyof typeof ETAPES_LA): Promise<void> {
  try {
    const sb = createAdminClient()
    const { data: m } = await sb.from('incoming_missions').select('client_la_token').eq('id', missionId).maybeSingle()
    if (!m?.client_la_token) return
    const { sendLiveActivityApnsTo } = await import('@/lib/native/pushLiveActivity')
    const fin = etape === 'terminee' || etape === 'annulee' || etape === 'livre'
    const r = await sendLiveActivityApnsTo(APNS_TOPIC, m.client_la_token, {
      event: fin ? 'end' : 'update',
      'content-state': ETAPES_LA[etape],
      ...(fin ? { 'dismissal-date': Math.floor(Date.now() / 1000) + 30 * 60 } : { 'stale-date': Math.floor(Date.now() / 1000) + 4 * 3600 }),
    })
    if (fin || r.invalid_token) await sb.from('incoming_missions').update({ client_la_token: null }).eq('id', missionId)
  } catch (e: any) {
    console.warn('[VD Assistance] Live Activity KO', e?.message)
  }
}

export async function prevenirClient(missionId: string, etape: EtapeClient): Promise<void> {
  await majActiviteClient(missionId, etape)
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
