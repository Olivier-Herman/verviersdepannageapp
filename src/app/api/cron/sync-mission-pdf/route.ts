// src/app/api/cron/sync-mission-pdf/route.ts
//
// Cron quotidien : re-essaie les attachements PDF mission qui n'ont pas
// abouti (helpdesk/vehicle manquant) pour les missions completed
// recentes (< 30j) avec pdf_attach_attempts < 5.
//
// Olivier 2026-06-10 : la cible invoice (account.move) est supprimee —
// le rapport attache a la facture polluait l'export comptable.
//
// L'orchestrateur attachMissionPdf est deja idempotent : il skip les
// targets deja set. Le cron se contente d'iterer sur les candidats.

export const dynamic     = 'force-dynamic'
export const maxDuration = 300   // 5 min : laisse le temps de batch

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { attachMissionPdf }  from '@/lib/missions/attach-mission-pdf'

const RECENT_DAYS  = 30
const BATCH_LIMIT  = 30   // limite stricte par execution pour ne pas timeout
const MAX_ATTEMPTS = 5

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()
  const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Candidats : completed depuis < 30j, attempts < 5, au moins 1 target manquant
  const { data: candidates, error } = await sb
    .from('incoming_missions')
    .select('id, external_id, odoo_helpdesk_id, odoo_vehicle_id, pdf_attached_helpdesk_at, pdf_attached_vehicle_at, pdf_attach_attempts')
    .eq('status', 'completed')
    .gte('completed_at', cutoff)
    .lt('pdf_attach_attempts', MAX_ATTEMPTS)
    .is('archived_at', null)
    .limit(BATCH_LIMIT)
  if (error) {
    console.error('[cron sync-mission-pdf]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const pending = (candidates || []).filter(m => {
    const hMiss = m.odoo_helpdesk_id && !m.pdf_attached_helpdesk_at
    const vMiss = m.odoo_vehicle_id  && !m.pdf_attached_vehicle_at
    return hMiss || vMiss
  })

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, candidates: candidates?.length || 0, processed: 0 })
  }

  let success = 0
  let failed  = 0
  const results: Array<{ id: string; attached: string[]; errors: string[] }> = []

  for (const m of pending) {
    try {
      const r = await attachMissionPdf(m.id)
      results.push({ id: m.id, attached: r.attached, errors: r.errors })
      if (r.errors.length === 0) success++; else failed++
    } catch (e: any) {
      results.push({ id: m.id, attached: [], errors: [e.message] })
      failed++
    }
  }

  console.log(`[cron sync-mission-pdf] processed=${pending.length} success=${success} failed=${failed}`)

  return NextResponse.json({
    ok: true,
    candidates: candidates?.length || 0,
    processed:  pending.length,
    success,
    failed,
    results,
  })
}
