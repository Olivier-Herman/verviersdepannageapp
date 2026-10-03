// src/app/api/cron/poll-vente-epaves/route.ts
//
// Domaine — Sujet 2. Capture les mails « Vente d'épaves » de rosemarie.lehnen,
// pose vente/firme/Date OUT sur les saisies vendues et imprime les étiquettes
// VENDU. GET protégé par CRON_SECRET. Olivier 2026-07-29.

import { NextResponse }     from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { pollVenteEpaves }   from '@/lib/domaine/vente-epaves-intake'
import { withAiContext } from '@/lib/ai/usage'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

async function handleGET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const summary = await pollVenteEpaves()
  const at = new Date().toISOString()
  const sb = createAdminClient()
  await sb.from('app_settings').upsert({ key: 'vente_epaves_last_run', value: { at, ...summary } }, { onConflict: 'key' }).then(() => {}, () => {})
  console.log('[poll-vente-epaves]', JSON.stringify(summary))
  return NextResponse.json({ ok: true, at, ...summary })
}


// Les appels d'IA de ce passage sont comptés sous « cron:poll-vente-epaves » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:poll-vente-epaves' }, () => handleGET(...args))
}
