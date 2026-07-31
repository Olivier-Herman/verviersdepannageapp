// src/app/api/cron/normalize-vehicle-names/route.ts
//
// Normalise vehicle_brand / vehicle_model des fiches sur le catalogue Odoo
// (casse canonique ; fallback capitalisation intelligente). Cron sans param =
// fiches les plus récentes (futur). Backfill historique : superadmin appelle
// ?before=<ISO created_at> et rappelle avec le nextBefore renvoyé jusqu'à done.
// Olivier 2026-07-31.

import { NextResponse }               from 'next/server'
import { getServerSession }           from 'next-auth'
import { authOptions }                from '@/lib/auth'
import { createAdminClient }          from '@/lib/supabase'
import { normalizeMissionVehicles }   from '@/lib/fleet/normalize-mission-vehicles'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  const auth   = req.headers.get('authorization')
  const okCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  if (!okCron) {
    const session = await getServerSession(authOptions)
    if ((session?.user as any)?.role !== 'superadmin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const { searchParams } = new URL(req.url)
  const before = searchParams.get('before')          // ISO created_at (backfill)
  const batch  = parseInt(searchParams.get('batch') || '800')
  const all    = searchParams.get('all') === '1'      // dérouler tout l'historique

  const sb = createAdminClient()
  try {
    // Mode `all` : enchaîne les lots (curseur created_at) jusqu'à done ou budget
    // temps épuisé (~50 s < maxDuration). Renvoie nextBefore pour reprendre.
    if (all) {
      const deadline = Date.now() + 50_000
      let cursor: string | null = before, scanned = 0, updated = 0, done = false
      do {
        const r = await normalizeMissionVehicles(sb, { batch, beforeTs: cursor })
        scanned += r.scanned; updated += r.updated; cursor = r.nextBefore; done = r.done
      } while (!done && cursor && Date.now() < deadline)
      return NextResponse.json({ ok: true, scanned, updated, nextBefore: cursor, done })
    }
    const r = await normalizeMissionVehicles(sb, { batch, beforeTs: before })
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    console.error('[normalize-vehicle-names]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
