// Orchestration de la reconnexion go&assist : verrou, trace, santé.
import { createAdminClient } from '@/lib/supabase'
import { reloginAxa } from '@/lib/axa/relogin'
import { recordAxaPollResult } from '@/lib/axa/health'

export const AXA_RELOGIN_KEY = 'axa_relogin_last'

export function axaReloginConfigured(): boolean {
  return !!(process.env.AXA_PORTAL_EMAIL && process.env.AXA_PORTAL_PASSWORD)
}

export async function readAxaReloginLast(sb: any = createAdminClient()): Promise<any | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', AXA_RELOGIN_KEY).maybeSingle()
  try { return data?.value ? JSON.parse(data.value) : null } catch { return null }
}

export async function runAxaRelogin(trigger: 'cron' | 'poll' | 'manual'): Promise<{ ok: boolean; steps: string[]; error?: string; at: string }> {
  const sb = createAdminClient()
  const at = new Date().toISOString()
  if (!axaReloginConfigured()) {
    const r = { ok: false, steps: [], error: 'Identifiants du portail absents (AXA_PORTAL_EMAIL / AXA_PORTAL_PASSWORD)', at, trigger }
    await sb.from('app_settings').upsert({ key: AXA_RELOGIN_KEY, value: JSON.stringify(r) }, { onConflict: 'key' })
    return r
  }
  // Pas deux reconnexions en même temps (cron + poll) : verrou 3 min.
  const { data: last } = await sb.from('app_settings').select('value').eq('key', AXA_RELOGIN_KEY).maybeSingle()
  try {
    const l = last?.value ? JSON.parse(last.value) : null
    if (l?.running_since && Date.now() - Date.parse(l.running_since) < 3 * 60_000) return { ok: false, steps: [], error: 'reconnexion déjà en cours', at }
  } catch {}
  await sb.from('app_settings').upsert({ key: AXA_RELOGIN_KEY, value: JSON.stringify({ running_since: at, trigger }) }, { onConflict: 'key' })
  const r = await reloginAxa()
  const out = { ok: r.ok, steps: r.steps, error: r.error, at, trigger, email: r.email ?? null }
  await sb.from('app_settings').upsert({ key: AXA_RELOGIN_KEY, value: JSON.stringify(out) }, { onConflict: 'key' })
  if (r.ok) await recordAxaPollResult({ ok: true }).catch(() => {})
  return out
}
