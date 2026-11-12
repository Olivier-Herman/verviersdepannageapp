// src/app/api/cron/as24-domiciliations/route.ts
//
// Rémi : chaque matin de semaine, rapproche les prélèvements AS 24 (Belgium et Nederland)
// avec leur relevé de l'espace client, en encodant ce qui manque (Olivier 12/11/2026).
// Un écart arrête le dossier concerné sans rien écrire et apparaît dans les erreurs du bureau.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { assistantEnPause } from '@/lib/facturation/suspension'
import { journal } from '@/lib/agents/core'
import { prelevementsAs24Ouverts, rapprocherDomiciliationAs24 } from '@/lib/as24/domiciliation'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await assistantEnPause(createAdminClient(), 'agents')) return NextResponse.json({ ok: true, suspendue: true })
  const faits: string[] = [], erreurs: string[] = []
  try {
    for (const id of await prelevementsAs24Ouverts()) {
      try {
        const r = await rapprocherDomiciliationAs24(id)
        faits.push(r.note)
        await journal({ agent: 'Rémi', company: 1, action: 'prélèvement AS 24 rapproché', detail: r.note })
      } catch (e: any) {
        const msg = `Ligne ${id} : ${String(e?.message || e).slice(0, 300)}`
        erreurs.push(msg)
        await journal({ agent: 'Rémi', company: 1, action: 'prélèvement AS 24 à vérifier', detail: msg, ok: false })
      }
    }
    return NextResponse.json({ ok: !erreurs.length, faits, erreurs })
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300)
    await journal({ agent: 'Rémi', company: 1, action: 'prélèvements AS 24 en échec', detail: msg, ok: false })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
