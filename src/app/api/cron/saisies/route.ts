// src/app/api/cron/saisies/route.ts
//
// Cron JOURNALIER de facturation saisie. Protégé par CRON_SECRET.
// Prépare (ou envoie, selon app_settings.saisie_auto_send) les états de frais dus.
// Olivier 2026-08-09. Cf [[project_facturation_saisie_module]].

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { runSaisieCron }     from '@/lib/missions/saisie-cron'
import { runMalGareeAvpCheck } from '@/lib/missions/mal-garee-avp'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const sb = createAdminClient()
    const summary = await runSaisieCron(sb)
    // Mal garées à J+60 en parc → confirmation AVP demandée au policier (best-effort).
    let malGaree: any = null
    try { malGaree = await runMalGareeAvpCheck(sb) }
    catch (e: any) { malGaree = { error: e?.message || String(e) }; console.error('[cron saisies] mal garée → AVP KO:', e?.message) }
    return NextResponse.json({ ok: true, ...summary, malGaree })
  } catch (err: any) {
    console.error('[cron saisies] KO:', err?.message)
    // Un cron en échec doit s'afficher à l'écran (bandeau cockpit).
    try {
      await createAdminClient().from('app_settings').upsert({
        key: 'saisie_cron_last',
        value: JSON.stringify({ at: new Date().toISOString(), ok: false, errors: [String(err?.message || err)] }),
      }, { onConflict: 'key' })
    } catch {}
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}
