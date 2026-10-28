// src/app/api/cron/mobia/route.ts
//
// Mobia (Olivier 03/10/2026) : toutes les 15 min pendant ses horaires, un
// brouillon de réponse pour chaque nouveau mail du dossier « Claudy » d'info@
// (src/lib/mobia/run.ts). Horaires : ceux d'Olivier chez VD (26/10/2026 : lundi-jeudi 9 h-18 h, heure belge —
// réglage mobi_heures_vd, ou son agenda dès qu'il est lisible ; cf. lib/notif/heures-mobi). Hors horaires, rien :
// les mails arrivés pendant l'absence attendent le créneau suivant (le retard doit se voir, Olivier 26/10/2026).
// Avant : lundi-vendredi 8 h-20 h, samedi 8 h-15 h.
//   ?essai=<id ou internetMessageId> : essai sur un mail (même déjà traité),
//   sans brouillon, sans notification — renvoie le texte qui serait préparé.

import { createAdminClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { runMobia } from '@/lib/mobia/run'
import { withAiContext } from '@/lib/ai/usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handleGET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  { const { assistantEnPause, SKIP_PAUSE } = await import('@/lib/facturation/suspension'); if (await assistantEnPause(createAdminClient(), 'mobia')) return NextResponse.json(SKIP_PAUSE) }   // « Mes assistants » (Olivier 28/10/2026)
  const essai = new URL(req.url).searchParams.get('essai') || undefined
  if (!essai && !(await mobiaAuTravail())) return NextResponse.json({ ok: true, skipped: 'hors horaires' })
  // Pause décidée par Mobi (22/10/2026) : réglage « mobia_actif ».
  if (!essai) {
    const { getBusinessText } = await import('@/lib/settings/business')
    const actif = await getBusinessText('mobia_actif').catch(() => 'oui')
    if (String(actif).trim().toLowerCase() !== 'oui') return NextResponse.json({ ok: true, skipped: 'en pause' })
  }
  try {
    const r = await runMobia({ dryKey: essai })
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    console.error('[cron/mobia]', e?.message || e)
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}


// Les appels d'IA de ce passage sont comptés sous « cron:mobia » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:mobia' }, () => handleGET(...args))
}

/** Horaires de Mobia = heures VD d'Olivier (26/10/2026). */
async function mobiaAuTravail(): Promise<boolean> {
  const { mobiEnHeuresVD } = await import('@/lib/notif/heures-mobi')
  return mobiEnHeuresVD()
}
