// GET /api/parc/zones-and-depots
// Endpoint leger pour les modals de selection (force parc, etc.) :
// liste les zones actives + les depots actifs.
// Olivier 2026-05-28.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const [zonesRes, depotsRes] = await Promise.all([
    sb.from('parc_zones').select('key, label, sort_order').eq('active', true).order('sort_order'),
    sb.from('depots').select('id, name, address, city, is_default').eq('active', true).order('name'),
  ])

  if (zonesRes.error) return NextResponse.json({ error: zonesRes.error.message }, { status: 500 })
  if (depotsRes.error) return NextResponse.json({ error: depotsRes.error.message }, { status: 500 })

  return NextResponse.json({
    zones:  zonesRes.data || [],
    depots: depotsRes.data || [],
  })
}
