// src/app/api/nav-badges/route.ts
//
// Compteurs d'attention pour le menu de gauche : renvoie un objet { href: count }
// des éléments à traiter, selon le rôle du user. Le menu affiche un petit badge.
// Léger et no-store — appelé au montage de l'AppShell.
//
// Renvoie AUSSI les flags d'affichage du menu ({ flags: { nav_menu_v2 } }), déjà
// résolus côté serveur pour le rôle du user (off / superadmin / all). Ça évite une
// requête supplémentaire par page : l'AppShell appelle déjà cette route au montage.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient }  from '@/lib/supabase'
import { isPersonnelStaff }   from '@/lib/rh-access'
import { isPreviewOn }        from '@/lib/feature-flags'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ badges: {}, flags: { nav_menu_v2: false } })
  const sb = createAdminClient()
  const badges: Record<string, number> = {}
  const flags = { nav_menu_v2: await isPreviewOn('nav_menu_v2', u.role) }

  // Gestion du personnel : congés en attente de traitement (pending + annulation demandée).
  if (isPersonnelStaff(u)) {
    const { count } = await sb.from('conge_requests').select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'cancel_requested'])
    if (count) badges['/personnel'] = count
  }

  // TGR Gestion : demandes non traitées (statut « pending »).
  if ((u.modules || []).includes('admin') || u.role === 'superadmin') {
    const { count } = await sb.from('tgr_missions').select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    if (count) badges['/admin/tgr'] = count
  }

  // Dispatch : missions sur autoroute dont la tarification Siabis n'est pas tranchée.
  const roles = [u.role, ...(u.roles || [])]
  if ((u.modules || []).includes('missions') || roles.some((r: string) => ['dispatcher', 'admin', 'superadmin'].includes(r))) {
    const { count } = await sb.from('incoming_missions').select('id', { count: 'exact', head: true })
      .eq('needs_siabis_decision', true)
    if (count) badges['/dispatch'] = count
  }

  return NextResponse.json({ badges, flags })
}
