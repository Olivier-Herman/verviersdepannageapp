// src/app/api/cron/contrats-assistance/route.ts — toutes les 5 min : contrat de l'assistance posé sur les fiches
// ouvertes qui n'en ont pas encore (Touring, AXA, Allianz, IMA). VAB : à l'import. Olivier 15/11/2026.
export const dynamic     = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { completerContrats } = await import('@/lib/assistance/contrat')
    return NextResponse.json({ ok: true, ...(await completerContrats()) })
  } catch (e: any) {
    console.error('[cron contrats-assistance]', e?.message || e)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
