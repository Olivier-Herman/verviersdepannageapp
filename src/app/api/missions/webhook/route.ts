// src/app/api/missions/webhook/route.ts
// Point d'entrée du webhook Microsoft Graph Change Notifications
//
// Graph envoie un POST avec ?validationToken= pour valider l'endpoint
// Graph envoie ensuite des POST avec les notifications email réelles

import { NextResponse }        from 'next/server'
import { processEmailMessage } from '@/lib/missions/processor'

const WEBHOOK_SECRET = process.env.GRAPH_WEBHOOK_SECRET

// ── GET — fallback de validation (certaines versions de Graph utilisent GET) ──

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

// ── POST — validation initiale + notifications réelles ───────────────────────

export async function POST(req: Request) {
  // 1. Vérifier d'abord si c'est une requête de validation (priorité absolue)
  const { searchParams } = new URL(req.url)
  const validationToken  = searchParams.get('validationToken')

  if (validationToken) {
    // Graph valide notre endpoint — répondre immédiatement en plain text
    return new Response(validationToken, {
      status:  200,
      headers: { 'Content-Type': 'text/plain' }
    })
  }

  // 2. Notification réelle — parser le body
  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  // 3. Vérifier le clientState si défini
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
  console.log(`[Webhook] ${notifications.length} notification(s)`)

  // 4. Répondre 202 immédiatement (Graph exige < 10s)
  void processNotificationsBackground(notifications)

  return new Response(null, { status: 202 })
}

// ── Traitement en arrière-plan ────────────────────────────────────────────────

async function processNotificationsBackground(notifications: any[]): Promise<void> {
  for (const notification of notifications) {
    const messageId = notification.resourceData?.id as string | undefined

    if (!messageId) {
      console.warn('[Webhook] Notification sans messageId')
      continue
    }

    try {
      const result = await processEmailMessage(messageId)
      console.log(`[Webhook] ${result.status}`, result)
    } catch (err: any) {
      console.error(`[Webhook] Erreur message ${messageId}:`, err.message)
    }
  }
}
