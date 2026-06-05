// src/app/api/admin/towsoft-archive/init/route.ts
//
// POST /api/admin/towsoft-archive/init
// Body: { from?: number, to?: number }
//
// Initialise la table towsoft_archive avec une range de towsoft_num
// (defaut 10000 → 57700). Idempotent : INSERT ON CONFLICT DO NOTHING.
// Skip les towsoft_num deja presents dans towsoft_migration_source
// (parc actuel, pas a re-enrichir).
//
// Olivier 2026-06-05.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const DEFAULT_FROM = 10000
const DEFAULT_TO   = 57700

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden — admin/superadmin uniquement' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const from = Number.isInteger(body.from) ? Number(body.from) : DEFAULT_FROM
  const to   = Number.isInteger(body.to)   ? Number(body.to)   : DEFAULT_TO

  if (from < 1 || to < from || (to - from) > 100000) {
    return NextResponse.json({ error: 'Range invalide (1 < from <= to, max 100k)' }, { status: 400 })
  }

  const sb = createAdminClient()

  // 1. Skip set : numeros deja dans towsoft_migration_source (parc actuel)
  const { data: alreadyMigrated } = await sb
    .from('towsoft_migration_source')
    .select('towsoft_num')
  const skipSet = new Set((alreadyMigrated || []).map((r: any) => String(r.towsoft_num)))

  // 2. Genere les rows par batch de 1000 (UPSERT idempotent)
  let totalInserted = 0
  let totalSkipped  = 0
  const BATCH = 1000

  for (let start = from; start <= to; start += BATCH) {
    const end = Math.min(start + BATCH - 1, to)
    const payload: any[] = []
    for (let n = start; n <= end; n++) {
      const numStr = String(n)
      if (skipSet.has(numStr)) {
        totalSkipped++
        continue
      }
      payload.push({ towsoft_num: numStr })
    }
    if (payload.length === 0) continue

    const { error: upErr, count } = await sb
      .from('towsoft_archive')
      .upsert(payload, { onConflict: 'towsoft_num', ignoreDuplicates: true, count: 'exact' })

    if (upErr) {
      console.error('[towsoft-archive/init] batch upsert KO:', upErr.message)
      return NextResponse.json({
        error: `Batch ${start}-${end} echec : ${upErr.message}`,
        totalInserted,
      }, { status: 500 })
    }
    totalInserted += payload.length
  }

  // 3. Stats globales
  const { count: totalInTable }    = await sb.from('towsoft_archive').select('id', { count: 'exact', head: true })
  const { count: enrichedCount }   = await sb.from('towsoft_archive').select('id', { count: 'exact', head: true }).not('detail_fetched_at', 'is', null)
  const { count: pendingCount }    = await sb.from('towsoft_archive').select('id', { count: 'exact', head: true }).is('detail_fetched_at', null)

  return NextResponse.json({
    ok: true,
    range:           { from, to, expected: to - from + 1 },
    skipped_migration: totalSkipped,
    inserted:        totalInserted,
    table_stats: {
      total:    totalInTable || 0,
      enriched: enrichedCount || 0,
      pending:  pendingCount || 0,
    },
    message: `${totalInserted} rows upsertes (${totalSkipped} skippes car deja dans migration_source). Total table : ${totalInTable}, enrichi : ${enrichedCount}, en attente : ${pendingCount}.`,
  })
}
