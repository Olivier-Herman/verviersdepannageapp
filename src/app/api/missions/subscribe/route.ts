// src/app/api/missions/subscribe/route.ts
// Crée ou renouvelle la subscription Microsoft Graph sur la boîte assistance@verviersdepannage.be

import { NextResponse }      from 'next/server'
import { getGraphToken }     from '@/lib/missions/processor'
import { createAdminClient } from '@/lib/supabase'

const MISSIONS_EMAIL   = process.env.MISSIONS_EMAIL!
const APP_URL          = process.env.NEXT_PUBLIC_APP_URL!
const WEBHOOK_SECRET   = process.env.GRAPH_WEBHOOK_SECRET!
const WEBHOOK_ENDPOINT = `${APP_URL}/api/missions/webhook`

// Graph autorise max 4230 minutes (~3 jours) pour les messages mail
// On prend 2 jours pour renouveler avec marge
const EXPIRY_MINUTES = 2 * 24 * 60

function getExpiryDateTime(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() + EXPIRY_MINUTES)
  return d.toISOString()
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const token    = await getGraphToken()
    const supabase = createAdminClient()

    // Récupérer l'ID de subscription stocké en base
    const { data: setting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'graph_subscription_id')
      .maybeSingle()

    const existingSubId = setting?.value?.id as string | undefined

    let subscriptionId: string
    let action: 'created' | 'renewed'

    if (existingSubId) {
      // Tenter de renouveler la subscription existante
      const renewRes = await fetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${existingSubId}`,
        {
          method:  'PATCH',
          headers: {
            Authorization:  `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ expirationDateTime: getExpiryDateTime() })
        }
      )

      if (renewRes.ok) {
        const renewed  = await renewRes.json()
        subscriptionId = renewed.id
        action         = 'renewed'
        console.log(`[Subscribe] Renouvelée: ${subscriptionId}`)
      } else {
        // Subscription expirée côté Graph — recréer
        console.warn('[Subscribe] Renouvellement échoué, recréation...')
        subscriptionId = await createSubscription(token)
        action         = 'created'
      }
    } else {
      subscriptionId = await createSubscription(token)
      action         = 'created'
    }

    // Stocker l'ID en base pour le prochain renouvellement
    await supabase
      .from('app_settings')
      .upsert(
        {
          key:   'graph_subscription_id',
          value: { id: subscriptionId, updated_at: new Date().toISOString() }
        },
        { onConflict: 'key' }
      )

    return NextResponse.json({ ok: true, action, subscriptionId })

  } catch (err: any) {
    console.error('[Subscribe] Erreur:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function createSubscription(token: string): Promise<string> {
  const body = {
    changeType:         'created',
    notificationUrl:    WEBHOOK_ENDPOINT,
    resource:           `users/${MISSIONS_EMAIL}/mailFolders/inbox/messages`,
    expirationDateTime: getExpiryDateTime(),
    clientState:        WEBHOOK_SECRET,
  }

  const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Création subscription échouée (${res.status}): ${err.slice(0, 300)}`)
  }

  const sub = await res.json()
  console.log(`[Subscribe] Créée: ${sub.id} jusqu'au ${sub.expirationDateTime}`)
  return sub.id
}
