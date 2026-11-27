// src/app/api/cron/especes/route.ts — inventaire des espèces à remettre (toutes les 15 min).
import { NextResponse } from 'next/server'
import { syncCashInventory } from '@/lib/especes/inventory'
import { notifyMomoDue, encodeConfirmedBacklog } from '@/lib/especes/actions'
import { pausedAndLogged } from '@/lib/agents/pause'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Les notifications à Momo ne dépendent pas de l'ERP : elles partent même pendant une pause.
  const notified = await notifyMomoDue().catch(() => 0)
  // Doubles paiements : rappels à 15 jours arrivés à échéance (07/10/2026).
  const dpReminders = await import('@/lib/doubles-paiements').then(m => m.sendDueReminders()).catch(() => 0)
  // Scrada ne dépend pas de l'ERP non plus : rattrapage des confirmations pas encore encodées.
  const backlog = await encodeConfirmedBacklog().catch((e: any) => ({ encoded: 0, errors: [String(e?.message || e)] }))
  if (await pausedAndLogged('vd-achats', 'Florent', 'Espèces à remettre')) return NextResponse.json({ ok: true, pause: true })
  try {
    const r = await syncCashInventory()
    try { await createAdminClient().from('app_settings').upsert({ key: 'especes_last_run', value: JSON.stringify({ at: new Date().toISOString(), ok: true, ...r }) }, { onConflict: 'key' }) } catch {}
    return NextResponse.json({ ok: true, notified, dpReminders, scrada: backlog, ...r })
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300)
    // Un échec doit se voir (27/11/2026 : bloqué 7 jours sans alerte) : on garde le début de la panne, et on prévient
    // une seule fois, au premier passage raté ; l'avertissement reste ensuite dans la fenêtre « Espèces ».
    try {
      const sb = createAdminClient()
      const { data } = await sb.from('app_settings').select('value').eq('key', 'especes_last_run').maybeSingle()
      let prev: any = null; try { prev = data?.value ? JSON.parse(String(data.value)) : null } catch { prev = null }
      const now = new Date().toISOString()
      const depuis = prev && prev.ok === false ? (prev.depuis || prev.at) : now
      await sb.from('app_settings').upsert({ key: 'especes_last_run', value: JSON.stringify({ at: now, depuis, ok: false, error: msg }) }, { onConflict: 'key' })
      if (!prev || prev.ok !== false) {
        const { sendNotificationToRoles } = await import('@/lib/notifications/send')
        await sendNotificationToRoles(['superadmin'], 'especes_panne', {
          title: '⚠️ Espèces : la liste n’est plus mise à jour',
          body: `Les nouveaux encaissements en espèces n’arrivent plus dans la fenêtre « Espèces » : ${msg.slice(0, 160)}`,
          action_url: '/admin/settings',
        } as any).catch(() => {})
      }
    } catch {}
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
