// src/app/api/devis/[token]/pixel/route.ts
//
// Pixel de suivi d'ouverture (best-effort — souvent bloqué par les messageries).
// Le signal fiable reste le clic sur le lien de dépôt. Renvoie un GIF 1x1.

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const sb = createAdminClient()
    const { data } = await sb.from('achats_rfq_recipients').select('id, opened_at, status').eq('token', params.token).maybeSingle()
    if (data && !data.opened_at) {
      await sb.from('achats_rfq_recipients').update({ opened_at: new Date().toISOString(), status: data.status === 'sent' ? 'opened' : data.status }).eq('id', data.id)
    }
  } catch { /* silencieux */ }
  return new Response(GIF, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' } })
}
