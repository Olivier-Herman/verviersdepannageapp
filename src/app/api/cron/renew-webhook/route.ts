// src/app/api/cron/renew-webhook/route.ts
// Renouvelle quotidiennement la subscription Graph (expire tous les 3 jours max)
// Appelle simplement /api/missions/subscribe en interne

import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const secret = process.env.CRON_SECRET!

  try {
    const res = await fetch(
      `${appUrl}/api/missions/subscribe?secret=${encodeURIComponent(secret)}`,
      { method: 'GET' }
    )
    const data = await res.json()

    if (!res.ok) {
      console.error('[CronRenewWebhook] Erreur renouvellement:', data)
      return NextResponse.json({ error: data.error }, { status: 500 })
    }

    console.log('[CronRenewWebhook] Résultat:', data)
    return NextResponse.json(data)

  } catch (err: any) {
    console.error('[CronRenewWebhook] Exception:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
