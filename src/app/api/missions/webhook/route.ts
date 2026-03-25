// src/app/api/missions/webhook/route.ts
// Point d'entrée du webhook Microsoft Graph Change Notifications
//
// Flux :
// 1. Graph envoie d'abord une requête GET de validation (validationToken) → répondre en plain text
// 2. Graph envoie ensuite des POST avec les notifications email → traiter en arrière-plan
//
// IMPORTANT : Graph exige une réponse < 10 secondes.
// On répond 202 immédiatement et on traite le message en background (via waitUntil si dispo).

import { NextResponse }             from 'next/server'
import { processEmailMessage }      from '@/lib/missions/processor'

// Clé secrète définie lors de la création de la subscription Graph
// Doit correspondre à GRAPH_WEBHOOK_SECRET dans les variables Vercel
const WEBHOOK_SECRET = process.env.GRAPH_WEBHOOK_SECRET

// ── Validation initiale de la subscription (GET) ─────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const validationToken  = searchParams.get('validationToken')

  if (validationToken) {
    // Graph vérifie que notre endpoint est valide — répondre en plain text
    return new Response(decodeURIComponent(validationToken), {
      status:  200,
      headers: { 'Content-Type': 'text/plain' }
    })
  }

  return NextResponse.json({ error: 'Bad request' }, { status: 400 })
}

// ── Réception des notifications (POST) ───────────────────────────────────────

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Vérification du clientState (secret partagé avec Graph lors de la subscription)
  // Graph inclut clientState dans chaque notification si on l'a défini
  if (WEBHOOK_SECRET) {
    const notifications: any[] = body?.value || []
    const clientStates = notifications.map((n: any) => n.clientState).filter(Boolean)
    const allValid = clientStates.length === 0 ||
      clientStates.every((cs: string) => cs === WEBHOOK_SECRET)

    if (!allValid) {
      console.warn('[Webhook] clientState invalide — notification rejetée')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const notifications: any[] = body?.value || []
  console.log(`[Webhook] ${notifications.length} notification(s) reçue(s)`)

  // ── Répondre 202 immédiatement (exigence Graph < 10s) ────────────────────
  // Le traitement se fait en arrière-plan
  const response = NextResponse.json({ ok: true }, { status: 202 })

  // Traitement asynchrone — on ne peut pas await ici (contrainte Graph 10s)
  // On lance le traitement sans l'attendre
  void processNotificationsBackground(notifications)

  return response
}

// ── Traitement en arrière-plan ────────────────────────────────────────────────

async function processNotificationsBackground(notifications: any[]): Promise<void> {
  for (const notification of notifications) {
    // Une notification email Graph contient le resourceData.id du message
    const resourceData = notification.resourceData
    const messageId    = resourceData?.id as string | undefined

    if (!messageId) {
      // Certaines notifications ne contiennent pas directement l'ID
      // (ex: notification de type "deleted") — les ignorer
      console.warn('[Webhook] Notification sans messageId:', JSON.stringify(notification).slice(0, 200))
      continue
    }

    try {
      const result = await processEmailMessage(messageId)
      console.log(`[Webhook] processEmailMessage → ${result.status}`, result)
    } catch (err: any) {
      console.error(`[Webhook] Erreur traitement message ${messageId}:`, err.message)
    }
  }
}
