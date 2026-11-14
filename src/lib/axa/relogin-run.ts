// Orchestration de la reconnexion go&assist : verrou, trace, santé.
import { createAdminClient } from '@/lib/supabase'
import { reloginAxa } from '@/lib/axa/relogin'
import { recordAxaPollResult } from '@/lib/axa/health'

export const AXA_RELOGIN_KEY = 'axa_relogin_last'
export const AXA_CAPTCHA_KEY = 'axa_relogin_captcha'
const CAPTCHA_ATTENTE_MS = 120_000   // + 2 min de code par mail : sous les 5 min de la fonction

/** Captcha montré à Mobi (écran AXA de l'app) ; attend sa réponse 2 min au plus (Olivier 14/11/2026). */
async function demanderCaptcha(png: string): Promise<string | null> {
  const sb = createAdminClient()
  const id = `${Date.now()}`
  await sb.from('app_settings').upsert({ key: AXA_CAPTCHA_KEY, value: JSON.stringify({ id, image: png, at: new Date().toISOString(), answer: null }) }, { onConflict: 'key' })
  try {
    const { sendNotificationToRoles } = await import('@/lib/notifications/send')
    await sendNotificationToRoles(['superadmin'], 'axa_poll_down', { title: '🅰️ AXA : captcha à taper', body: 'Ouvre l’écran AXA go&assist et tape les caractères de l’image (2 minutes).', action_url: '/admin/axa' })
  } catch {}
  const fin = Date.now() + CAPTCHA_ATTENTE_MS
  try {
    while (Date.now() < fin) {
      await new Promise(r => setTimeout(r, 2000))
      const { data } = await sb.from('app_settings').select('value').eq('key', AXA_CAPTCHA_KEY).maybeSingle()
      try { const v = data?.value ? JSON.parse(data.value) : null; if (v?.id === id && v.answer) return String(v.answer) } catch {}
    }
    return null
  } finally {
    await sb.from('app_settings').delete().eq('key', AXA_CAPTCHA_KEY).then(() => {}, () => {})
  }
}
const POLL_RETRY_AFTER_FAIL_MS = 60 * 60_000

export function axaReloginConfigured(): boolean {
  return !!(process.env.AXA_PORTAL_EMAIL && process.env.AXA_PORTAL_PASSWORD)
}

export async function readAxaReloginLast(sb: any = createAdminClient()): Promise<any | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', AXA_RELOGIN_KEY).maybeSingle()
  try { return data?.value ? JSON.parse(data.value) : null } catch { return null }
}

export async function runAxaRelogin(trigger: 'cron' | 'poll' | 'manual', opts: { surServeur?: boolean } = {}): Promise<{ ok: boolean; steps: string[]; error?: string; at: string }> {
  const sb = createAdminClient()
  const at = new Date().toISOString()
  // Reconnexion automatique confiée au serveur de secours quand il est en forme et qu'il sait la faire (Olivier
  // 14/11/2026 : toujours depuis la même adresse, comme un PC — AXA ne doit plus voir un appareil inconnu chaque jour).
  if (trigger !== 'manual' && !opts.surServeur) {
    try {
      const { workerHeartbeat, enqueueJob } = await import('@/lib/worker/queue')
      const hb = await workerHeartbeat(sb as any)
      if (hb.alive && hb.kinds?.includes('axa_relogin')) {
        const q = await enqueueJob(sb as any, { kind: 'axa_relogin', dedupeKey: 'axa_relogin', payload: { trigger }, createdBy: `axa-${trigger}` })
        return { ok: false, steps: [], error: q.existing ? 'reconnexion déjà en cours sur le serveur de secours' : 'reconnexion confiée au serveur de secours (1 à 2 min)', at }
      }
    } catch { /* file indisponible : on se reconnecte ici, comme avant */ }
  }
  if (!axaReloginConfigured()) {
    const r = { ok: false, steps: [], error: 'Identifiants du portail absents (AXA_PORTAL_EMAIL / AXA_PORTAL_PASSWORD)', at, trigger }
    await sb.from('app_settings').upsert({ key: AXA_RELOGIN_KEY, value: JSON.stringify(r) }, { onConflict: 'key' })
    return r
  }
  // Panne Microsoft (13/11/2026) : le code AXA arrive par mail et ne peut pas être lu ;
  // chaque essai ferait de plus apparaître un captcha. Seul le bouton manuel passe.
  if (trigger !== 'manual') {
    const { microsoftOutageSince } = await import('@/lib/microsoft-outage')
    if (await microsoftOutageSince()) return { ok: false, steps: [], error: 'panne Microsoft en cours : le code AXA ne peut pas être lu, reconnexion automatique suspendue jusqu’au retour du service', at }
  }
  // Pas deux reconnexions en même temps (cron + poll) : verrou 6 min (code AXA 2 min, captcha 3 min).
  const { data: last } = await sb.from('app_settings').select('value').eq('key', AXA_RELOGIN_KEY).maybeSingle()
  try {
    const l = last?.value ? JSON.parse(last.value) : null
    if (l?.running_since && Date.now() - Date.parse(l.running_since) < 6 * 60_000) return { ok: false, steps: [], error: 'reconnexion déjà en cours', at }
    // 11/11/2026 : chaque essai raté envoyait un mail de code AXA → 67 mails en une
    // heure. Après un échec, le poll ne réessaie qu'une fois par heure (le cron et
    // le bouton « Reconnecter maintenant » ne sont pas freinés).
    if (trigger === 'poll' && l && l.ok === false && l.at && Date.now() - Date.parse(l.at) < POLL_RETRY_AFTER_FAIL_MS) {
      return { ok: false, steps: [], error: `dernière reconnexion en échec (${l.error || 'erreur'}) — prochain essai automatique dans l’heure`, at }
    }
  } catch {}
  await sb.from('app_settings').upsert({ key: AXA_RELOGIN_KEY, value: JSON.stringify({ running_since: at, trigger }) }, { onConflict: 'key' })
  const r = await reloginAxa(async steps => {
    await sb.from('app_settings').upsert({ key: AXA_RELOGIN_KEY, value: JSON.stringify({ running_since: at, trigger, steps }) }, { onConflict: 'key' }).then(() => {}, () => {})
  }, trigger === 'manual' ? { askCaptcha: demanderCaptcha } : {})
  const out = { ok: r.ok, steps: r.steps, error: r.error, at, trigger, email: r.email ?? null }
  await sb.from('app_settings').upsert({ key: AXA_RELOGIN_KEY, value: JSON.stringify(out) }, { onConflict: 'key' })
  if (r.ok) await recordAxaPollResult({ ok: true }).catch(() => {})
  return out
}
