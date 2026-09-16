// src/app/fourriere/sorties/page.tsx
//
// Écran « Sorties » (refonte Fourrière, temps 3, 16/09/2026) : AVP & destruction,
// dossiers de destruction, Domaine, Ventes — un seul écran à onglets. Les écrans
// d'origine restent à leur adresse. Accès : module fourrière ; Domaine réservé
// au superadmin (comme avant), Ventes selon le droit ventes/facturation.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { sessionAccess }     from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import { loadVentesAdminData } from '@/lib/ventes/admin-data'
import SortiesClient         from './SortiesClient'

export const dynamic = 'force-dynamic'

export default async function SortiesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/sorties')
  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []
  if (!(['admin', 'superadmin'].includes(role) || modules.includes('fourriere'))) redirect('/dashboard?error=fourriere_required')
  const canDomaine = role === 'superadmin'
  const canVentes  = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['ventes', 'facturation'] }).ok

  const sb = createAdminClient()
  const since60 = new Date(Date.now() - 60 * 86400000).toISOString()
  const [ventes, avp, dossiers, domaine] = await Promise.all([
    canVentes ? loadVentesAdminData(sb) : Promise.resolve({ sales: [], abandons: [] }),
    sb.from('incoming_missions').select('id', { count: 'exact', head: true }).eq('source', 'police_avp').eq('status', 'parked').eq('dossier_leg', false).lte('parked_at', since60),
    sb.from('destruction_dossiers').select('id', { count: 'exact', head: true }),
    sb.from('incoming_missions').select('id', { count: 'exact', head: true }).eq('status', 'parked').eq('dossier_leg', false).not('domaine_remise_date', 'is', null),
  ])
  return (
    <SortiesClient userRole={role} userName={user.name || ''} userEmail={user.email || ''} userModules={modules}
      sales={ventes.sales} abandons={ventes.abandons} canDomaine={canDomaine} canVentes={canVentes}
      counts={{ avp: avp.count || 0, dossiers: dossiers.count || 0, domaine: domaine.count || 0, ventes: ventes.sales.length }} />
  )
}
