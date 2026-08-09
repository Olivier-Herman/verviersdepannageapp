// src/app/api/cron/saisies/route.ts
//
// Cron JOURNALIER de facturation saisie. Protégé par CRON_SECRET.
// Prépare (ou envoie, selon app_settings.saisie_auto_send) les états de frais dus.
// Olivier 2026-08-09. Cf [[project_facturation_saisie_module]].

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { runSaisieCron }     from '@/lib/missions/saisie-cron'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const sb = createAdminClient()
    const summary = await runSaisieCron(sb)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err: any) {
    console.error('[cron saisies] KO:', err?.message)
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}
