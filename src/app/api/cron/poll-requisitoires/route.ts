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

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
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
    return NextResponse.json({ ok: true, ...summary, rematch, saisie })
  } catch (err: any) {
    console.error('[cron poll-requisitoires] KO:', err?.message)
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}
