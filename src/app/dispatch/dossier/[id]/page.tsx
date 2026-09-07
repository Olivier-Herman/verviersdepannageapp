// src/app/dispatch/dossier/[id]/page.tsx
//
// Vue DOSSIER (Olivier 07/09/2026) : un dossier = la fiche REM racine + ses
// séjours au parc (fiches gardiennage) + ses relivraisons, chaque action = un
// groupe lettré (10114107A, B, C…). Client de facturation par groupe, estimation
// de tout le dossier dans chaque groupe, mails sans action en lignes fines.
// La fiche dispatch complète reste disponible dans chaque groupe (embed).
// Accès : superadmin toujours ; les autres si flag 'dossier_view' = all.
// /dispatch/[id] reste inchangée.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isPreviewOn }       from '@/lib/feature-flags'
import { buildDossier }      from '@/lib/dossier/build'
import { loadMissionFiche }  from '@/lib/missions/load-fiche-props'
import AppShell              from '@/components/layout/AppShell'
import DossierGroups         from './DossierGroups'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function DossierPage({ params, searchParams }: { params: { id: string }; searchParams?: { open?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u    = session.user as any
  const role = u.role || ''

  const allowed = role === 'superadmin' || (await isPreviewOn('dossier_view', role))
  if (!allowed) redirect(`/dispatch/${params.id}`)

  const dossier = await buildDossier(params.id)
  if (!dossier) redirect('/dispatch')

  const sb = createAdminClient()
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

  // Données de chaque fiche pour l'embed « Ouvrir la fiche complète ».
  const fiches: Record<string, any> = {}
  await Promise.all(dossier.legs.map(async l => { fiches[l.mission_id] = await loadMissionFiche(l.mission_id) }))

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

  // ?open=<mission_id> (QR étiquette → gardiennage en cours) ; sinon le dernier groupe.
  const openId = searchParams?.open || params.id

  return (
    <AppShell title={`Dossier ${dossier.ref}`} userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={role} userModules={u.modules || []}>
      <DossierGroups initial={dossier} fiches={fiches} shared={shared} isSuperadmin={role === 'superadmin'} openMissionId={openId} />
    </AppShell>
  )
}
