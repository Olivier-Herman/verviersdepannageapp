// src/lib/facturation/automation-flags.ts
//
// Interrupteurs (toggles) des automatisations de validation, pilotés depuis le
// module Facturation auto (superadmin). Stockés dans app_settings (valeur JSON
// booléenne). Par défaut ACTIVÉ (true) si le réglage n'existe pas encore.
// Olivier 2026-07-29.

export const AUTOMATION_FLAGS = {
  allianzAutoClose: 'auto_close_allianz_enabled',
  comexAutoAccept:  'auto_accept_comex_enabled',
} as const

export async function getAutomationEnabled(sb: any, key: string, def = true): Promise<boolean> {
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (data?.value == null) return def
  const v = data.value
  if (typeof v === 'boolean') return v
  try { return JSON.parse(v) === true } catch { return String(v) === 'true' }
}

export async function setAutomationEnabled(sb: any, key: string, val: boolean): Promise<void> {
  await sb.from('app_settings').upsert({ key, value: JSON.stringify(!!val) }, { onConflict: 'key' })
}
