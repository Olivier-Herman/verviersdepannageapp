// src/app/api/missions/[id]/fiche/route.ts
//
// GET — tout ce qu'il faut pour embarquer la fiche dispatch (MissionDetailClient)
// ailleurs que sur sa page : dans la liste dispatch dépliée (Olivier 07/09/2026)
// ou dans la Vue dossier. Renvoie aussi le fil du dossier en mode léger pour
// afficher les groupes A, B, C au-dessus de la fiche.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { loadMissionFiche }  from '@/lib/missions/load-fiche-props'
import { buildDossier }      from '@/lib/dossier/build'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = session.user as any
  const sb = createAdminClient()
  const [fiche, dossier, meRow] = await Promise.all([
    loadMissionFiche(params.id),
    buildDossier(params.id, { light: true }).catch(() => null),
    u.id ? sb.from('users').select('odoo_api_key').eq('id', u.id).maybeSingle().then(r => r.data) : Promise.resolve(null),
  ])
  if (!fiche) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  return NextResponse.json({
    ok: true, fiche, dossier,
    user: { id: u.id || null, name: u.name || '', email: u.email || null, role: u.role || '', modules: u.modules || [] },
    userHasOdooAccess: Boolean((meRow as any)?.odoo_api_key),
    googleMapsKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  })
}
