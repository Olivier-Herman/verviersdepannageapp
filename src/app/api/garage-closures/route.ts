// src/app/api/garage-closures/route.ts
//
// GET — règles de fermeture garage ACTIVES AUJOURD'HUI (pour les fiches dispatch
// + chauffeur). Retourne { rules: [{ keywords, message }] }. Tout user authentifié.
// Olivier 2026-07-15.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { parseKeywords }     from '@/lib/garage-closures'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const { data } = await sb
    .from('garage_closures')
    .select('match_keywords, message')
    .eq('active', true)
    .lte('date_from', today)
    .gte('date_to', today)

  const rules = (data || []).map(r => ({ keywords: parseKeywords(r.match_keywords), message: r.message }))
  return NextResponse.json({ rules })
}
