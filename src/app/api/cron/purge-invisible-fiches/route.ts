// src/app/api/cron/purge-invisible-fiches/route.ts
//
// Hebdomadaire (lundi 04:30 UTC) : annule + archive les fiches invisibles du
// dispatch (lecture du mail < 30 % ou expéditeur inconnu) jamais assignées et
// sans suite depuis 7 jours. Olivier 09/09/2026. ?dry=1 = aperçu sans écriture.
// Résumé dans app_settings.purge_invisible_last_run + push admin quand il y a eu
// des annulations (un cron ne doit jamais travailler en silence).

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextResponse }        from 'next/server'
import { createAdminClient }   from '@/lib/supabase'
import { sendPushToRole }      from '@/lib/push'
import { purgeInvisibleFiches } from '@/lib/missions/purge-invisible'

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dryRun = new URL(req.url).searchParams.get('dry') === '1'
  const sb = createAdminClient()
  try {
    const r = await purgeInvisibleFiches({ dryRun })
    console.log('[purge-invisible-fiches]', JSON.stringify({ dryRun, scanned: r.scanned, cancelled: r.cancelled, skipped: r.skipped }))
    if (!dryRun) {
      await sb.from('app_settings').upsert({ key: 'purge_invisible_last_run', value: { ok: true, ...r, items: r.items.slice(0, 50) } }, { onConflict: 'key' }).then(() => {}, () => {})
      if (r.cancelled > 0) {
        const nums = r.items.map(i => i.mission_number != null ? `#${i.mission_number}` : '?').slice(0, 12).join(', ')
        await sendPushToRole(['admin', 'superadmin'], {
          title: `🧹 Purge hebdo : ${r.cancelled} fiche(s) invisible(s) annulée(s)`,
          body:  `${nums}${r.items.length > 12 ? '…' : ''} — sans suite depuis 7 jours, motif dans le journal de chaque fiche.`,
          url:   '/admin/settings',
          tag:   'purge-invisible-weekly',
        }).catch(() => {})
      }
    }
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    const msg = String(e?.message || e)
    console.error('[purge-invisible-fiches] KO:', msg)
    await sb.from('app_settings').upsert({ key: 'purge_invisible_last_run', value: { ok: false, at: new Date().toISOString(), error: msg } }, { onConflict: 'key' }).then(() => {}, () => {})
    await sendPushToRole(['superadmin'], { title: '⚠️ Purge hebdo en échec', body: msg.slice(0, 160), url: '/admin/diagnostics', tag: 'purge-invisible-weekly-ko' }).catch(() => {})
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
