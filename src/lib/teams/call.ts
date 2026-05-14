// src/lib/teams/call.ts
//
// Helper pour declencher un appel sortant Teams Phone (PSTN) via Microsoft
// Graph Communications API.
//
// Flow OAuth2 client_credentials → access_token (cache 50min)
// → POST /communications/calls avec :
//   source = identité Teams du bot user (avec son numero)
//   target = numero PSTN du destinataire (chauffeur ou +3287600615 escalade)
//
// Le callback Graph est obligatoire pour recevoir les events (callConnected,
// callDisconnected). On le pointe vers /api/teams/callback de notre app.
//
// Variables d'env Vercel (Production) :
//   AZURE_AD_TENANT_ID   Azure AD tenant (deja en place pour NextAuth)
//   TEAMS_CLIENT_ID      App Registration Graph (peut etre une App separee
//                        de celle de NextAuth, avec permissions Calls.*)
//   TEAMS_CLIENT_SECRET  secret de l'App Reg Teams
//   TEAMS_APP_SP_ID      Object ID du Service Principal de l'App Reg dans le
//                        tenant (visible dans Azure → Enterprise applications →
//                        ton App → Properties → Object ID). C'est CE id qui doit
//                        figurer dans source.identity.applicationInstance.id,
//                        PAS l'Object ID du user M365.
//   TEAMS_BOT_OBJECT_ID  Object ID du bot user M365 (utilise pour la table /
//                        traceability — pas dans le payload Graph)
//   TEAMS_BOT_PHONE      numero E.164 du bot (ex +3287600833, pour info)
//
// Note: on peut aussi reutiliser AZURE_AD_CLIENT_ID / SECRET si l'App Reg
// NextAuth contient les permissions Graph Calls (sinon il vaut mieux une
// App Reg dediee pour isoler le scope).

let cachedToken:        string | null = null
let cachedTokenExpiry:  number        = 0

async function getGraphAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedTokenExpiry > now + 60) return cachedToken

  // Tenant : reutilise AZURE_AD_TENANT_ID (deja en place pour NextAuth)
  // pour eviter de dupliquer. Si TEAMS_TENANT_ID est defini, il a priorite.
  const tenant   = process.env.TEAMS_TENANT_ID   || process.env.AZURE_AD_TENANT_ID
  const clientId = process.env.TEAMS_CLIENT_ID   || process.env.AZURE_AD_CLIENT_ID
  const secret   = process.env.TEAMS_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET
  if (!tenant || !clientId || !secret) {
    throw new Error('Teams non configure (tenant / client_id / secret manquant — voir AZURE_AD_* ou TEAMS_*)')
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: secret,
      scope:         'https://graph.microsoft.com/.default',
      grant_type:    'client_credentials',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Teams token exchange failed: ${res.status} ${text.slice(0, 200)}`)
  }
  const data = await res.json() as { access_token: string; expires_in: number }

  cachedToken       = data.access_token
  cachedTokenExpiry = now + Math.min(data.expires_in - 60, 50 * 60)
  return data.access_token
}

export interface InitiateCallParams {
  /** Numero PSTN du destinataire au format E.164 (+32...) */
  toPhone:       string
  /** Display name (optionnel, affiche dans Teams) */
  toDisplayName?: string
}

export interface InitiateCallResult {
  ok:       boolean
  callId?:  string
  status?:  number
  error?:   string
}

/**
 * Initie un appel sortant Teams Phone vers un numero PSTN.
 *
 * NB: necessite que l'App Reg Azure ait les permissions Graph :
 *   - Calls.Initiate.All
 *   - Calls.InitiateGroupCall.All
 * + admin consent du tenant
 * + une Teams Cloud Communications policy qui autorise les appels PSTN au bot.
 */
export async function initiatePstnCall(params: InitiateCallParams): Promise<InitiateCallResult> {
  // Source identity pour Microsoft Graph Communications PSTN bot calls :
  // Object ID du bot user M365 (qui a la licence Teams Phone et le numero).
  // L'AppId et le SP Object ID donnent "Call source identity invalid".
  // Maintenant que l'Azure Bot resource est creee + CsApplicationAccessPolicy
  // est granted Global, l'identite user devrait etre reconnue.
  const botObjectId = process.env.TEAMS_BOT_OBJECT_ID
  const botPhone    = process.env.TEAMS_BOT_PHONE
  const appBase     = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'

  if (!botObjectId) {
    return { ok: false, error: 'TEAMS_BOT_OBJECT_ID manquant (Object ID du bot user M365 avec licence Teams Phone)' }
  }
  if (!botPhone) {
    return { ok: false, error: 'TEAMS_BOT_PHONE manquant (numero E.164 du bot)' }
  }
  if (!params.toPhone || !params.toPhone.startsWith('+')) {
    return { ok: false, error: `Numero invalide (E.164 attendu): ${params.toPhone}` }
  }

  let token: string
  try { token = await getGraphAccessToken() }
  catch (e: any) { return { ok: false, error: `Token error: ${e.message}` } }

  const body = {
    '@odata.type': '#microsoft.graph.call',
    callbackUri:    `${appBase}/api/teams/callback`,
    requestedModalities: ['audio'],
    direction: 'outgoing',
    source: {
      '@odata.type': '#microsoft.graph.participantInfo',
      identity: {
        '@odata.type': '#microsoft.graph.identitySet',
        applicationInstance: {
          '@odata.type': '#microsoft.graph.identity',
          id: botObjectId,
          displayName: 'Verviers Dispatch',
        },
      },
      countryCode: null,
      endpointType: null,
      region: null,
      languageId: null,
    },
    targets: [{
      '@odata.type': '#microsoft.graph.invitationParticipantInfo',
      identity: {
        '@odata.type': '#microsoft.graph.identitySet',
        phone: {
          '@odata.type': '#microsoft.graph.identity',
          id: params.toPhone,
          displayName: params.toDisplayName || params.toPhone,
        },
      },
    }],
    tenantId: process.env.TEAMS_TENANT_ID || process.env.AZURE_AD_TENANT_ID,
    mediaConfig: {
      '@odata.type': '#microsoft.graph.serviceHostedMediaConfig',
    },
  }

  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/communications/calls', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type':  'application/json',
      },
      body: JSON.stringify(body),
    })

    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* non-JSON */ }

    if (!res.ok) {
      console.error('[teams/call] Graph error:', res.status, text.slice(0, 400))
      return {
        ok: false,
        status: res.status,
        error: json?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`,
      }
    }

    return { ok: true, callId: json?.id, status: res.status }
  } catch (e: any) {
    console.error('[teams/call] fetch error:', e.message)
    return { ok: false, error: e.message || 'fetch failed' }
  }
}
