// src/app/api/cron/assistance-close-retry/route.ts
//
// Rattrapage des clôtures d'assistance mises en file quand la plateforme tierce
// était injoignable (Olivier 2026-08-11 : « une application tierce ne doit jamais
// nous bloquer — on avance, on met en mémoire, on rattrape »).
//
// Toutes les 5 min : rejoue les clôtures en attente. Idempotent (une clôture déjà
// faite à la main par le dispatch ne repart pas). Le chauffeur, lui, a terminé sa
// mission depuis longtemps — il ne voit jamais ce mécanisme.

import { NextResponse } from 'next/server'
import { runAssistanceCloseRetry } from '@/lib/cloture/queue'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const isCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  const isInternal = process.env.NEXTAUTH_SECRET && req.headers.get('x-internal-secret') === process.env.NEXTAUTH_SECRET
  if (!isCron && !isInternal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const r = await runAssistanceCloseRetry(10)
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'erreur' }, { status: 500 })
  }
}
