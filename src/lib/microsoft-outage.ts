// src/lib/microsoft-outage.ts
//
// Panne Microsoft (Olivier 13/11/2026). Le 13/11, panne mondiale d'Exchange Online :
// toutes nos boîtes répondaient 502 après 20 s, et chaque robot envoyait sa propre
// alerte (transfert des mails de police, go&assist…), sans dire que la cause était
// chez Microsoft. Désormais :
//   - une erreur Graph 502/503/504 (ou un délai dépassé) est reconnue comme une panne
//     Microsoft et non comme une panne du robot ;
//   - UNE alerte claire après 15 min, UN message au retour (table cron_alerts, clé
//     `microsoft-graph`, même mécanique que cron-alert.ts) ;
//   - pendant la panne, la reconnexion automatique AXA est suspendue : elle a besoin
//     du code envoyé par mail, et ses essais répétés font apparaître un captcha.
// La sonde est le transfert des mails de police (cron poll-requisitoires, toutes les 10 min).

import { createAdminClient } from '@/lib/supabase'
import { cronFailed, cronRecovered } from '@/lib/cron-alert'
import { sendNotificationToRoles } from '@/lib/notifications/send'

export const MICROSOFT_OUTAGE_KEY = 'microsoft-graph'
const ALERT_AFTER_MS = 15 * 60_000

/** L'erreur vient-elle de Microsoft (serveur indisponible ou délai dépassé) ? */
export function isMicrosoftOutageError(err: unknown): boolean {
  const s = String((err as any)?.message ?? err ?? '')
  if (/\b(502|503|504)\b/.test(s) && /graph|UnknownError|ServiceUnavailable|GatewayTimeout/i.test(s)) return true
  return /graph/i.test(s) && /timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(s)
}

const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })

async function notify(title: string, body: string) {
  await sendNotificationToRoles(['superadmin'], 'cron_alert', { title, body, action_url: '/admin', data: { cron_error: 'true' } }).catch(() => {})
}

/** À appeler quand un appel aux boîtes mail échoue pour une raison Microsoft. */
export async function noteMicrosoftDown(err: unknown): Promise<void> {
  await cronFailed(MICROSOFT_OUTAGE_KEY, String((err as any)?.message ?? err), ALERT_AFTER_MS, async since => notify(
    '🟦 Panne Microsoft en cours',
    `Les boîtes mail ne répondent plus depuis ${heure(since)} (panne chez Microsoft, pas chez nous). Rien n’est perdu : les mails arriveront et seront traités dès le retour du service. En attendant, missions AXA à surveiller sur go&assist.`,
  ))
}

/** À appeler quand un appel aux boîtes mail réussit. */
export async function noteMicrosoftUp(): Promise<void> {
  await cronRecovered(MICROSOFT_OUTAGE_KEY, async since => notify(
    '✅ Microsoft rétabli',
    `Les boîtes mail répondent à nouveau (panne depuis ${heure(since)}). Les mails arrivés entre-temps sont traités automatiquement.`,
  ))
}

/** Une panne Microsoft est-elle en cours ? (null si inconnu) */
export async function microsoftOutageSince(): Promise<string | null> {
  try {
    const { data } = await createAdminClient().from('cron_alerts').select('failing_since').eq('key', MICROSOFT_OUTAGE_KEY).maybeSingle()
    return data?.failing_since || null
  } catch { return null }
}
