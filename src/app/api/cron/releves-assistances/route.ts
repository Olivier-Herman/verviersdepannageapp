// src/app/api/cron/releves-assistances/route.ts — « Relevé des dossiers ouverts » des assistances, le mercredi
// (Olivier 28/10/2026 : un mercredi sur deux, une semaine vide entre deux relevés). Logique : lib/facturation/releves.ts.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { envoyerReleves } from '@/lib/facturation/releves'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const res = await envoyerReleves()
  await createAdminClient().from('app_settings').upsert({ key: 'releves_assistances_last_run', value: JSON.stringify({ at: new Date().toISOString(), ...res }) }, { onConflict: 'key' }).then(() => {}, () => {})
  return NextResponse.json({ ok: !res.erreurs.length, ...res })
}
