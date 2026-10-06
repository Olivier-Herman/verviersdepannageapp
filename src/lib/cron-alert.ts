// src/lib/cron-alert.ts
//
// Panne d'une tâche planifiée : prévenir UNE fois, et seulement si elle dure
// (Olivier 06/10/2026, cinq alertes pour 15 s de coupure Supabase le 05/10).
//   - échec : la panne est notée (début) ; l'alerte part quand elle dure depuis
//     `afterMs`, réservée par une mise à jour atomique (alerted_at nul → posé) :
//     un seul passage gagne, et si la base ne répond pas, rien ne part ;
//   - succès : la panne est effacée ; si une alerte était partie, UN message « rétabli ».

import { createAdminClient } from '@/lib/supabase'

export async function cronFailed(key: string, error: string, afterMs: number, alert: (since: string) => Promise<void>): Promise<void> {
  try {
    const sb = createAdminClient()
    await sb.from('cron_alerts').upsert({ key, last_error: error.slice(0, 300) }, { onConflict: 'key', ignoreDuplicates: false })
    const { data: row } = await sb.from('cron_alerts').select('failing_since, alerted_at').eq('key', key).maybeSingle()
    if (!row || row.alerted_at || Date.now() - new Date(row.failing_since).getTime() < afterMs) return
    const { data: won } = await sb.from('cron_alerts').update({ alerted_at: new Date().toISOString() }).eq('key', key).is('alerted_at', null).select('key')
    if (won?.length) await alert(row.failing_since)
  } catch { /* base injoignable : on ne prévient pas, on réessaiera au passage suivant */ }
}

export async function cronRecovered(key: string, recovered: (since: string) => Promise<void>): Promise<void> {
  try {
    const sb = createAdminClient()
    const { data } = await sb.from('cron_alerts').delete().eq('key', key).select('failing_since, alerted_at')
    if (data?.[0]?.alerted_at) await recovered(data[0].failing_since)
  } catch { /* sans gravité */ }
}
