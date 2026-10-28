// src/lib/calendar/device.ts — accès délégué aux agendas Outlook par code d'appareil (Olivier 28/10/2026).
//
// L'application VD Soft n'a pas le droit Calendars (application). À la place, la personne se connecte une fois par
// boîte (info@, mobi@) sur microsoft.com/devicelogin et accepte « lire et modifier les agendas » : VD Soft garde un
// jeton délégué limité à l'agenda de CETTE boîte, chiffré, et le renouvelle seul. Client public Microsoft
// « Microsoft Graph Command Line Tools » : rien à changer dans l'enregistrement de l'application.
// Jeton perdu (mot de passe changé, révocation, 90 j sans usage) → alerte Telegram, refaire un code.

import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase'

const CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e'   // Microsoft Graph Command Line Tools (client public)
const SCOPE = 'offline_access https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite.Shared'
const AUTHORITY = 'https://login.microsoftonline.com/organizations/oauth2/v2.0'

function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('Secret de l’application absent : jeton d’agenda impossible à chiffrer')
  return crypto.createHash('sha256').update(`${secret}|calendar-accounts`).digest()
}
export function chiffrer(txt: string): string {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(txt, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.')
}
export function dechiffrer(s: string): string {
  const [iv, tag, enc] = s.split('.').map(x => Buffer.from(x, 'base64'))
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
}

/** Étape 1 : demande un code d'appareil. */
export async function demarrerCode(): Promise<{ user_code: string; device_code: string; verification_uri: string; expires_in: number; interval: number; message: string }> {
  const r = await fetch(`${AUTHORITY}/devicecode`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }), cache: 'no-store' })
  const j = await r.json()
  if (!r.ok) throw new Error(`Code d’appareil refusé : ${j.error_description || j.error || r.status}`)
  return j
}

/** Étape 2 : attend la connexion, vérifie que c'est bien la boîte attendue, garde le jeton chiffré. */
export async function attendreConnexion(mailbox: string, deviceCode: string, interval = 5, expiresIn = 900): Promise<{ ok: boolean; compte?: string; error?: string }> {
  const fin = Date.now() + expiresIn * 1000
  while (Date.now() < fin) {
    await new Promise(res => setTimeout(res, interval * 1000))
    const r = await fetch(`${AUTHORITY}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: CLIENT_ID, device_code: deviceCode }), cache: 'no-store' })
    const j = await r.json()
    if (j.error === 'authorization_pending') continue
    if (j.error === 'slow_down') { interval += 5; continue }
    if (!r.ok) return { ok: false, error: j.error_description || j.error }
    const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: `Bearer ${j.access_token}` } }).then(x => x.json()).catch(() => ({}))
    const compte = String(me.mail || me.userPrincipalName || '').toLowerCase()
    // La boîte peut être une boîte de la société à laquelle le compte connecté a accès (info@ ouverte par
    // olivier@hoos.cloud, 28/10/2026) : on vérifie que son agenda est bien accessible avec ce jeton.
    if (compte !== mailbox.toLowerCase()) {
      const t = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/calendar?$select=id,name,canEdit`, { headers: { Authorization: `Bearer ${j.access_token}` }, cache: 'no-store' })
      const tj = await t.json().catch(() => ({}))
      if (!t.ok || tj.canEdit === false) return { ok: false, compte, error: `Connecté avec ${compte || '?'}, qui n’a pas le droit de modifier l’agenda de ${mailbox} (${tj?.error?.message || (tj.canEdit === false ? 'lecture seule' : t.status)})` }
    }
    await createAdminClient().from('calendar_accounts').upsert({ mailbox: mailbox.toLowerCase(), refresh_token: chiffrer(j.refresh_token), scope: j.scope, connected_at: new Date().toISOString(), refreshed_at: new Date().toISOString(), last_error: null, last_error_at: null })
    return { ok: true, compte: compte === mailbox.toLowerCase() ? compte : `${compte} (accès à ${mailbox})` }
  }
  return { ok: false, error: 'Code expiré sans connexion' }
}

/** Jeton d'accès pour l'agenda de la boîte (renouvelle et garde le nouveau jeton). null = boîte non connectée. */
export async function jetonAgenda(mailbox: string): Promise<string | null> {
  const sb = createAdminClient()
  const { data } = await sb.from('calendar_accounts').select('refresh_token').eq('mailbox', mailbox.toLowerCase()).maybeSingle()
  if (!data?.refresh_token) return null
  const r = await fetch(`${AUTHORITY}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: dechiffrer(data.refresh_token), scope: SCOPE }), cache: 'no-store' })
  const j = await r.json()
  if (!r.ok) {
    await sb.from('calendar_accounts').update({ last_error: String(j.error_description || j.error || r.status).slice(0, 500), last_error_at: new Date().toISOString() }).eq('mailbox', mailbox.toLowerCase())
    throw new Error(`Accès à l’agenda de ${mailbox} perdu : refaire la connexion par code`)
  }
  await sb.from('calendar_accounts').update({ refresh_token: chiffrer(j.refresh_token || dechiffrer(data.refresh_token)), refreshed_at: new Date().toISOString(), last_error: null }).eq('mailbox', mailbox.toLowerCase())
  return j.access_token
}
