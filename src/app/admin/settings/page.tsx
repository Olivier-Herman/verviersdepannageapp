export const dynamic = 'force-dynamic'
export const revalidate = 0

import { createAdminClient } from '@/lib/supabase'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  const supabase = createAdminClient()

  const { data: listItems } = await supabase
    .from('list_items')
    .select('*')
    .order('list_type')
    .order('sort_order')

  const { data: callShortcuts } = await supabase
    .from('call_shortcuts')
    .select('*')
    .order('sort_order')

  const { data: settingsRows } = await supabase
    .from('app_settings')
    .select('key, value')

  // Convertir en Record<string, string> — les valeurs sont stockées en JSON
  const appSettings: Record<string, string> = {}
  for (const row of settingsRows ?? []) {
    try {
      appSettings[row.key] = JSON.parse(row.value)
    } catch {
      appSettings[row.key] = row.value
    }
  }

  return (
    <SettingsClient
      listItems={listItems || []}
      callShortcuts={callShortcuts || []}
      appSettings={appSettings}
    />
  )
}
