// Motifs de réception pour la borne visiteur (PUBLIC — kiosque QR).
// Renvoie les motifs actifs de type visite (visit/both), FR + EN.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const sb = createAdminClient()
  const { data } = await sb.from('reception_motifs')
    .select('id, label, label_en, requires_vehicle, free_text')
    .eq('active', true)
    .in('kind', ['visit', 'both'])
    .order('sort_order').order('label')
  return NextResponse.json({ motifs: data || [] })
}
