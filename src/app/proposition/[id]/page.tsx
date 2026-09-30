// Page « Mission proposée » (garde de nuit, Olivier 30/09/2026) : ouverte depuis la
// notif. « J'accepte » attribue la mission ; « Je suis déjà en mission » la passe à
// la réserve. Cf lib/missions/market-proposals.ts.

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AppShell              from '@/components/layout/AppShell'
import ProposalClient        from './ProposalClient'
import { closedMessage }     from '@/lib/missions/market-proposals'

export const dynamic = 'force-dynamic'

export default async function PropositionPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any

  const sb = createAdminClient()
  const { data: p } = await sb.from('market_proposals').select('*').eq('id', params.id).maybeSingle()
  const mine = !!p && p.driver_id === user.id
  const { data: m } = mine
    ? await sb.from('incoming_missions')
        .select('id, mission_number, source, mission_type, client_name, vehicle_plate, vehicle_brand, vehicle_model, incident_address, incident_city, destination_address, remarks_general, received_at')
        .eq('id', p.mission_id).maybeSingle()
    : { data: null }

  return (
    <AppShell title="Mission proposée" userRole={user.role || ''} userName={user.name} userEmail={user.email} userId={user.id} userModules={user.modules || []}>
      <ProposalClient
        proposal={mine ? {
          id: p.id, status: p.status, step: p.step, reason: p.reason, notifiedAt: p.notified_at,
          message: p.status === 'pending' ? null : await closedMessage(sb, p),
        } : null}
        mission={m as any}
      />
    </AppShell>
  )
}
