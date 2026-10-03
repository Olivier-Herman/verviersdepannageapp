// src/app/api/cron/circlek-foreign-vat/route.ts
//
// Cron quotidien : complète les factures Circle K étrangères importées sans leur
// TVA (non déductible, coût du carburant) et les lettre avec leur prélèvement.
// Protégé par CRON_SECRET. Olivier 2026-09-30.

import { NextResponse } from 'next/server'
import { fixCircleKForeignVat } from '@/lib/finance/circlek-foreign-vat'
import { withAiContext } from '@/lib/ai/usage'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

async function handleGET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const res = await fixCircleKForeignVat()
    return NextResponse.json({ ok: true, ...res })
  } catch (err: any) {
    console.error('[cron circlek-foreign-vat] KO:', err?.message)
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}


// Les appels d'IA de ce passage sont comptés sous « cron:circlek-foreign-vat » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:circlek-foreign-vat' }, () => handleGET(...args))
}
