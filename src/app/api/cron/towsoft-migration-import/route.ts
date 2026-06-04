// src/app/api/cron/towsoft-migration-import/route.ts
//
// Olivier 2026-06-04 : worker job qui cree les missions VD Soft pour les
// fiches scannees (flag_scanned=true AND imported_at IS NULL).
//
// Schedule : toutes les 2 min (cf vercel.json). Reactif apres "Terminer la zone".
//
// Concurrency 1 (sequentiel) pour ne pas surcharger Odoo (lookup helpdesk
// + fleet.vehicle par fiche). Backoff exponentiel sur erreurs.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { processMigrationFiche } from '@/lib/towsoft-migration-worker'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

const BATCH_LIMIT  = 10
const MAX_ATTEMPTS = 10  // ~1h avec backoff exponentiel

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()
  const nowIso = new Date().toISOString()

  // Charge les fiches a importer
  const { data: pending } = await sb
    .from('towsoft_migration_source')
    .select('id, towsoft_num, plate, import_attempts')
    .eq('flag_scanned', true)
    .is('imported_at', null)
    .lt('import_attempts', MAX_ATTEMPTS)
    .or(`next_import_retry_at.is.null,next_import_retry_at.lte.${nowIso}`)
    .order('scanned_at', { ascending: true })
    .limit(BATCH_LIMIT)

  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'Queue migration vide' })
  }

  let created   = 0
  let updated   = 0
  let skipped   = 0
  let failed    = 0
  let abandoned = 0
  const details: Array<{ towsoft_num: string; plate: string | null; result: string; reason?: string }> = []

  // Sequentiel pour menager Odoo
  for (const row of pending) {
    try {
      const r = await processMigrationFiche(row.id)
      if (r.ok) {
        if (r.action === 'created') created++
        else if (r.action === 'updated') updated++
        else skipped++
        details.push({ towsoft_num: row.towsoft_num, plate: row.plate, result: r.action })
      } else {
        const newAttempts = (row.import_attempts || 0) + 1
        const nextDelayMin = Math.min(2 * Math.pow(2, newAttempts - 1), 30)
        const reason = r.reason || 'inconnu'

        if (newAttempts >= MAX_ATTEMPTS) {
          await sb.from('towsoft_migration_source').update({
            import_attempts: newAttempts,
            import_error:    `ABANDONNE apres ${newAttempts} tentatives : ${reason}`.slice(0, 500),
            updated_at:      new Date().toISOString(),
          }).eq('id', row.id)
          abandoned++
        } else {
          await sb.from('towsoft_migration_source').update({
            import_attempts:      newAttempts,
            import_error:         reason.slice(0, 500),
            next_import_retry_at: new Date(Date.now() + nextDelayMin * 60 * 1000).toISOString(),
            updated_at:           new Date().toISOString(),
          }).eq('id', row.id)
          failed++
        }
        details.push({ towsoft_num: row.towsoft_num, plate: row.plate, result: 'failed', reason })
      }
    } catch (e: any) {
      // Erreur inattendue : log + increment
      console.error(`[cron/towsoft-migration-import] ${row.towsoft_num} crash:`, e?.message)
      await sb.from('towsoft_migration_source').update({
        import_attempts:      (row.import_attempts || 0) + 1,
        import_error:         `Exception : ${e?.message || 'unknown'}`.slice(0, 500),
        next_import_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        updated_at:           new Date().toISOString(),
      }).eq('id', row.id)
      failed++
      details.push({ towsoft_num: row.towsoft_num, plate: row.plate, result: 'crash', reason: e?.message })
    }
  }

  const { count: remaining } = await sb
    .from('towsoft_migration_source')
    .select('id', { count: 'exact', head: true })
    .eq('flag_scanned', true)
    .is('imported_at', null)

  console.log(`[cron/towsoft-migration-import] created=${created} updated=${updated} skipped=${skipped} failed=${failed} abandoned=${abandoned} remaining=${remaining}`)

  return NextResponse.json({
    ok: true,
    processed: pending.length,
    created,
    updated,
    skipped,
    failed,
    abandoned,
    remaining: remaining || 0,
    details: details.slice(0, 20),
  })
}
