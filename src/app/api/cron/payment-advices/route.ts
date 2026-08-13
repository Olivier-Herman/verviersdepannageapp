// src/app/api/cron/payment-advices/route.ts
//
// Lecture des avis de paiement assureurs (IMA, AWP) et mise en cache.
//
// Deux passages par jour : 5 h — les avis IMA arrivent la nuit, l'écran est
// donc à jour dès l'ouverture — et midi, pour ceux de la matinée. Entre les
// deux, Finance › Réconciliation lit `payment_advices` et s'affiche
// instantanément au lieu d'attendre Graph et Claude.
//
// Idempotent : un mail déjà lu n'est jamais rouvert. Deux passages qui se
// chevauchent produisent la même table.

import { NextResponse } from 'next/server'
import { syncAdvices }  from '@/lib/advice-cache'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

/** Profondeur de balayage : au-delà, un avis est de toute façon déjà rapproché. */
const MONTHS_BACK = 3

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const since = new Date()
  since.setUTCMonth(since.getUTCMonth() - MONTHS_BACK)

  try {
    const res = await syncAdvices(since.toISOString())
    return NextResponse.json({ ok: true, at: new Date().toISOString(), ...res })
  } catch (e: any) {
    console.error('[cron payment-advices]', e?.message || e)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
