// src/app/api/cron/allianz-nouvelles/route.ts — nouvelles missions Allianz lues dans Hexalite toutes les 5 min,
// sans dépendre du mail d'Allianz (Olivier 13/11/2026, panne Microsoft). Cf lib/allianz/poll-nouvelles.ts.
// Kill-switch : DISABLE_ALLIANZ_POLL=true sur Vercel.

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { pollAllianzNouvelles } from '@/lib/allianz/poll-nouvelles'

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.DISABLE_ALLIANZ_POLL === 'true') return NextResponse.json({ ok: true, disabled: true })
  const r = await pollAllianzNouvelles()
  if (r.creees.length) console.log(`[cron allianz-nouvelles] ${r.creees.length} fiche(s) créée(s) : ${r.creees.join(', ')}`)
  return NextResponse.json(r)
}
