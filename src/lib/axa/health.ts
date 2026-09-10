// src/lib/axa/health.ts
//
// Santé du poll go&assist. Audit 10/09/2026 (Olivier) : le jeton était mort
// depuis le 11/08 et le cron échouait toutes les minutes SANS RIEN DIRE
// (console Vercel seulement) → 0 fiche via l'API en 10 semaines, 39 clôtures
// non poussées. Règle maison : un cron en échec doit s'afficher à l'écran.
//
// État persisté dans app_settings.axa_poll_health (TEXTE JSON, cf feedback).
// Alerte push aux superadmins après 3 échecs consécutifs, rappel toutes les
// 6 h, une notif de retour à la normale. Affiché sur /admin (carte rouge),
// /admin/axa (page dédiée) et pastille menu (/api/nav-badges).

import { createAdminClient } from '@/lib/supabase'
import { sendNotificationToRoles } from '@/lib/notifications/send'

export const AXA_HEALTH_KEY = 'axa_poll_health'
export const AXA_ALERT_AFTER = 3          // échecs consécutifs avant alerte
const REMIND_MS = 6 * 3600 * 1000

export interface AxaHealth {
  ok:                   boolean
  at:                   string
  last_ok_at:           string | null
  error:                string | null
  consecutive_failures: number
  notified_at:          string | null
  awaiting?:            number
}

export async function readAxaHealth(sb: any = createAdminClient()): Promise<AxaHealth | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', AXA_HEALTH_KEY).maybeSingle()
  if (!data?.value) return null
  try { return typeof data.value === 'string' ? JSON.parse(data.value) : data.value } catch { return null }
}

/** Libellé humain « déconnecté depuis … » pour les écrans. */
export function axaDownSince(h: AxaHealth | null): string | null {
  if (!h || h.ok) return null
  const ref = h.last_ok_at ? Date.parse(h.last_ok_at) : Date.parse(h.at)
  const hours = Math.max(0, Math.round((Date.now() - ref) / 3600e3))
  if (hours < 1) return 'à l’instant'
  if (hours < 48) return `depuis ${hours} h`
  return `depuis ${Math.round(hours / 24)} j`
}

export async function recordAxaPollResult(r: { ok: boolean; error?: string | null; awaiting?: number }): Promise<AxaHealth> {
  const sb = createAdminClient()
  const prev = await readAxaHealth(sb)
  const now = new Date().toISOString()
  const failures = r.ok ? 0 : (prev?.consecutive_failures || 0) + 1
  const next: AxaHealth = {
    ok:                   r.ok,
    at:                   now,
    last_ok_at:           r.ok ? now : (prev?.last_ok_at || null),
    error:                r.ok ? null : String(r.error || 'erreur inconnue').slice(0, 300),
    consecutive_failures: failures,
    notified_at:          prev?.notified_at || null,
    awaiting:             r.awaiting,
  }
  const remindDue = !next.notified_at || (Date.now() - Date.parse(next.notified_at)) > REMIND_MS
  if (!r.ok && failures >= AXA_ALERT_AFTER && remindDue) {
    await sendNotificationToRoles(['superadmin'], 'axa_poll_down', {
      title:      '🅰️ go&assist déconnecté',
      body:       `Le poll AXA échoue ${axaDownSince(next) || ''}. Réamorcer la connexion dans Admin › AXA go&assist.`.replace(/\s+/g, ' '),
      action_url: '/admin/axa',
    }).catch(() => {})
    next.notified_at = now
  }
  if (r.ok && (prev?.consecutive_failures || 0) >= AXA_ALERT_AFTER) {
    await sendNotificationToRoles(['superadmin'], 'axa_poll_up', {
      title: '🅰️ go&assist reconnecté', body: 'Le poll AXA fonctionne à nouveau.', action_url: '/admin/axa',
    }).catch(() => {})
    next.notified_at = null
  }
  await sb.from('app_settings').upsert({ key: AXA_HEALTH_KEY, value: JSON.stringify(next) }, { onConflict: 'key' })
  return next
}
