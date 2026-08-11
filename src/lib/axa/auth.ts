// src/lib/axa/auth.ts
//
// Authentification AXA go&assist (Auth0). Olivier 2026-06-30.
//
// DEUX contextes, deux comptes à NOUS :
//   - 'web'    : compte dispatcher → sert à ASSIGNER la mission à un technicien
//                (le web ne permet PAS de clôturer).
//   - 'mobile' : « accès technicien » (app mobile) → sert à CLÔTURER la mission
//                (c'est nous qui simulons la clôture côté technicien).
//
// L'app go&assist utilise Auth0 avec le scope `offline_access` → un refresh_token
// est émis. On NE rejoue PAS le login interactif (passkey/MFA) : on stocke le
// refresh_token et on échange refresh_token → access_token côté serveur.
//
// ⚠️ Rotation : Auth0 renvoie un NOUVEAU refresh_token à chaque échange → on le
// persiste à chaque fois (sinon le suivant est invalide). Stockage en base
// (app_settings.key='axa_auth_<context>'), service-role only.
//
// Amorçage one-shot : un superadmin pose le 1er refresh_token de chaque contexte
// via setAxaRefreshToken(context, token) depuis une capture de session.
//
// TODO mobile : confirmer (via capture de l'app) que l'auth mobile est bien ce
// même tenant Auth0 et récupérer le client_id mobile (souvent un client_id
// distinct pour l'app native). Renseigner CLIENT_IDS.mobile.
//
// Cf [[project_axa_goassist_integration]]. Modèles : Kaze / Allianz (Hexalite).

import { createAdminClient } from '@/lib/supabase'

export type AxaContext = 'web' | 'mobile'

const AUTH0_DOMAIN = 'axa-partners-eu-providers.eu.auth0.com'
const TOKEN_URL    = `https://${AUTH0_DOMAIN}/oauth/token`

// client_id par contexte (publics, non secrets). web = SPA go&assist (confirmé).
// mobile = à confirmer depuis la capture de l'app.
const CLIENT_IDS: Record<AxaContext, string> = {
  web:    'KwLK0b4mbazAv8fG5v3XaFhtyFs1fC4y',
  mobile: '',   // TODO : client_id de l'app mobile (capture)
}

interface AxaAuthState {
  refresh_token: string
  access_token?: string
  expires_at?:   number
  updated_at?:   string
}

const settingKey = (ctx: AxaContext) => `axa_auth_${ctx}`

async function readState(sb: any, ctx: AxaContext): Promise<AxaAuthState | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', settingKey(ctx)).maybeSingle()
  if (!data?.value) return null
  // app_settings.value = TEXTE → JSON.parse à la lecture (cf feedback). Tolère
  // aussi une valeur déjà objet (colonne jsonb sur un autre environnement).
  try {
    return (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) as AxaAuthState
  } catch { return null }
}
async function writeState(sb: any, ctx: AxaContext, state: AxaAuthState): Promise<void> {
  await sb.from('app_settings').upsert(
    { key: settingKey(ctx), value: JSON.stringify({ ...state, updated_at: new Date().toISOString() }) },
    { onConflict: 'key' },
  )
}

/** Amorçage / réamorçage manuel du refresh token d'un contexte. */
export async function setAxaRefreshToken(ctx: AxaContext, refreshToken: string): Promise<void> {
  const sb = createAdminClient()
  await writeState(sb, ctx, { refresh_token: refreshToken.trim() })
}

/**
 * access_token AXA valide pour un contexte. Réutilise tant que non expiré,
 * sinon échange le refresh_token et persiste le nouveau (rotation).
 */
export async function getAxaAccessToken(ctx: AxaContext = 'web'): Promise<string> {
  const sb = createAdminClient()
  const clientId = CLIENT_IDS[ctx]
  if (!clientId) throw new Error(`AXA : client_id manquant pour le contexte '${ctx}' (à renseigner depuis la capture).`)

  const state = await readState(sb, ctx)
  if (!state?.refresh_token) {
    throw new Error(`AXA : aucun refresh_token amorcé pour '${ctx}'. Capture une session et appelle setAxaRefreshToken('${ctx}', …).`)
  }
  if (state.access_token && state.expires_at && state.expires_at - Date.now() > 60_000) {
    return state.access_token
  }

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ grant_type: 'refresh_token', client_id: clientId, refresh_token: state.refresh_token }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`AXA refresh KO (${ctx}, ${res.status}) — re-login requis. ${txt.slice(0, 160)}`)
  }
  const j = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number }
  await writeState(sb, ctx, {
    refresh_token: j.refresh_token || state.refresh_token,
    access_token:  j.access_token,
    expires_at:    Date.now() + (Number(j.expires_in || 3600) * 1000),
  })
  return j.access_token
}
