// src/app/ma-journee/page.tsx
//
// « Ma journée » (chantier Fourrière + Facturation, option B, 11/11/2026,
// maquette https://claude.ai/artifact/QVR1rR2Ab5Ksxvqg5iijpg). Une page de
// travail au-dessus des deux espaces : ce qui attend, dans l'ordre du travail,
// avec le bouton qui fait le geste. Aucune règle métier ici : les lectures
// viennent des écrans existants (readDossier d'À facturer, readVehicle de Parc,
// verdict COMEX de Touring) et chaque bouton ouvre l'écran d'origine.
// Préversion `ma_journee` : Olivier seul (comptes Olivier Herman + Mobi).

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isPreviewOn }       from '@/lib/feature-flags'
import { sessionAccess }     from '@/lib/access'
import { loadFacturationDossiers, loadComexById } from '@/lib/dossier/todo-count'
import { getAutoInvoiceRules, checkAutoInvoiceEligible } from '@/lib/facturation/auto-invoice'
import AppShell              from '@/components/layout/AppShell'
import MaJourneeClient       from './MaJourneeClient'

export const dynamic = 'force-dynamic'

export default async function MaJourneePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/ma-journee')
  const u = session.user as any
  const role: string = u.role || ''
  if (!(await isPreviewOn('ma_journee', role, u.id))) redirect('/dashboard')

  // Mêmes droits que les écrans d'origine.
  const canFacturation = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['facturation'] }).ok
  const canFourriere   = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] }).ok
  const canMails       = sessionAccess(session, { roles: ['admin', 'superadmin', 'mail_agent'] }).ok

  // Dossiers à facturer : même chargement que /facturation/dossiers.
  let dossiers: any[] = []
  const autoById: Record<string, boolean> = {}
  let comexById: Record<string, any> = {}
  if (canFacturation) {
    const sb = createAdminClient()
    const r = await loadFacturationDossiers(sb)
    dossiers = r.dossiers
    const rules = await getAutoInvoiceRules(sb)
    const rootRows = dossiers.length
      ? (await sb.from('incoming_missions').select('id, source, mission_type, parent_mission_id, billed_to_name').in('id', dossiers.map(d => d.root_id))).data || []
      : []
    for (const x of rootRows) autoById[(x as any).id] = checkAutoInvoiceEligible(x as any, rules).eligible
    comexById = await loadComexById(sb, dossiers)
  }

  return (
    <AppShell title="Ma journée" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={role} userModules={u.modules || []}>
      <MaJourneeClient
        firstName={String(u.name || '').split(' ')[0] || ''}
        dossiers={dossiers} autoById={autoById} comexById={comexById}
        canFacturation={canFacturation} canFourriere={canFourriere} canMails={canMails}
      />
    </AppShell>
  )
}
