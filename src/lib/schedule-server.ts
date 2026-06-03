// src/lib/schedule-server.ts (server-only)
//
// Olivier 2026-06-03 : lit les periodes de garde depuis BDD + cache module
// TTL 60s, puis appelle setScheduleConfig() de lib/schedule.ts.
// SERVER-ONLY : import createAdminClient → next/headers.

import { createAdminClient } from '@/lib/supabase'
import { setScheduleConfig, getScheduleConfig, type PeriodConfig } from '@/lib/schedule'

let lastLoadAt = 0
const CACHE_TTL_MS = 60_000

let loadingPromise: Promise<void> | null = null

async function loadFromDb(): Promise<void> {
  try {
    const sb = createAdminClient()
    const { data: rows } = await sb
      .from('schedule_periods')
      .select('kind, hour_start, hour_end, cross_midnight')
      .eq('active', true)
    const next = { ...getScheduleConfig() }
    for (const r of rows || []) {
      const cfg: PeriodConfig = {
        hour_start: Number(r.hour_start),
        hour_end:   Number(r.hour_end),
        cross_midnight: !!r.cross_midnight,
      }
      if (r.kind === 'day')                      next.day                = cfg
      else if (r.kind === 'night')               next.night              = cfg
      else if (r.kind === 'autodispatch_night')  next.autodispatch_night = cfg
    }
    setScheduleConfig(next)
    lastLoadAt = Date.now()
  } catch (e: any) {
    console.error('[schedule-server] load failed, garde defaults:', e?.message)
  } finally {
    loadingPromise = null
  }
}

/** A appeler en debut de handler API qui utilise isInDaySchedule/isInNightSchedule/isAutoDispatchNight.
 *  Refresh cache si > TTL. No-op si recent. */
export async function ensureScheduleLoaded(): Promise<void> {
  if (Date.now() - lastLoadAt < CACHE_TTL_MS) return
  if (loadingPromise) return loadingPromise
  loadingPromise = loadFromDb()
  await loadingPromise
}

/** Force reload (apres modification admin). */
export async function reloadScheduleCache(): Promise<void> {
  lastLoadAt = 0
  await ensureScheduleLoaded()
}
