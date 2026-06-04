// src/app/api/admin/towsoft-migration/archive/route.ts
//
// GET /api/admin/towsoft-migration/archive?q=&motif=&limit=200&offset=0
// Liste read-only des fiches TowSoft NON scannees physiquement = "sorties
// avant migration" / archive. Permet de retrouver une fiche legacy ulterieurement
// (notamment apres reactivation du bouton "Importer les photos").

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url    = new URL(req.url)
  const q      = (url.searchParams.get('q') || '').trim().toUpperCase()
  const motif  = (url.searchParams.get('motif') || '').trim()
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '200'), 500)
  const offset = parseInt(url.searchParams.get('offset') || '0')

  const sb = createAdminClient()

  let query = sb
    .from('towsoft_migration_source')
    .select('id, towsoft_num, plate, vin, brand, model, motif, date_entree, parc_towsoft, client_name, appel_type, detail_fetched_at', { count: 'exact' })
    .eq('flag_scanned', false)
    .order('date_entree', { ascending: false })
    .range(offset, offset + limit - 1)

  if (q) {
    query = query.or(`plate.ilike.%${q}%,vin.ilike.%${q}%,towsoft_num.ilike.%${q}%,client_name.ilike.%${q}%`)
  }
  if (motif) {
    query = query.eq('motif', motif)
  }

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Motifs distincts pour filtre dropdown
  const { data: motifsRaw } = await sb
    .from('towsoft_migration_source')
    .select('motif')
    .eq('flag_scanned', false)
    .not('motif', 'is', null)
    .limit(2000)

  const motifs = Array.from(new Set((motifsRaw || []).map((r: any) => r.motif).filter(Boolean))).sort()

  return NextResponse.json({
    rows:   data || [],
    total:  count || 0,
    motifs,
    limit,
    offset,
  })
}
