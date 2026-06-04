// src/app/api/fourriere/zones-by-depot/route.ts
//
// GET /api/fourriere/zones-by-depot
// Retourne la liste des zones groupees par depot (pour selecteurs UI).
// Accessible a tout utilisateur authentifie (lecture seule).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()

  const [{ data: depots }, { data: zones }] = await Promise.all([
    sb.from('depots').select('id, name, sort_order, is_default_parc').eq('active', true).order('sort_order'),
    sb.from('parc_zones').select('key, label, depot_id, sort_order').eq('active', true).order('sort_order'),
  ])

  // Groupe zones par depot
  const byDepot = (depots || []).map(d => ({
    id:    d.id,
    name:  d.name,
    is_default_parc: d.is_default_parc,
    zones: (zones || []).filter(z => z.depot_id === d.id).map(z => ({ key: z.key, label: z.label })),
  }))

  // Zones non rattachees a un depot
  const orphans = (zones || []).filter(z => !z.depot_id).map(z => ({ key: z.key, label: z.label }))

  return NextResponse.json({ depots: byDepot, orphans })
}
