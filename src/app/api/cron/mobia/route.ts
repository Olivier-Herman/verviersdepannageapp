// src/app/api/cron/mobia/route.ts
//
// Mobia (Olivier 03/10/2026) : toutes les 15 min pendant ses horaires, un
// brouillon de réponse pour chaque nouveau mail du dossier « Claudy » d'info@
// (src/lib/mobia/run.ts). Horaires (heure de Bruxelles) : lundi-vendredi
// 8 h-20 h, samedi 8 h-15 h, congé le dimanche. Hors horaires, rien : les mails
// arrivés pendant l'absence sont traités à la reprise (samedi après 15 h et
// dimanche → lundi 8 h).
//   ?essai=<id ou internetMessageId> : essai sur un mail (même déjà traité),
//   sans brouillon, sans notification — renvoie le texte qui serait préparé.

import { NextResponse } from 'next/server'
import { runMobia } from '@/lib/mobia/run'
import { withAiContext } from '@/lib/ai/usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handleGET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const essai = new URL(req.url).searchParams.get('essai') || undefined
  if (!essai && !mobiaAuTravail()) return NextResponse.json({ ok: true, skipped: 'hors horaires' })
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

/** Horaires de Mobia (Olivier 03/10/2026), heure de Bruxelles. */
function mobiaAuTravail(d = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(d)
  const day = parts.find(p => p.type === 'weekday')?.value || ''
  const h = Number(parts.find(p => p.type === 'hour')?.value) % 24
  if (day === 'Sun') return false
  if (day === 'Sat') return h >= 8 && h < 15
  return h >= 8 && h < 20
}
