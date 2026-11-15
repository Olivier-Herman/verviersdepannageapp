// src/app/api/cron/conges-rappel/route.ts — 10 h 45 (Bruxelles), lundi → vendredi hors jours fériés : écran chez Momo s'il
// reste des demandes de congé en attente (Olivier 15/11/2026). Deux déclenchements UTC (8 h 45 / 9 h 45) couvrent
// l'heure d'été et d'hiver : seul celui qui tombe à 10 h à Bruxelles agit. ?force=1 pour un essai.
export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const force = new URL(req.url).searchParams.get('force') === '1'
    const heure = Number(new Date().toLocaleString('en-US', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }))
    if (!force && heure !== 10) return NextResponse.json({ ok: true, skipped: `heure locale ${heure}` })
    const { jourOuvrable } = await import('@/lib/paiements/fournisseurs')
    if (!force && !jourOuvrable()) return NextResponse.json({ ok: true, skipped: 'week-end ou jour férié' })
    const { rappelerConges } = await import('@/lib/conges/rappel')
    return NextResponse.json({ ok: true, ...(await rappelerConges()) })
  } catch (e: any) {
    console.error('[cron conges-rappel]', e?.message || e)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
