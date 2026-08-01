// src/app/api/nav-badges/route.ts
//
// Compteurs d'attention pour le menu de gauche : renvoie un objet { href: count }
// des éléments à traiter, selon le rôle du user. Le menu affiche un petit badge.
// Léger et no-store — appelé au montage de l'AppShell.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient }  from '@/lib/supabase'
import { isPersonnelStaff }   from '@/lib/rh-access'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ badges: {} })
  const sb = createAdminClient()
  const badges: Record<string, number> = {}

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

  return NextResponse.json({ badges })
}
