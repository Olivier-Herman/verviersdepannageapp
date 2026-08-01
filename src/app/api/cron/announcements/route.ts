// src/app/api/cron/announcements/route.ts
//
// Cron : diffuse les annonces PROGRAMMÉES dont l'heure est arrivée.
// Sélectionne scheduled_at <= now() et pas encore diffusées (broadcast_at null),
// envoie la notif (in-app + push) aux destinataires, puis marque active + broadcast_at.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { broadcastAnnouncement } from '@/lib/announcements/broadcast'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  const nowIso = new Date().toISOString()

  const { data: due } = await sb.from('announcements').select('*')
    .not('scheduled_at', 'is', null)
    .is('broadcast_at', null)
    .lte('scheduled_at', nowIso)

  const results: any[] = []
  for (const ann of (due || [])) {
    const res = await broadcastAnnouncement(sb, ann)
    await sb.from('announcements').update({ broadcast_at: new Date().toISOString(), active: true }).eq('id', ann.id)
    results.push({ id: ann.id, title: ann.title, ...res })
  }
  return NextResponse.json({ ok: true, processed: results.length, results })
}
