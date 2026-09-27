// src/lib/worker/queue.ts
//
// File de travaux du WORKER PERSISTANT (VPS). Olivier 27/09/2026.
//
// Côté Vercel, on ne fait que POSER des demandes et LIRE l'état. L'exécution
// est au worker (worker/index.ts), qui tourne avec un vrai Chrome et sans
// limite de temps. Règle : Vercel reste maître de la décision (quoi clôturer),
// le worker n'est que le bras.
//
// Le worker se signale toutes les 30 s dans app_settings.worker_vps_heartbeat.
// Silence de plus de HEARTBEAT_MAX_MS = mort : l'appelant reprend le travail
// lui-même, comme avant le worker. C'est ce repli qui garantit que rien ne
// dépend du VPS.

import type { SupabaseClient } from '@supabase/supabase-js'

export const HEARTBEAT_KEY    = 'worker_vps_heartbeat'
export const HEARTBEAT_MAX_MS = 2 * 60 * 1000
/** Une demande « en cours » depuis plus longtemps = worker tombé en pleine tâche. */
export const RUNNING_MAX_MS   = 15 * 60 * 1000

export type WorkerJobKind = 'vab_close'

export interface WorkerHeartbeat {
  alive:   boolean
  at:      string | null
  host:    string | null
  version: string | null
  busy:    string | null   // id de la demande en cours, s'il y en a une
  ageMs:   number | null
}

/** Le worker bat-il encore ? (lecture seule) */
export async function workerHeartbeat(sb: SupabaseClient): Promise<WorkerHeartbeat> {
  const none: WorkerHeartbeat = { alive: false, at: null, host: null, version: null, busy: null, ageMs: null }
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', HEARTBEAT_KEY).maybeSingle()
    if (!data?.value) return none
    const v = JSON.parse(String((data as any).value) || '{}')   // app_settings.value = TEXTE JSON
    if (!v?.at) return none
    const ageMs = Date.now() - Date.parse(v.at)
    return {
      alive: Number.isFinite(ageMs) && ageMs >= 0 && ageMs < HEARTBEAT_MAX_MS,
      at: v.at, host: v.host || null, version: v.version || null, busy: v.busy || null, ageMs,
    }
  } catch { return none }
}

export interface EnqueueInput {
  kind:       WorkerJobKind
  dedupeKey:  string
  missionId?: string | null
  payload:    Record<string, unknown>
  createdBy?: string
}

/**
 * Pose une demande. S'il en existe déjà une vivante (en file ou en cours) pour
 * la même clé, on ne double pas : on renvoie « déjà en file ».
 */
export async function enqueueJob(sb: SupabaseClient, input: EnqueueInput): Promise<{ id: string | null; queued: boolean; existing: boolean }> {
  const { data, error } = await sb.from('worker_jobs').insert({
    kind: input.kind, dedupe_key: input.dedupeKey, mission_id: input.missionId ?? null,
    payload: input.payload, created_by: input.createdBy ?? null,
  }).select('id').single()
  if (!error) return { id: (data as any).id, queued: true, existing: false }
  // 23505 = violation d'unicité (uq_worker_jobs_live_dedupe) : déjà en file.
  if ((error as any).code === '23505') {
    const { data: ex } = await sb.from('worker_jobs').select('id').eq('dedupe_key', input.dedupeKey).in('status', ['queued', 'running']).maybeSingle()
    return { id: (ex as any)?.id || null, queued: false, existing: true }
  }
  throw new Error(`worker_jobs insert : ${error.message}`)
}

/**
 * Le worker est mort : ce qu'il n'a pas pris ne sera pas pris, ce qu'il avait
 * en main est perdu. On solde ces demandes pour que, s'il revient, il ne
 * rejoue pas un travail que Vercel a repris entre-temps.
 */
export async function reclaimForLocal(sb: SupabaseClient, kind: WorkerJobKind): Promise<{ cancelled: number; lost: number }> {
  const now = new Date().toISOString()
  const { data: c } = await sb.from('worker_jobs')
    .update({ status: 'cancelled', error: 'worker silencieux : repris par Vercel', finished_at: now, updated_at: now })
    .eq('kind', kind).eq('status', 'queued').select('id')
  const { data: l } = await sb.from('worker_jobs')
    .update({ status: 'failed', error: 'worker tombé pendant l’exécution', finished_at: now, updated_at: now })
    .eq('kind', kind).eq('status', 'running')
    .lt('locked_at', new Date(Date.now() - RUNNING_MAX_MS).toISOString()).select('id')
  return { cancelled: (c || []).length, lost: (l || []).length }
}

/** État de la file, pour l'écran de diagnostic. */
export async function queueSnapshot(sb: SupabaseClient, limit = 15) {
  const { data: rows } = await sb.from('worker_jobs')
    .select('id, kind, status, dedupe_key, mission_id, attempts, error, result, locked_by, created_at, locked_at, finished_at')
    .order('created_at', { ascending: false }).limit(limit)
  const counts: Record<string, number> = {}
  const { data: live } = await sb.from('worker_jobs').select('status').in('status', ['queued', 'running'])
  for (const r of (live || []) as any[]) counts[r.status] = (counts[r.status] || 0) + 1
  return { counts, recent: rows || [] }
}
