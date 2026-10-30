// Cron (toutes les 2 min) — une assistance reprend un Siabis non couvert en cours : fusion, passage en couvert,
// facture à l'assistance au montant du Siabis non couvert, chauffeur prévenu (Olivier 30/10/2026, lib/missions/siabis-reprise).
// Un cron en échec doit se voir : erreur → réponse 500.
export const dynamic     = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { repriseSiabisParAssistance } from '@/lib/missions/siabis-reprise'

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const dryRun = new URL(req.url).searchParams.get('dry') === '1'
    const r = await repriseSiabisParAssistance(createAdminClient(), { dryRun })
    if (r.traitees.length || r.alertes.length) console.log('[siabis-reprise]', JSON.stringify(r))
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    console.error('[siabis-reprise]', e?.message || e)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
