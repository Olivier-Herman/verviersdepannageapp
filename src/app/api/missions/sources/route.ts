// src/app/api/missions/sources/route.ts
//
// GET /api/missions/sources
// Liste les sources actives du catalogue central (mission_source_catalog).
// Accessible a tout utilisateur authentifie (dispatcher / admin / superadmin).
// Utilise pour le dropdown source dans la fiche mission.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()

  const { data, error } = await sb
    .from('mission_source_catalog')
    .select('key, label, active, sort_order, display_color, display_color_hex, group_key')
    .eq('active', true)
    .order('sort_order')
    .order('label')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 'source' garde l ancien nom de la cle pour compat ; on expose aussi 'key'
  // pour les nouveaux consommateurs (interface SourceDisplay du lib).
  const sources = (data || []).map(s => ({
    source:            s.key,
    key:               s.key,
    label:             s.label,
    display_color:     s.display_color,
    display_color_hex: s.display_color_hex,
    group_key:         s.group_key,
  }))
  return NextResponse.json({ ok: true, sources })
}
