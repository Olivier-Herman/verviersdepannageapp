// src/app/api/cron/night-report/route.ts
//
// Rapport du matin de la garde de nuit (Olivier 30/09/2026) : chaque jour à 8 h
// (heure belge), bilan de la nuit (18 h → 8 h) envoyé aux destinataires du réglage
// « Garde de nuit — destinataires du rapport du matin ». Vercel planifie en UTC :
// le cron tourne à 6 h et 7 h UTC, on n'envoie qu'à 8 h à Bruxelles (été comme
// hiver), une seule fois par jour. ?force=1 (avec le secret) pour renvoyer.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }       from '@/lib/supabase'
import { getBusinessList }         from '@/lib/settings/business'
import { sendEmail }               from '@/lib/emails'
import { loadNightStats, renderNightReportHtml } from '@/lib/missions/night-report'
import { sendNotificationToRoles } from '@/lib/notifications/send'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const force = req.nextUrl.searchParams.get('force') === '1'
  const now = new Date()
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]))
  const today = `${parts.year}-${parts.month}-${parts.day}`
  if (!force && Number(parts.hour) !== 8) return NextResponse.json({ ok: true, skipped: 'pas 8 h à Bruxelles' })

  const sb = createAdminClient()
  const { data: last } = await sb.from('app_settings').select('value').eq('key', 'rapport_garde_nuit_dernier_envoi').maybeSingle()
  if (!force && String(last?.value || '').includes(today)) return NextResponse.json({ ok: true, skipped: 'déjà envoyé aujourd’hui' })

  try {
    const since = new Date(now.getTime() - 14 * 3600_000).toISOString()   // 18 h → 8 h
    const stats = await loadNightStats(since, now.toISOString())
    const nightLabel = new Date(now.getTime() - 86400_000).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })
    const title = `Garde de nuit du ${nightLabel}`
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
    const to = await getBusinessList('rapport_garde_nuit_destinataires')
    for (const email of to) await sendEmail(email, `🌙 ${title}`, renderNightReportHtml(stats, title, appUrl))
    await sb.from('app_settings').upsert({ key: 'rapport_garde_nuit_dernier_envoi', value: JSON.stringify(today), updated_at: now.toISOString() }, { onConflict: 'key' })
    return NextResponse.json({ ok: true, sent: to.length, empty: stats.empty })
  } catch (e: any) {
    // Un cron en échec doit se voir : notif aux superadmins.
    console.error('[cron/night-report]', e?.message)
    await sendNotificationToRoles(['superadmin'], 'market_proposal_update', {
      title: '⚠️ Rapport de la garde de nuit non envoyé',
      body:  String(e?.message || 'erreur').slice(0, 180),
      action_url: '/admin/garde-nuit',
    }).catch(() => {})
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}
