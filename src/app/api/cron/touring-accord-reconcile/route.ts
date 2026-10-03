// src/app/api/cron/touring-accord-reconcile/route.ts
//
// Cron hebdomadaire (mercredi 8h) : rapproche les missions Touring hors comex
// avec les accords Touring (COMEX BKO) et passe les dossiers déjà couverts en
// « Facturation OK » (« Déjà facturé avec numéro d'accord … »). Réduit le bruit
// avant le rappel mensuel. Auth : Bearer CRON_SECRET.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { reconcileHorsComexWithAccords } from '@/lib/touring/accord-reconcile'
import { withAiContext } from '@/lib/ai/usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function handleGET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  try {
    const res = await reconcileHorsComexWithAccords(sb, null)
    console.log('[touring-accord-reconcile]', JSON.stringify({ scanned: res.scanned, reconciled: res.reconciled }))
    return NextResponse.json({ ok: true, scanned: res.scanned, reconciled: res.reconciled, details: res.details.slice(0, 40) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'échec' }, { status: 502 })
  }
}


// Les appels d'IA de ce passage sont comptés sous « cron:touring-accord-reconcile » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:touring-accord-reconcile' }, () => handleGET(...args))
}
