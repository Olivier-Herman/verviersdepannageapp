// src/app/api/admin/parc/enrich-batch/route.ts
//
// POST /api/admin/parc/enrich-batch?limit=50
// Enrichit en batch les missions VD Soft avec source='legacy_odoo' (= pas
// encore enrichies via TowSoft). Pour chaque mission :
//   1. Fetch le ticket Helpdesk Odoo (par odoo_helpdesk_id)
//   2. Recupere x_studio_mission_towsoft
//   3. Scrape TowSoft via Puppeteer
//   4. Update incoming_missions + tag source = 'legacy_towsoft_enriched'
//
// Permet de repasser sur les Browserless qui ont plante au scan initial.
// Olivier peut cliquer plusieurs fois jusqu a remaining=0.
//
// Concurrence : 3 missions en parallele (Browserless supporte mais cher).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc }           from '@/lib/odoo'
import { enrichMissionFromTowsoft } from '@/lib/odoo-fourriere-flows'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300  // 5 min max (Browserless ~15s * 50 = 12.5min, on bornera concurrent)

const CONCURRENCY = 3

interface EnrichResult {
  mission_id:  string
  plate:       string | null
  ok:          boolean
  updated:     boolean
  reason?:     string
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50)

  const sb = createAdminClient()

  // 1. Liste les missions a enrichir (towsoft_enriched_at IS NULL + odoo_helpdesk_id non-null)
  const { data: missions, error: e1 } = await sb
    .from('incoming_missions')
    .select('id, vehicle_plate, odoo_helpdesk_id')
    .is('towsoft_enriched_at', null)
    .not('odoo_helpdesk_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
  if (!missions || missions.length === 0) {
    // Count remaining for accurate response
    const { count } = await sb
      .from('incoming_missions')
      .select('id', { count: 'exact', head: true })
      .is('towsoft_enriched_at', null)
      .not('odoo_helpdesk_id', 'is', null)
    return NextResponse.json({ ok: true, processed: 0, remaining: count || 0, results: [] })
  }

  // 2. Resolve x_studio_mission_towsoft pour tous les tickets en un seul appel Odoo
  const ticketIds = Array.from(new Set(missions.map(m => m.odoo_helpdesk_id).filter(Boolean) as number[]))
  const tickets = await odooRpc<any[]>('helpdesk.ticket', 'read', [ticketIds], {
    fields: ['id', 'x_studio_mission_towsoft'],
  })
  const towsoftByTicket = new Map<number, string>()
  for (const t of (tickets || [])) {
    if (t.x_studio_mission_towsoft && t.x_studio_mission_towsoft !== false) {
      towsoftByTicket.set(t.id, String(t.x_studio_mission_towsoft))
    }
  }

  // 3. Enrichir par batch concurrent
  const results: EnrichResult[] = []
  const missionsList = missions || []
  let idx = 0
  async function worker() {
    while (idx < missionsList.length) {
      const m = missionsList[idx++]
      const towsoftNum = towsoftByTicket.get(m.odoo_helpdesk_id!)
      if (!towsoftNum) {
        results.push({
          mission_id: m.id,
          plate: m.vehicle_plate,
          ok: false,
          updated: false,
          reason: 'pas de x_studio_mission_towsoft sur le ticket Odoo',
        })
        continue
      }
      const r = await enrichMissionFromTowsoft(m.id, towsoftNum)
      results.push({
        mission_id: m.id,
        plate: m.vehicle_plate,
        ok: r.ok,
        updated: r.updated,
        reason: r.reason,
      })
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  // 4. Count remaining
  const { count } = await sb
    .from('incoming_missions')
    .select('id', { count: 'exact', head: true })
    .is('towsoft_enriched_at', null)
    .not('odoo_helpdesk_id', 'is', null)

  const enriched = results.filter(r => r.ok && r.updated).length
  const failed   = results.filter(r => !r.ok).length

  return NextResponse.json({
    ok: true,
    processed: results.length,
    enriched,
    failed,
    remaining: count || 0,
    results,
  })
}
