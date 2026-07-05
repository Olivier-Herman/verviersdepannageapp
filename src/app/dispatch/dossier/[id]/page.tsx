// src/app/dispatch/dossier/[id]/page.tsx
//
// Vue DOSSIER = un écran. On reprend TES fiches existantes telles quelles (le
// composant MissionDetailClient), empilées dans des groupes repliables (dernier
// ouvert, autres repliés). NOUVELLE route — /dispatch/[id] reste inchangée.
// Accès : superadmin toujours (preview) ; les autres si flag 'dossier_view' = all.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isPreviewOn }       from '@/lib/feature-flags'
import { loadMissionFiche }  from '@/lib/missions/load-fiche-props'
import AppShell              from '@/components/layout/AppShell'
import DossierGroups         from './DossierGroups'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function DossierPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u    = session.user as any
  const role = u.role || ''

  const allowed = role === 'superadmin' || (await isPreviewOn('dossier_view', role))
  if (!allowed) redirect(`/dispatch/${params.id}`)

  const sb = createAdminClient()

  // Racine (REM) : le point d'entrée peut être le REM ou la REL.
  const hdrCols = 'id, parent_mission_id, mission_number, dossier_number, external_id, vehicle_plate, vehicle_brand, vehicle_model, client_name, client_phone, source'
  const { data: m0 } = await sb.from('incoming_missions').select(hdrCols).eq('id', params.id).maybeSingle()
  if (!m0) redirect('/dispatch')
  let rootRow: any = m0
  if ((m0 as any).parent_mission_id) {
    const { data: p } = await sb.from('incoming_missions').select(hdrCols).eq('id', (m0 as any).parent_mission_id).maybeSingle()
    if (p) rootRow = p
  }

  // Actions = fiches réelles : REM (racine) + enfants (REL…), ordre chronologique.
  const { data: children } = await sb.from('incoming_missions')
    .select('id, received_at')
    .eq('parent_mission_id', rootRow.id)
    .not('status', 'in', '("cancelled","ignored")')
    .order('received_at', { ascending: true })
  const actionIds = [rootRow.id, ...(children || []).map((c: any) => c.id)]

  // Données partagées (une fois).
  const [{ data: drivers }, { data: catalogSources }] = await Promise.all([
    sb.from('users').select('id, name, avatar_url').eq('active', true)
      .or('role.in.(driver,admin,superadmin),roles.ov.{driver,admin,superadmin}').order('name'),
    sb.from('mission_source_catalog').select('key, label, display_color, group_key').eq('active', true).order('label'),
  ])
  let userHasOdooAccess = false
  if (u.id) {
    const { data: meRow } = await sb.from('users').select('odoo_api_key').eq('id', u.id).maybeSingle()
    userHasOdooAccess = Boolean(meRow?.odoo_api_key)
  }

  // Données de chaque fiche.
  const fiches = await Promise.all(actionIds.map(id => loadMissionFiche(id)))
  const LETTERS = 'ABCDEFGHIJ'
  const groups = fiches.map((f, i) => f ? {
    letter:         LETTERS[i] || String(i + 1),
    id:             f.mission.id,
    mission_number: f.mission.mission_number,
    dossier_number: f.mission.dossier_number || f.mission.external_id || null,
    mission_type:   f.mission.mission_type,
    status:         f.mission.status,
    started_at:     f.mission.received_at || f.mission.intervention_date || null,
    data:           f,
  } : null).filter(Boolean)

  const shared = {
    drivers:       drivers || [],
    sources:       catalogSources || [],
    userName:      u.name || '',
    userEmail:     u.email || undefined,
    userId:        u.id || undefined,
    userRole:      role,
    userModules:   u.modules || [],
    userHasOdooAccess,
    googleMapsKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  }
  const header = {
    ref:     rootRow.mission_number != null ? `#${rootRow.mission_number}` : (rootRow.dossier_number || rootRow.id.slice(0, 8)),
    vehicle: [rootRow.vehicle_brand, rootRow.vehicle_model].filter(Boolean).join(' '),
    plate:   rootRow.vehicle_plate,
    client:  rootRow.client_name,
    phone:   rootRow.client_phone,
    source:  rootRow.source,
  }

  return (
    <AppShell title="Dossier" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={role} userModules={u.modules || []}>
      <DossierGroups header={header} groups={groups as any} shared={shared} isSuperadmin={role === 'superadmin'} />
    </AppShell>
  )
}
