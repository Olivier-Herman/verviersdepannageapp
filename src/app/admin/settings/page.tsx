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

  return <SettingsClient listItems={listItems || []} callShortcuts={callShortcuts || []} />
}
