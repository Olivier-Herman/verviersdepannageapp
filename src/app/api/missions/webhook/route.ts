// src/app/api/missions/webhook/route.ts
// Point d'entrée du webhook Microsoft Graph Change Notifications
//
// waitUntil(@vercel/functions) est indispensable sur Vercel :
// sans lui, la fonction est tuée dès que la réponse est envoyée,
// avant que le traitement en arrière-plan ne se termine.

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
  for (const notification of notifications) {
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
