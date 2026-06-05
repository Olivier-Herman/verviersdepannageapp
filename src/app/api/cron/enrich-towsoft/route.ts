// src/app/api/cron/enrich-towsoft/route.ts
//
// Olivier 2026-06-05 : DESACTIVE. TowSoft Canada nous a detecte sur le
// scraping massif (2026-06-05). Accord garde uniquement push fiches via
// /api/towsoft/create (Puppeteer GitHub Actions) + consultation manuelle.
//
// Cron retire de vercel.json. La route renvoie 410 GONE pour les
// appels manuels eventuels (CRON_SECRET ou autres).
//
// Code legacy retire — recuperable via git si besoin.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: false,
    disabled: true,
    reason: 'TowSoft enrichment cron disabled per agreement with TowSoft CA (2026-06-05).',
  }, { status: 410 })
}
