// src/app/api/cron/reprocess-errors/route.ts
//
// Auto-réparation des missions en erreur (parse_error / placeholders vides) :
// re-parse le contenu ou re-télécharge l'email. Toute mission récupérable
// revient en « À confirmer » automatiquement, sans intervention.
//
// Go-live (plus de TowSoft) : filet de sécurité pour qu'aucune mission ne reste
// bloquée invisible. Olivier 2026-06-16.

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { reprocessErrorMissions } from '@/lib/missions/reprocess-errors'

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const r = await reprocessErrorMissions({ batch: 5 })
    if (r.reparsed || r.refetched || r.failed) {
      console.log(`[CronReprocessErrors] reparsed=${r.reparsed} refetched=${r.refetched} failed=${r.failed}`)
    }
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    console.error('[CronReprocessErrors]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
