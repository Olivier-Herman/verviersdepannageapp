// src/app/api/teams/callback/route.ts
//
// Endpoint pour recevoir les events Microsoft Graph Communications API
// (callConnected, callDisconnected, callEstablished, etc.).
//
// Microsoft envoie un POST avec un payload signé. Pour démarrer on log
// juste les events sans valider la signature (validation JWT à ajouter
// plus tard avec la clé publique Microsoft).
//
// Le bot doit accepter le callback en moins de 5 secondes sinon Microsoft
// considère l'appel comme échoué.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    console.log('[teams/callback] event received:', JSON.stringify(body).slice(0, 500))

    // Microsoft envoie des events avec un format `value: [{...}]` pour
    // les changes notifications. On log puis on renvoie 200 OK.
    if (Array.isArray(body?.value)) {
      for (const event of body.value) {
        const eventType = event?.resourceData?.['@odata.type']
        const state     = event?.resourceData?.state
        const callId    = event?.resource?.split('/').pop()
        console.log(`[teams/callback] call=${callId} type=${eventType} state=${state}`)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[teams/callback] error:', e.message)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

// Microsoft fait aussi des GET pour valider l'endpoint (validationToken).
// On renvoie le token tel quel pour confirmer.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const validationToken = url.searchParams.get('validationToken')
  if (validationToken) {
    return new Response(validationToken, {
      status:  200,
      headers: { 'content-type': 'text/plain' },
    })
  }
  return NextResponse.json({ ok: true, message: 'Teams callback endpoint' })
}
