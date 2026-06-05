// src/app/api/admin/towsoft-archive/run-enrich-now/route.ts
//
// POST /api/admin/towsoft-archive/run-enrich-now
//
// Olivier 2026-06-05 : DESACTIVE. TowSoft Canada nous a detecte sur le
// scraping. Autorisation negociee : push fiches uniquement (Puppeteer
// GitHub Actions via /api/towsoft/create) + consultation manuelle gentille.
//
// Code legacy retire — recuperable via git (commit avant 2026-06-05).
// La page admin /admin/towsoft-archive reste accessible en lecture seule
// pour consulter les ~736 fiches deja enrichies.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json({
    ok: false,
    disabled: true,
    reason: 'TowSoft scraping desactive (accord avec TowSoft CA 2026-06-05). Les donnees deja enrichies restent consultables.',
  }, { status: 410 })
}
