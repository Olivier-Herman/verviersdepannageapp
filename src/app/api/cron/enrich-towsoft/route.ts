// src/app/api/cron/enrich-towsoft/route.ts
//
// Cron Vercel qui process la file d'attente d'enrichissement TowSoft.
// La queue = toutes les missions avec towsoft_enriched_at IS NULL +
// odoo_helpdesk_id non-null.
//
// A chaque tick, process 10 missions avec concurrency 1 + delai 1500ms
// (limites TowSoft 429 + Vercel 300s timeout). Pour ~320 missions a
// enrichir, faut ~32 ticks (16h a 30min/tick).
//
// Schedule recommande : toutes les 30min entre 20h-5h UTC (=22h-7h Brussels).
// Cf vercel.json -> crons section.
//
// Auth : header Authorization: Bearer CRON_SECRET (Vercel injecte ca
// automatiquement pour les requests cron).

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc, withOdooActor } from '@/lib/odoo'
import { enrichMissionFromTowsoft } from '@/lib/odoo-fourriere-flows'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

const BATCH_LIMIT      = 10
const CONCURRENCY      = 1
const DELAY_BETWEEN_MS = 1500

export async function GET(req: Request) {
  // Auth Vercel cron : Bearer token via CRON_SECRET env var
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withOdooActor(undefined, async () => {
    const sb = createAdminClient()

    const { data: missions } = await sb
      .from('incoming_missions')
      .select('id, vehicle_plate, odoo_helpdesk_id')
      .is('towsoft_enriched_at', null)
      .not('odoo_helpdesk_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(BATCH_LIMIT)

    if (!missions || missions.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, message: 'Queue vide' })
    }
    const missionsList = missions

    // Fetch tous les tickets Odoo en 1 call
    const ticketIds = Array.from(new Set(missionsList.map(m => m.odoo_helpdesk_id).filter(Boolean) as number[]))
    const tickets = await odooRpc<any[]>('helpdesk.ticket', 'read', [ticketIds], {
      fields: ['id', 'x_studio_mission_towsoft'],
    })
    const towsoftByTicket = new Map<number, string>()
    for (const t of (tickets || [])) {
      if (t.x_studio_mission_towsoft && t.x_studio_mission_towsoft !== false) {
        towsoftByTicket.set(t.id, String(t.x_studio_mission_towsoft))
      }
    }

    let enriched = 0
    let failed   = 0
    let skipped  = 0
    let idx = 0
    async function worker() {
      while (idx < missionsList.length) {
        const m = missionsList[idx++]
        const towsoftNum = towsoftByTicket.get(m.odoo_helpdesk_id!)
        if (!towsoftNum) {
          // Skip - marque comme enrichi pour ne plus le revoir
          await sb.from('incoming_missions').update({
            towsoft_enriched_at: new Date().toISOString(),
          }).eq('id', m.id)
          skipped++
          continue
        }
        const r = await enrichMissionFromTowsoft(m.id, towsoftNum)
        if (r.ok && r.updated) enriched++
        else if (!r.ok) failed++
        if (idx < missionsList.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_MS))
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

    const { count: remaining } = await sb
      .from('incoming_missions')
      .select('id', { count: 'exact', head: true })
      .is('towsoft_enriched_at', null)
      .not('odoo_helpdesk_id', 'is', null)

    console.log(`[cron enrich-towsoft] enriched=${enriched} failed=${failed} skipped=${skipped} remaining=${remaining}`)

    return NextResponse.json({
      ok: true,
      processed: missionsList.length,
      enriched,
      failed,
      skipped,
      remaining: remaining || 0,
    })
  })
}
