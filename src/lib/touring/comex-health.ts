// src/lib/touring/comex-health.ts
//
// Surveillance du login COMEX. On compte les échecs de login CONSÉCUTIFS ;
// au 10e d'affilée, on alerte les superadmins UNE SEULE fois (pas de spam),
// puis on réarme sur le premier succès. Évite qu'une panne de session COMEX
// reste invisible pendant des semaines (cf. panne 8→27 juillet 2026).
// Olivier 2026-08-03.

import { createAdminClient }        from '@/lib/supabase'
import { sendNotificationToRoles }  from '@/lib/notifications/send'

const KEY       = 'comex_login_health'
const THRESHOLD = 10

interface Health { streak: number; alerted: boolean; last_error?: string; since?: string }

export async function recordComexLoginResult(ok: boolean, errMsg?: string): Promise<void> {
  try {
    const sb = createAdminClient()
    const { data } = await sb.from('app_settings').select('value').eq('key', KEY).maybeSingle()
    let st: Health = { streak: 0, alerted: false }
    if (data?.value) {
      try { st = { ...st, ...(typeof data.value === 'string' ? JSON.parse(data.value) : data.value) } } catch { /* défaut */ }
    }

    // Succès → réarme (rien à écrire si déjà sain).
    if (ok) {
      if ((st.streak || 0) === 0 && !st.alerted) return
      await sb.from('app_settings').upsert(
        { key: KEY, value: JSON.stringify({ streak: 0, alerted: false }) },
        { onConflict: 'key' },
      )
      return
    }

    // Échec → incrémente le compteur consécutif.
    const streak = (st.streak || 0) + 1
    let alerted  = !!st.alerted
    if (streak >= THRESHOLD && !alerted) {
      alerted = true
      await sendNotificationToRoles(['superadmin'], 'comex_login_failed', {
        title:      '🔴 COMEX injoignable',
        body:       `Le login Touring/COMEX échoue depuis ${streak} tentatives consécutives — la synchro des statuts est interrompue. Vérifie les accès COMEX.${errMsg ? ' — ' + errMsg.slice(0, 120) : ''}`,
        action_url: '/touring-comex',
      }).catch(() => {})
    }
    await sb.from('app_settings').upsert(
      { key: KEY, value: JSON.stringify({ streak, alerted, last_error: (errMsg || '').slice(0, 200), since: st.since || new Date().toISOString() }) },
      { onConflict: 'key' },
    )
  } catch { /* best-effort : ne bloque JAMAIS le login */ }
}
