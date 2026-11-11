// src/app/fourriere/controle/page.tsx — Contrôle du parc : écran de contrôle en direct + analyse (Olivier 21/10/2026).
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import AppShell             from '@/components/layout/AppShell'
import ControleClient       from './ControleClient'
import ControleUnifieClient from './ControleUnifieClient'
import { isPreviewOn }      from '@/lib/feature-flags'
import { createAdminClient } from '@/lib/supabase'
import { getBusinessNumber } from '@/lib/settings/business'

export const dynamic = 'force-dynamic'

export default async function ControlePage({ searchParams }: { searchParams: { id?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/controle')
  const a = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  if (!a.ok) redirect('/dashboard?error=fourriere_required')
  const u = session.user as any
  // Préversion ma_journee (P7/P8, Olivier 11/11/2026) : un seul écran pour compter le parc.
  if (await isPreviewOn('ma_journee', u.role, u.id)) {
    const sb = createAdminClient()
    const [{ count }, { data: last }, rappel] = await Promise.all([
      sb.from('incoming_missions').select('id', { count: 'exact', head: true }).eq('status', 'unlocated'),
      sb.from('parc_controles').select('started_at').order('started_at', { ascending: false }).limit(1).maybeSingle(),
      getBusinessNumber('controle_parc_rappel_jours').catch(() => 0),
    ])
    return (
      <AppShell title="Contrôle du parc" userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userId={u.id} userModules={u.modules || []}>
        <ControleUnifieClient initialId={searchParams?.id || null} aRetrouver={count || 0} dernierControle={last?.started_at || null} rappelJours={rappel > 0 ? rappel : null}
          user={{ role: u.role || '', name: u.name || '', email: u.email || '', modules: u.modules || [] }} />
      </AppShell>
    )
  }
  return (
    <AppShell title="Contrôle du parc" userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userId={u.id} userModules={u.modules || []}>
      <ControleClient initialId={searchParams?.id || null} />
    </AppShell>
  )
}
