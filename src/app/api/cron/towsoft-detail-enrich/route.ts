// src/app/api/cron/towsoft-detail-enrich/route.ts
//
// Olivier 2026-06-04 : pre-enrichissement des 733 fiches TowSoft en background.
// Schedule : toutes les 5 min (cf vercel.json).
//
// Process : selectionne 30 fiches dont detail_fetched_at IS NULL, fetch les
// 5 endpoints sequentiellement (concurrency 2 pour ne pas saturer TowSoft 429),
// stocke detail_payload + marque detail_fetched_at = now().
//
// 733 fiches / 30 par run / 5 min = ~25 runs = ~2h. Donc tout enrichi en 2h
// apres init. Acceptable pour une migration ponctuelle.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { fetchTowsoftDetail } from '@/lib/towsoft-detail'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300  // 5 min max (Vercel Pro)

const BATCH_LIMIT       = 30
const CONCURRENCY       = 2
const DELAY_BETWEEN_MS  = 700

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()

  // Olivier 2026-06-04 : order by id ASC (deterministe avec UUID) au lieu
  // de created_at qui est IDENTIQUE pour les 733 lignes (UPSERT batch a l init).
  // Le filtre .is('detail_fetched_at', null) reste la veritable protection.
  const { data: rows, error: selErr } = await sb
    .from('towsoft_migration_source')
    .select('id, towsoft_num, detail_fetched_at')
    .is('detail_fetched_at', null)
    .order('id', { ascending: true })
    .limit(BATCH_LIMIT)

  if (selErr) {
    console.error('[cron/towsoft-detail-enrich] SELECT KO:', selErr.message)
    return NextResponse.json({ error: selErr.message }, { status: 500 })
  }

  // Diagnostic : log si on a re-tape des fiches deja enrichies (bug filter)
  const alreadyEnriched = rows?.filter(r => r.detail_fetched_at != null).length || 0
  if (alreadyEnriched > 0) {
    console.error(`[cron/towsoft-detail-enrich] ANOMALIE: SELECT .is('detail_fetched_at', null) a renvoye ${alreadyEnriched} fiches DEJA enrichies !`)
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'Queue enrich vide (tout pre-enrichi)' })
  }

  let enriched      = 0
  let failed        = 0
  let updateGhosts  = 0  // UPDATE qui ne lève pas mais n'écrit rien (diagnostic)
  let idx           = 0

  async function worker() {
    while (idx < rows!.length) {
      const row = rows![idx++]
      try {
        const detail = await fetchTowsoftDetail(row.towsoft_num)
        const nowIso = new Date().toISOString()
        const { data: upData, error: upErr } = await sb
          .from('towsoft_migration_source')
          .update({
            detail_payload:    detail,
            detail_fetched_at: nowIso,
            detail_error:      null,
            updated_at:        nowIso,
          })
          .eq('id', row.id)
          .select('id, detail_fetched_at')
        if (upErr) {
          throw new Error(`UPDATE KO : ${upErr.message}`)
        }
        if (!upData || upData.length === 0) {
          // Pas d erreur mais 0 rows touchees -> diagnostic du bug fantome
          updateGhosts++
          console.error(`[cron/towsoft-detail-enrich] GHOST UPDATE id=${row.id} num=${row.towsoft_num} - 0 rows affected`)
        } else {
          enriched++
        }
      } catch (e: any) {
        await sb
          .from('towsoft_migration_source')
          .update({
            // On garde detail_fetched_at NULL pour retry au prochain run
            detail_error:   String(e?.message || e).slice(0, 500),
            updated_at:     new Date().toISOString(),
          })
          .eq('id', row.id)
        failed++
        console.warn(`[cron/towsoft-detail-enrich] ${row.towsoft_num} KO:`, e?.message)
      }
      // Anti-flood
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

  console.log(`[cron/towsoft-detail-enrich] enriched=${enriched} failed=${failed} remaining=${remaining}`)

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    enriched,
    failed,
    remaining: remaining || 0,
  })
}
