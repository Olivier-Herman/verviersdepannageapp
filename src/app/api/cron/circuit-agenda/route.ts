// src/app/api/cron/circuit-agenda/route.ts — prestations du Circuit dans les agendas Outlook d'info@ et de Mobi
// (Olivier 28/10/2026). Toutes les heures ; une boîte non connectée ou un accès perdu est signalé une fois par jour
// sur Telegram (refaire la connexion par code d'appareil). Logique : lib/circuit/agenda.ts.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { syncAgendasCircuit } from '@/lib/circuit/agenda'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  { const { assistantEnPause, SKIP_PAUSE } = await import('@/lib/facturation/suspension'); if (await assistantEnPause(createAdminClient(), 'circuit')) return NextResponse.json(SKIP_PAUSE) }   // « Mes assistants » (Olivier 28/10/2026)
  const sb = createAdminClient()
  const res = await syncAgendasCircuit()
  const erreurs = Object.entries(res).filter(([, v]: any) => v?.erreur).map(([k, v]: any) => `${k} : ${v.erreur}`)
  await sb.from('app_settings').upsert({ key: 'circuit_agenda_last_run', value: JSON.stringify({ at: new Date().toISOString(), ...res }) }, { onConflict: 'key' }).then(() => {}, () => {})
  if (erreurs.length) {
    const jour = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
    const { data: deja } = await sb.from('app_settings').select('value').eq('key', 'circuit_agenda_alerte_jour').maybeSingle()
    if (String(deja?.value || '').replace(/"/g, '') !== jour) {
      try {
        const { getBusinessNumber } = await import('@/lib/settings/business')
        const { notifierTelegram } = await import('@/lib/notif/heures-mobi')
        await notifierTelegram(await getBusinessNumber('telegram_chat_mobi'), `📅 Agendas du Circuit non synchronisés : ${erreurs.join(' · ')}`, [], undefined, { urgent: true })
        await sb.from('app_settings').upsert({ key: 'circuit_agenda_alerte_jour', value: JSON.stringify(jour) }, { onConflict: 'key' })
      } catch { /* l'écran garde la trace */ }
    }
  }
  return NextResponse.json({ ok: !erreurs.length, ...res }, { status: erreurs.length ? 502 : 200 })
}
