// Cron : analyse périodique du dossier mail surveillé.
// En mode 'draft' (défaut) le cron ne fait que préparer le diagnostic ;
// il n'écrit dans Odoo que si le mode 'auto' a été activé explicitement.

import { NextResponse } from 'next/server'
import { scanMailboxes } from '@/lib/mail-agent'
import { refreshAwpSenders } from '@/lib/mail-agent/handlers/awp-rejet'
import { refreshImaSenders } from '@/lib/mail-agent/handlers/ima-rejet'
import { withAiContext } from '@/lib/ai/usage'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300   // scan incrémental de toute la boîte (185 dossiers)

async function handleGET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  { const { assistantEnPause, SKIP_PAUSE } = await import('@/lib/facturation/suspension'); if (await assistantEnPause(createAdminClient(), 'agent_mail')) return NextResponse.json(SKIP_PAUSE) }   // « Mes assistants » (Olivier 28/10/2026)
  try {
    const sb = createAdminClient()
    // Justine (tri des mails d'info@ et d'administration@) travaille aux heures VD d'Olivier : lundi-jeudi 9 h-18 h
    // (26/10/2026, réglage mobi_heures_vd / son agenda). Hors créneau, les mails attendent : le retard doit se voir.
    const { mobiEnHeuresVD } = await import('@/lib/notif/heures-mobi')
    const auTravail = await mobiEnHeuresVD()
    let scan: any = { skipped: 'hors des heures VD' }, settle: any = null
    if (auTravail) {
      // Expéditeurs des rejets = réglages métier, relus à chaque passage (plus de liste codée).
      await Promise.all([refreshAwpSenders(), refreshImaSenders()])
      // Olivier 23/09/2026 : toutes les 15 min. Deux jours minimum (06/10/2026) : une facture mise en attente de sa
      // version Peppol est revérifiée 24 h plus tard. Après une absence (week-end de jeudi 18 h à lundi 9 h = 87 h),
      // on relit depuis le dernier tri : sinon les mails du vendredi passaient sous la fenêtre de deux jours.
      const { data: last } = await sb.from('app_settings').select('value').eq('key', 'mail_agent_last_scan').maybeSingle()
      let lastAt = 0; try { lastAt = Date.parse(JSON.parse(String(last?.value || '""'))) || 0 } catch { /* jamais lu */ }
      const sinceDays = Math.min(7, Math.max(2, lastAt ? Math.ceil((Date.now() - lastAt) / 86_400_000) + 1 : 2))
      scan = await scanMailboxes({ sinceDays, limit: 200 })
      await sb.from('app_settings').upsert({ key: 'mail_agent_last_scan', value: JSON.stringify(new Date().toISOString()) }, { onConflict: 'key' }).then(() => {}, () => {})
      scan = { ...scan, sinceDays }
      // Cartes réglées dans la boîte : revérifiées et fermées « Fait ailleurs » ; rejets seulement sur preuve (06/10/2026).
      try { const { settleOpenCards } = await import('@/lib/mail-agent/settle'); settle = await settleOpenCards(sb, 60) }
      catch (e: any) { settle = { error: e?.message || String(e) } }
    }
    // Olivier 08/10/2026 : mails d'une mission d'assistance acceptée → dossier habituel de l'assistance.
    // Socle des imports et du dispatch : continue à toute heure.
    let missionFiling: any = null
    try { const { fileAcceptedMissionMails } = await import('@/lib/mail-agent/mission-filing'); const r = await fileAcceptedMissionMails(createAdminClient()); missionFiling = { missions: r.missions, moved: r.moved.length, skipped: r.skipped.length } }
    catch (e: any) { missionFiling = { error: e?.message || String(e) } }
    return NextResponse.json({ ok: true, ...scan, settle, missionFiling })
  } catch (err: any) {
    console.error('[cron mail-agent] KO:', err?.message)
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}


// Les appels d'IA de ce passage sont comptés sous « cron:mail-agent » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:mail-agent' }, () => handleGET(...args))
}
