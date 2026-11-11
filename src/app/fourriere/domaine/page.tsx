// src/app/fourriere/domaine/page.tsx
//
// Module Domaine (SPF Finances) — hub Fourrière : gardiennage État + Vente
// d'épaves. Superadmin uniquement (phase actuelle). Olivier 2026-07-29.

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { redirect }         from 'next/navigation'
import DomaineClient        from './DomaineClient'
import { isPreviewOn } from '@/lib/feature-flags'
import AppShell from '@/components/layout/AppShell'
import DomaineOngletsClient from './DomaineOngletsClient'
import { createAdminClient } from '@/lib/supabase'
import { getBusinessText } from '@/lib/settings/business'

export default async function FourriereDomainePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/domaine')
  const user = session.user as any
  if (user.role !== 'superadmin') redirect('/dashboard?error=access_denied')

  // Préversion ma_journee (Q5, Olivier 11/11/2026) : écran à trois onglets.
  if (await isPreviewOn('ma_journee', user.role, user.id)) {
    const sb = createAdminClient()
    const zone = (await getBusinessText('domaine_zone_parc').catch(() => 'I')) || 'I'
    const [{ count: aRattacher }, { data: hz }, { data: av }] = await Promise.all([
      sb.from('domaine_dates_in').select('id', { count: 'exact', head: true }).is('matched_mission_id', null).in('outcome', ['no_match', 'ambiguous']),
      sb.from('incoming_missions').select('parc_zone_key').in('status', ['parked', 'unlocated', 'awaiting_payment']).eq('dossier_leg', false).not('domaine_remise_date', 'is', null).is('domaine_vente_date', null),
      sb.from('domaine_ventes_epaves').select('vente_date').is('sortie_reelle_date', null).not('vente_date', 'is', null),
    ])
    const compte = { aRattacher: aRattacher || 0, horsZone: (hz || []).filter((m: any) => m.parc_zone_key !== zone).length, ventesASortir: new Set((av || []).map((r: any) => r.vente_date)).size }
    return (
      <AppShell title="Domaine" userRole={user.role} userName={user.name || ''} userEmail={user.email || ''} userId={user.id} userModules={user.modules || []}>
        <DomaineOngletsClient user={{ role: user.role, name: user.name || '', email: user.email || '', modules: user.modules || [] }} compte={compte} />
      </AppShell>
    )
  }

  return (
    <DomaineClient
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={user.modules || []}
      sortiesEnTete={await isPreviewOn('ma_journee', user.role, user.id)}
    />
  )
}
