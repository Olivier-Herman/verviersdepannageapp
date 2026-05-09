// src/app/api/missions/webhook/route.ts
// Point d'entrée du webhook Microsoft Graph Change Notifications
//
// waitUntil(@vercel/functions) est indispensable sur Vercel :
// sans lui, la fonction est tuée dès que la réponse est envoyée,
// avant que le traitement en arrière-plan ne se termine.
//
// maxDuration explicite — sinon default 10s sur Hobby tue le waitUntil avant
// que processEmailMessage finisse (parsing IA + IMA + Allianz peut prendre 30-60s).
// 10 placeholders orphelins observés en prod début mai = SIGTERM répété.

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { waitUntil }           from '@vercel/functions'
import { processEmailMessage } from '@/lib/missions/processor'

const WEBHOOK_SECRET = process.env.GRAPH_WEBHOOK_SECRET

// ── GET — validation initiale (certaines versions Graph utilisent GET) ────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const validationToken  = searchParams.get('validationToken')

  if (validationToken) {
    return new Response(validationToken, {
      status:  200,
      headers: { 'Content-Type': 'text/plain' }
    })
  }

  return new Response('OK', { status: 200 })
}

// ── POST — validation + notifications réelles ─────────────────────────────────

export async function POST(req: Request) {
  // 1. Validation initiale de la subscription (priorité absolue)
  const { searchParams } = new URL(req.url)
  const validationToken  = searchParams.get('validationToken')

  if (validationToken) {
    return new Response(validationToken, {
      status:  200,
      headers: { 'Content-Type': 'text/plain' }
    })
  }

  // 2. Parser le body
  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  // 3. Vérifier le clientState
  if (WEBHOOK_SECRET) {
    const notifications: any[] = body?.value || []
    const clientStates = notifications.map((n: any) => n.clientState).filter(Boolean)
    const allValid = clientStates.length === 0 ||
      clientStates.every((cs: string) => cs === WEBHOOK_SECRET)

    if (!allValid) {
      console.warn('[Webhook] clientState invalide')
      return new Response('Forbidden', { status: 403 })
    }
  }

  const notifications: any[] = body?.value || []
  console.log(`[Webhook] ${notifications.length} notification(s) reçue(s)`)

  // 4. Répondre 202 immédiatement (Graph exige < 10s)
  //    waitUntil garantit que Vercel garde la fonction en vie
  //    jusqu'à la fin du traitement, même après l'envoi de la réponse
  waitUntil(processNotificationsBackground(notifications))

  return new Response(null, { status: 202 })
}

// ── Traitement en arrière-plan ─────────────────────────────────────────────────

async function processNotificationsBackground(notifications: any[]): Promise<void> {
  // ─── Lifecycle events (subscription removed/expiring/missed) ─────────────
  // Microsoft Graph envoie ces events sur lifecycleNotificationUrl (= même
  // endpoint que notificationUrl chez nous). Distincts des notifs de message
  // par la présence du champ `lifecycleEvent`.
  const lifecycleEvents = notifications.filter(n => n.lifecycleEvent)
  if (lifecycleEvents.length > 0) {
    await handleLifecycleEvents(lifecycleEvents)
  }

  // Filtrer pour ne garder que les vraies notifications de message
  const messageNotifs = notifications.filter(n => !n.lifecycleEvent)

  // Dédupliquer les messageIds — Graph peut envoyer plusieurs notifs pour le même message
  const seen    = new Set<string>()
  const unique  = messageNotifs.filter(n => {
    const id = n.resourceData?.id as string | undefined
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })

  if (unique.length < messageNotifs.length) {
    console.log(`[Webhook] Déduplication: ${messageNotifs.length} → ${unique.length} notification(s)`)
  }

  for (const notification of unique) {
    const messageId = notification.resourceData?.id as string | undefined

    if (!messageId) {
      console.warn('[Webhook] Notification sans messageId:', JSON.stringify(notification).slice(0, 200))
      continue
    }

    try {
      const result = await processEmailMessage(messageId)
      console.log(`[Webhook] Résultat: ${result.status}`, result)
    } catch (err: any) {
      console.error(`[Webhook] Erreur message ${messageId}:`, err.message)
    }
  }
}

// ── Lifecycle events handler ─────────────────────────────────────────────────
//
// Types d'events reçus :
//   - subscriptionRemoved : MS a désactivé la sub (suite à timeouts répétés
//     du webhook ou autre raison). Auto-recréer.
//   - reauthorizationRequired : sub bientôt expirée, à renouveler. Auto-renouveler.
//   - missed : MS a perdu des notifications (rare). Logger pour analyse.
//
// Pas de persistance en DB : la table mission_logs a une contrainte
// NOT NULL sur mission_id, et un event lifecycle ne se rattache à aucune
// mission individuelle. Traçabilité via Vercel logs (console.warn structuré).
// TODO : si besoin d'un trail persistant, créer une table webhook_events
// dédiée (id, event_type, subscription_id, payload jsonb, created_at).

async function handleLifecycleEvents(events: any[]): Promise<void> {
  let needsRecreate = false

  for (const evt of events) {
    const eventType = evt.lifecycleEvent as string
    const subId     = evt.subscriptionId as string | undefined

    console.warn('[Webhook] Lifecycle event received',
      JSON.stringify({
        event:          eventType,
        subscriptionId: subId,
        clientState:    evt.clientState ? '<present>' : '<missing>',
        timestamp:      new Date().toISOString(),
      })
    )

    if (eventType === 'subscriptionRemoved' || eventType === 'reauthorizationRequired') {
      needsRecreate = true
    } else if (eventType === 'missed') {
      console.warn('[Webhook] Notifications perdues côté Graph — vérifier inbox manuellement')
    }
  }

  // Auto-recréer la sub si nécessaire (best-effort, même URL que le cron renew)
  if (needsRecreate) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    const secret = process.env.CRON_SECRET
    if (!appUrl || !secret) {
      console.error('[Webhook] NEXT_PUBLIC_APP_URL ou CRON_SECRET manquant — impossible de recréer la sub')
      return
    }
    try {
      const res = await fetch(
        `${appUrl}/api/missions/subscribe?secret=${encodeURIComponent(secret)}`,
        { method: 'GET' }
      )
      const data = await res.json()
      console.log(`[Webhook] Auto-recréation sub:`, data)
    } catch (err: any) {
      console.error('[Webhook] Erreur auto-recréation sub:', err.message)
    }
  }
}
