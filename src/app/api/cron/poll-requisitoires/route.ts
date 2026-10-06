// src/app/api/cron/poll-requisitoires/route.ts
//
// Cron : capture périodique des réquisitoires reçus dans fourriere@.
// Protégé par CRON_SECRET (comme poll-missions). Best-effort.
//
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import { NextResponse }      from 'next/server'
import { pollRequisitoires, rematchPendingRequisitoires } from '@/lib/requisitoire/intake'
import { pollSaisieMailbox } from '@/lib/missions/saisie-mail-watch'
import { createAdminClient } from '@/lib/supabase'
import { withAiContext } from '@/lib/ai/usage'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

async function handleGET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    // 0) Mails de police arrivés dans info@ → transférés à fourriere@ (sans doublon), 06/10/2026.
    let infoForward: any = null
    try { const { forwardPoliceFromInfo } = await import('@/lib/requisitoire/info-forward'); infoForward = await forwardPoliceFromInfo() }
    catch (e: any) { infoForward = { error: e?.message || String(e) }; console.error('[cron poll-requisitoires] transfert info@ KO:', e?.message) }
    // Une panne qui dure (1 h) se voit : une notification aux superadmins, une seule fois par panne.
    {
      const { cronFailed, cronRecovered } = await import('@/lib/cron-alert')
      const { sendNotificationToRoles } = await import('@/lib/notifications/send')
      const err = infoForward?.error || (infoForward?.errors?.length ? infoForward.errors.join(' ; ') : null)
      const notify = (title: string, body: string) => sendNotificationToRoles(['superadmin'], 'cron_alert', { title, body, action_url: '/fourriere/requisitoires', data: { cron_error: 'true' } }).then(() => {})
      if (err) await cronFailed('requisitoires-info-forward', String(err), 60 * 60_000, async () => notify('⚠️ Transfert des mails de police d’info@ en panne', `Les réquisitoires et levées arrivés dans info@ ne partent plus vers la fourrière depuis une heure : ${String(err).slice(0, 160)}`))
      else await cronRecovered('requisitoires-info-forward', async () => notify('✅ Transfert des mails de police rétabli', 'Les mails de police d’info@ repartent vers la fourrière.'))
    }
    // 1) Capture des nouveaux emails (+ auto-attache immédiate si match).
    const summary = await pollRequisitoires({ top: 25 })
    // 2) Re-scan de TOUTE la file en attente : rattache les anciens dont la fiche
    //    VD Soft est apparue entre-temps (réquisitoire arrivé avant la fiche).
    const rematch = await rematchPendingRequisitoires()
    // 3) Veille saisie sur la même boîte : statuts JustInvoice (liquidation →
    //    facture Odoo) + retours signés du Parquet par courriel. Best-effort.
    let saisie: any = null
    try { saisie = await pollSaisieMailbox(createAdminClient()) }
    catch (e: any) { saisie = { error: e?.message || String(e) }; console.error('[cron poll-requisitoires] veille saisie KO:', e?.message) }
    return NextResponse.json({ ok: true, ...summary, rematch, saisie, infoForward })
  } catch (err: any) {
    console.error('[cron poll-requisitoires] KO:', err?.message)
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}


// Les appels d'IA de ce passage sont comptés sous « cron:poll-requisitoires » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:poll-requisitoires' }, () => handleGET(...args))
}
