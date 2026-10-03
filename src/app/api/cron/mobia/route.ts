// src/app/api/cron/mobia/route.ts
//
// Mobia (Olivier 03/10/2026) : toutes les 15 min, de 9 h à 20 h (Bruxelles),
// un brouillon de réponse pour chaque nouveau mail du dossier « Claudy »
// d'info@ (src/lib/mobia/run.ts). La nuit, rien : les mails arrivés sont
// traités au passage de 9 h.
//   ?essai=<id ou internetMessageId> : essai sur un mail (même déjà traité),
//   sans brouillon, sans notification — renvoie le texte qui serait préparé.

import { NextResponse } from 'next/server'
import { runMobia, brusselsHour } from '@/lib/mobia/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const essai = new URL(req.url).searchParams.get('essai') || undefined
  const h = brusselsHour()
  if (!essai && (h < 9 || h >= 20)) return NextResponse.json({ ok: true, skipped: 'nuit' })
  try {
    const r = await runMobia({ dryKey: essai })
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    console.error('[cron/mobia]', e?.message || e)
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
