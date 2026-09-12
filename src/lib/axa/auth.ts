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
  // Rafraîchissement PROACTIF (12/09/2026) : le jeton est mort pile 24 h après
  // l'amorçage, au premier échange. L'access token vit 24 h, donc on n'avait
  // jamais touché au refresh token entre-temps — et Auth0 l'expire s'il reste
  // inactif. Le portail web le fait tourner en permanence, nous pas. Désormais
  // on l'échange toutes les REFRESH_EVERY_MS même si l'access token est valide.
  const rotatedAt = state.updated_at ? Date.parse(state.updated_at) : 0
  const stale = !rotatedAt || Date.now() - rotatedAt > REFRESH_EVERY_MS
  if (state.access_token && state.expires_at && state.expires_at - Date.now() > 60_000 && !stale) {
    return state.access_token
  }

  // Un seul échange à la fois (cron chaque minute + scripts) : deux échanges
  // du même refresh token = réutilisation détectée par Auth0 = famille révoquée.
  const locked = await acquireRefreshLock(sb, ctx)
  if (!locked) {
    // Quelqu'un rafraîchit : on rend l'access token courant s'il est encore bon.
    if (state.access_token && state.expires_at && state.expires_at - Date.now() > 60_000) return state.access_token
    await new Promise(r => setTimeout(r, 2500))
    const again = await readState(sb, ctx)
    if (again?.access_token && again.expires_at && again.expires_at - Date.now() > 60_000) return again.access_token
    throw new Error('AXA : rafraîchissement du jeton en cours ailleurs — réessayer')
  }
  try {
    // Relire : un autre appel a pu rafraîchir entre la lecture et le verrou.
    const fresh = await readState(sb, ctx)
    if (fresh?.refresh_token && fresh.refresh_token !== state.refresh_token && fresh.access_token && fresh.expires_at && fresh.expires_at - Date.now() > 60_000) {
      return fresh.access_token
    }
    return await exchangeRefreshToken(sb, ctx, clientId, fresh?.refresh_token || state.refresh_token)
  } finally {
    await releaseRefreshLock(sb, ctx)
  }
}

const REFRESH_EVERY_MS = 6 * 3600 * 1000
const LOCK_TTL_MS = 30_000
const lockKey = (ctx: AxaContext) => `axa_auth_lock_${ctx}`

/** Verrou court en base (compare-and-set sur app_settings). */
async function acquireRefreshLock(sb: any, ctx: AxaContext): Promise<boolean> {
  const now = Date.now()
  const { data: cur } = await sb.from('app_settings').select('value').eq('key', lockKey(ctx)).maybeSingle()
  let until = 0
  try { until = Number(JSON.parse(cur?.value || '0')) || 0 } catch { until = 0 }
  if (until > now) return false
  if (!cur) {
    const { error } = await sb.from('app_settings').insert({ key: lockKey(ctx), value: JSON.stringify(now + LOCK_TTL_MS) })
    return !error
  }
  const { data: upd } = await sb.from('app_settings')
    .update({ value: JSON.stringify(now + LOCK_TTL_MS) })
    .eq('key', lockKey(ctx)).eq('value', cur.value)
    .select('key')
  return !!(upd && upd.length)
}
async function releaseRefreshLock(sb: any, ctx: AxaContext): Promise<void> {
  await sb.from('app_settings').update({ value: JSON.stringify(0) }).eq('key', lockKey(ctx)).then(() => {}, () => {})
}

async function exchangeRefreshToken(sb: any, ctx: AxaContext, clientId: string, refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`AXA refresh KO (${ctx}, ${res.status}) — re-login requis. ${txt.slice(0, 160)}`)
  }
  const j = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number }
  await writeState(sb, ctx, {
    refresh_token: j.refresh_token || refreshToken,
    access_token:  j.access_token,
    expires_at:    Date.now() + (Number(j.expires_in || 3600) * 1000),
  })
  return j.access_token
}
