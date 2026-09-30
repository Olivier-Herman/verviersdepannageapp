// Page « Mission proposée » (garde de nuit, Olivier 30/09/2026) : ouverte depuis la
// notif. 1er départ : J'accepte / Je suis déjà en mission (→ garde-fou : estimation,
// rappel 15 min, appel client). Réserve : J'accepte / appeler le 1er départ / lui
// renvoyer la mission. Cf lib/missions/market-proposals.ts.

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AppShell              from '@/components/layout/AppShell'
import ProposalClient        from './ProposalClient'
import { closedMessage, TEST_MISSION, toE164 } from '@/lib/missions/market-proposals'
import { gardeNight }        from '@/lib/missions/market-notify'

export const dynamic = 'force-dynamic'

export default async function PropositionPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any

  const sb = createAdminClient()
  const { data: p } = await sb.from('market_proposals').select('*').eq('id', params.id).maybeSingle()
  const mine = !!p && p.driver_id === user.id
  const { data: m } = mine && p.is_test ? { data: TEST_MISSION as any }
    : mine ? await sb.from('incoming_missions')
        .select('id, mission_number, source, mission_type, client_name, client_phone, assisted_phone, vehicle_plate, vehicle_brand, vehicle_model, incident_address, incident_city, destination_address, remarks_general, received_at')
        .eq('id', p.mission_id).maybeSingle()
    : { data: null }

  // Réserve : nom et numéro du 1er départ (pour l'appeler et lui renvoyer la mission).
  let first: { name: string; phone: string | null } | null = null
  if (mine && p.step === 'reserve') {
    const night = await gardeNight(sb)
    if (night?.nightFirst) {
      const [{ data: u }, { data: pers }] = await Promise.all([
        sb.from('users').select('name, phone').eq('id', night.nightFirst).maybeSingle(),
        sb.from('personnel').select('phone').eq('user_id', night.nightFirst).limit(1),
      ])
      if (u) first = { name: u.name, phone: toE164(u.phone || pers?.[0]?.phone) }
    }
  }

  return (
    <AppShell title="Mission proposée" userRole={user.role || ''} userName={user.name} userEmail={user.email} userId={user.id} userModules={user.modules || []}>
      <ProposalClient
        proposal={mine ? {
          id: p.id, status: p.status, step: p.step, reason: p.reason, notifiedAt: p.notified_at, isTest: !!p.is_test,
          phase: p.phase || 'asked', phaseAt: p.phase_at || p.notified_at,
          etaMin: p.eta_min ?? null, eta: p.eta_detail || null,
          snoozeUntil: p.snooze_until || null, snoozeCount: p.snooze_count || 0,
          message: p.status === 'pending' ? null : await closedMessage(sb, p),
        } : null}
        mission={m ? { ...m, has_client_phone: !!(m.client_phone || m.assisted_phone), client_phone: undefined, assisted_phone: undefined } : null}
        first={first}
      />
    </AppShell>
  )
}
