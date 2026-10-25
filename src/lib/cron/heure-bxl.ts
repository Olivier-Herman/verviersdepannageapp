// src/lib/cron/heure-bxl.ts — tâche planifiée à une heure de BRUXELLES (changement d'heure, 25/10/2026).
// Vercel planifie en UTC : une tâche voulue à 8 h belges est donc programmée deux fois (6 h et 7 h UTC) et ne
// travaille que lorsque l'heure de Bruxelles est la bonne, une seule fois par jour et par heure voulue
// (même méthode que le rapport de nuit). « ?force=1 » contourne la garde pour un lancement à la main.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export function heureBxl(d = new Date()): { jour: string; heure: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]))
  return { jour: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour) }
}

/** null = on travaille ; sinon la réponse « passé » à renvoyer tout de suite. */
export async function gardeHeureBxl(req: Request, cle: string, heures: number[]): Promise<NextResponse | null> {
  if (new URL(req.url).searchParams.get('force') === '1') return null
  const { jour, heure } = heureBxl()
  if (!heures.includes(heure)) return NextResponse.json({ ok: true, skipped: `pas ${heures.join(' h / ')} h à Bruxelles (il est ${heure} h)` })
  const sb = createAdminClient()
  const key = `cron_fait_${cle}`
  const marque = `${jour}-${heure}`
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (String(data?.value || '').includes(marque)) return NextResponse.json({ ok: true, skipped: 'déjà fait pour ce créneau' })
  await sb.from('app_settings').upsert({ key, value: JSON.stringify(marque), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return null
}
