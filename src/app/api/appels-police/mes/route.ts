// GET /api/appels-police/mes — appels police du dispatch confiés au chauffeur connecté, pas encore complétés.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { moi, STATUTS_ACTIFS } from '@/lib/appels-police/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const u = await moi()
  if (!u) return NextResponse.json({ appels: [] })
  const since = new Date(Date.now() - 24 * 3600e3).toISOString()
  const { data } = await createAdminClient().from('appels_police').select('id, address, status, note, created_at')
    .eq('driver_id', u.id).in('status', STATUTS_ACTIFS).gte('created_at', since).order('created_at', { ascending: false })
  return NextResponse.json({ appels: data || [] })
}
