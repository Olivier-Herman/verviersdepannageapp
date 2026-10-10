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
        // resource = « /app/calls/<id> » ou « /app/calls/<id>/operations/<op> »
        const callId    = String(event?.resourceUrl || event?.resource || '').match(/calls\/([^/]+)/)?.[1]
        console.log(`[teams/callback] call=${callId} type=${eventType} state=${state} status=${event?.resourceData?.status}`)
        // Propositions de nuit (Olivier 30/09/2026) : décroché → message vocal ;
        // message terminé → on raccroche. Cf lib/missions/market-proposals.ts.
        if (!callId) continue
        // Espace client (Olivier 10/10/2026) : appel du dépannage pour une nouvelle demande EBAC / Centracar.
        try {
          const { onEspaceCallEvent } = await import('@/lib/espace/demande')
          const ev = eventType === '#microsoft.graph.call' && state === 'established' ? 'established'
            : eventType === '#microsoft.graph.playPromptOperation' && event?.resourceData?.status === 'completed' ? 'prompt_completed' : null
          if (ev && await onEspaceCallEvent(callId, ev)) continue
        } catch (e: any) {
          console.error('[teams/callback] espace client :', e?.message)
        }
        try {
          const { handleProposalCallEvent } = await import('@/lib/missions/market-proposals')
          if (eventType === '#microsoft.graph.call' && state === 'established') {
            await handleProposalCallEvent(callId, 'established')
          } else if (eventType === '#microsoft.graph.playPromptOperation' && event?.resourceData?.status === 'completed') {
            await handleProposalCallEvent(callId, 'prompt_completed')
          }
        } catch (e: any) {
          console.error('[teams/callback] proposition de nuit :', e?.message)
        }
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
