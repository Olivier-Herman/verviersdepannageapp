import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import SourcesClient         from './SourcesClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function SourcesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const { data: sources } = await sb
    .from('mission_source_catalog')
    .select('*')
    .order('sort_order')
    .order('label')

  // Counts par source pour aider a decider
  const { data: missions } = await sb
    .from('incoming_missions')
    .select('source')
    .not('source', 'is', null)
    .limit(10000)
  const counts = new Map<string, number>()
  for (const m of missions || []) {
    if (m.source) counts.set(m.source, (counts.get(m.source) || 0) + 1)
  }

  const { data: clientLinks } = await sb.from('surcharge_clients').select('key')
  const surchargeSet = new Set((clientLinks || []).map(c => c.key))

  const initial = (sources || []).map(s => ({
    ...s,
    mission_count: counts.get(s.key) || 0,
    has_surcharge: surchargeSet.has(s.key),
  }))

  return <SourcesClient initial={initial} />
}
