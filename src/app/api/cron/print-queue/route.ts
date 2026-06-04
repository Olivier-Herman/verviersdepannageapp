// src/app/api/cron/print-queue/route.ts
//
// Cron qui retiente l impression des etiquettes en queue (status='pending').
// Schedule : toutes les 2 min (cf vercel.json).
//
// Olivier 2026-06-03 (audit J-2 W1) : resilience aux pannes PC zebra-serveur.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { tryPrintQueueEntry } from '@/lib/print/zebra-raw'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const BATCH_SIZE   = 20
const MAX_ATTEMPTS = 30  // ~1h avec retry toutes les 2 min

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()
  const nowIso = new Date().toISOString()

  // Charge les entrees a retry (pending + next_retry_at <= now + attempts < MAX)
  const { data: entries, error } = await sb
    .from('print_queue')
    .select('id, zpl, attempts, mission_id')
    .eq('status', 'pending')
    .lte('next_retry_at', nowIso)
    .lt('attempts', MAX_ATTEMPTS)
    .order('next_retry_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    console.error('[cron/print-queue] select error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!entries || entries.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'Queue vide' })
  }

  let printed = 0
  let failed  = 0
  let abandoned = 0

  for (const entry of entries) {
    const result = await tryPrintQueueEntry(entry.zpl)
    if (result.ok) {
      await sb.from('print_queue').update({
        status:     'printed',
        printed_at: new Date().toISOString(),
        attempts:   (entry.attempts || 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq('id', entry.id)
      printed++
    } else {
      const newAttempts = (entry.attempts || 0) + 1
      // Backoff exponentiel : 2min, 4min, 8min, max 30min
      const nextDelayMin = Math.min(2 * Math.pow(2, newAttempts - 1), 30)
      if (newAttempts >= MAX_ATTEMPTS) {
        // Trop d echecs : abandonne pour ne pas polluer la queue indefiniment
        await sb.from('print_queue').update({
          status:     'failed',
          attempts:   newAttempts,
          last_error: result.error || 'inconnu',
          updated_at: new Date().toISOString(),
        }).eq('id', entry.id)
        abandoned++
        console.warn(`[cron/print-queue] Entry ${entry.id} abandonnee apres ${newAttempts} tentatives`)
      } else {
        await sb.from('print_queue').update({
          attempts:      newAttempts,
          last_error:    result.error || 'inconnu',
          next_retry_at: new Date(Date.now() + nextDelayMin * 60 * 1000).toISOString(),
          updated_at:    new Date().toISOString(),
        }).eq('id', entry.id)
        failed++
      }
    }
  }

  console.log(`[cron/print-queue] processed=${entries.length} printed=${printed} failed=${failed} abandoned=${abandoned}`)
  return NextResponse.json({
    ok: true,
    processed: entries.length,
    printed,
    failed,
    abandoned,
  })
}
