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
  try {
    // Expéditeurs des rejets = réglages métier, relus à chaque passage (plus de liste codée).
    await Promise.all([refreshAwpSenders(), refreshImaSenders()])
    // Olivier 23/09/2026 : toutes les 15 min. Deux jours (06/10/2026) : une facture mise en attente
    // de sa version Peppol est revérifiée 24 h plus tard, il faut donc encore la voir.
    const scan = await scanMailboxes({ sinceDays: 2, limit: 200 })
    // Cartes réglées dans la boîte : revérifiées et fermées « Fait ailleurs » ; rejets seulement sur preuve (06/10/2026).
    let settle: any = null
    try { const { settleOpenCards } = await import('@/lib/mail-agent/settle'); settle = await settleOpenCards(createAdminClient(), 60) }
    catch (e: any) { settle = { error: e?.message || String(e) } }
    // Olivier 08/10/2026 : mails d'une mission d'assistance acceptée → dossier habituel de l'assistance.
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
