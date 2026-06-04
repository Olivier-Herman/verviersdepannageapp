// src/app/api/admin/towsoft-migration/run-enrich-now/route.ts
//
// Olivier 2026-06-04 : trigger MANUEL de l enrichissement detail TowSoft.
// Utile quand le cron Vercel ne progresse pas (debug ou rattrapage).
//
// Meme logique que /api/cron/towsoft-detail-enrich mais avec auth admin user
// (pas de CRON_SECRET). Limite plus petite (15 fiches) pour ne pas timeout.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { fetchTowsoftDetail } from '@/lib/towsoft-detail'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const BATCH_LIMIT       = 15
const CONCURRENCY       = 2
const DELAY_BETWEEN_MS  = 700

export async function POST(_req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()

  const { data: rows, error: selErr } = await sb
    .from('towsoft_migration_source')
    .select('id, towsoft_num')
    .is('detail_fetched_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT)

  if (selErr) {
    return NextResponse.json({ ok: false, error: `SELECT KO : ${selErr.message}` }, { status: 500 })
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'Queue enrich vide (tout pre-enrichi)' })
  }

  let enriched = 0
  let failed   = 0
  let idx      = 0
  const errorSamples: Array<{ towsoft_num: string; error: string }> = []

  async function worker() {
    while (idx < rows!.length) {
      const row = rows![idx++]
      try {
        const detail = await fetchTowsoftDetail(row.towsoft_num)
        await sb
          .from('towsoft_migration_source')
          .update({
            detail_payload:    detail,
            detail_fetched_at: new Date().toISOString(),
            detail_error:      null,
            updated_at:        new Date().toISOString(),
          })
          .eq('id', row.id)
        enriched++
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 500)
        await sb
          .from('towsoft_migration_source')
          .update({
            detail_error: msg,
            updated_at:   new Date().toISOString(),
          })
          .eq('id', row.id)
        failed++
        if (errorSamples.length < 5) errorSamples.push({ towsoft_num: row.towsoft_num, error: msg.slice(0, 200) })
      }
      if (idx < rows!.length) {
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS))
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  const { count: remaining } = await sb
    .from('towsoft_migration_source')
    .select('id', { count: 'exact', head: true })
    .is('detail_fetched_at', null)

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    enriched,
    failed,
    remaining: remaining || 0,
    error_samples: errorSamples,
    message: enriched > 0
      ? `${enriched} fiches enrichies (${remaining} restantes)`
      : `${failed} fiches en echec — voir error_samples`,
  })
}
