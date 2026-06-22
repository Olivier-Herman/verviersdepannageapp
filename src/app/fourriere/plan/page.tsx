// src/app/parc/plan/page.tsx
//
// Plan visuel du parc fourriere : grille drag&drop des vehicules
// par zone/ligne/slot. Lecture pour tous, ecriture limite selon role
// (drivers : A et Transit uniquement, cf. memoire equipe).

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import ParcPlanClient        from './ParcPlanClient'

export const dynamic = 'force-dynamic'

export default async function ParcPlanPage({ searchParams }: { searchParams: { depot?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const normalized = roles.map(r => String(r ?? '').toLowerCase())
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const isSuperadmin = normalized.includes('superadmin')
  const isAdmin      = isSuperadmin || normalized.includes('admin')
  const isDispatcher = isAdmin || normalized.includes('dispatcher')
  const isDriver     = isSuperadmin || normalized.includes('chauffeur') || normalized.includes('driver')
  const canBlock     = isAdmin || modules.includes('fourriere')

  // Olivier 2026-06-22 : visibilité des TYPES de parc selon le module/profil.
  //   Dispatch → Relivraison + Accident · Fourrière → Saisie · Facturation /
  //   admin / chauffeur → tout (null). La recherche n'est PAS filtrée.
  let visibleZoneTypes: string[] | null = null
  if (!isAdmin && !isDriver && !modules.includes('facturation')) {
    const types = new Set<string>()
    if (normalized.includes('dispatcher')) { types.add('relivraison'); types.add('accident') }
    if (modules.includes('fourriere'))     { types.add('saisie') }
    visibleZoneTypes = types.size > 0 ? Array.from(types) : null
  }

  // Olivier 2026-06-03 : si ?depot=ID, on charge le nom + les zones du parc
  // pour filtrer le plan affiche et naviguer entre parcs.
  let depotName: string | undefined
  let depotZoneKeys: string[] | undefined
  let allDepots: { id: string; name: string }[] = []
  if (searchParams.depot) {
    const sb = createAdminClient()
    const [{ data: d }, { data: zs }, { data: all }] = await Promise.all([
      sb.from('depots').select('id, name').eq('id', searchParams.depot).single(),
      sb.from('parc_zones').select('key').eq('depot_id', searchParams.depot).eq('active', true),
      sb.from('depots').select('id, name').eq('active', true).order('sort_order'),
    ])
    if (d) { depotName = d.name; depotZoneKeys = (zs || []).map(z => z.key) }
    allDepots = all || []
  }

  return (
    <ParcPlanClient
      isDispatcher={isDispatcher}
      isDriver={isDriver}
      canEditLayout={isAdmin}
      canBlock={canBlock}
      userRole={user.role || ''}
      userName={user.name || ''}
      userEmail={user.email || undefined}
      userModules={user.modules || []}
      depotId={searchParams.depot}
      depotName={depotName}
      depotZoneKeys={depotZoneKeys}
      allDepots={allDepots}
      visibleZoneTypes={visibleZoneTypes}
    />
  )
}
