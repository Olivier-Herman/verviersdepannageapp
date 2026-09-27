// worker/index.ts
//
// WORKER PERSISTANT — tourne sur le VPS (Docker), pas sur Vercel. Olivier 27/09/2026.
//
// Il ne décide rien : il prend les demandes que Vercel a posées dans
// worker_jobs, exécute le MÊME code que l'app (src/lib/…) avec un vrai Chrome
// et sans limite de temps, puis écrit le résultat. Il se signale toutes les
// 30 s (app_settings.worker_vps_heartbeat) ; s'il se tait, Vercel reprend le
// travail lui-même — rien ne dépend de cette machine.
//
// Une demande à la fois : le compte VAB est partagé, deux navigateurs dessus
// cassent la session des deux côtés.
//
// Lancement : `npm run worker` (tsx, chemins @/ résolus via tsconfig.json).
// Variables : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAB_EMAIL,
// VAB_PASSWORD (+ PUPPETEER_ARGS="--no-sandbox" en Docker, cf worker/README.md).

import os from 'node:os'
import { createClient } from '@supabase/supabase-js'

const VERSION      = process.env.WORKER_VERSION || 'dev'
const HOST         = process.env.WORKER_NAME || os.hostname()
const KINDS        = ['vab_close']
const POLL_MS      = 20_000
const HEARTBEAT_MS = 30_000
const JOB_MAX_MS   = 12 * 60 * 1000
/** Après un passage « local » de Vercel, on laisse la place : pas deux Chromium sur VAB. */
const VERCEL_LOCAL_GUARD_MS = 6 * 60 * 1000

for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAB_EMAIL', 'VAB_PASSWORD']) {
  if (!process.env[k]) { console.error(`[worker] variable manquante : ${k}`); process.exit(1) }
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let busy: string | null = null
let stopping = false
const log = (msg: string) => console.log(`[worker ${new Date().toISOString()}] ${msg}`)

async function heartbeat() {
  try {
    await sb.from('app_settings').upsert(
      { key: 'worker_vps_heartbeat', value: JSON.stringify({ at: new Date().toISOString(), host: HOST, version: VERSION, busy }), updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
  } catch (e: any) { log(`heartbeat KO : ${e?.message || e}`) }
}

/** Vercel vient-il de clôturer lui-même (worker jugé mort) ? Alors on attend. */
async function vercelWorkingLocally(): Promise<boolean> {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'vab_close_retry_last_run').maybeSingle()
    const v = JSON.parse(String((data as any)?.value || '{}'))
    if (v?.mode !== 'local' || !v?.at) return false
    return Date.now() - Date.parse(v.at) < VERCEL_LOCAL_GUARD_MS
  } catch { return false }
}

async function claim(): Promise<any | null> {
  const { data, error } = await sb.rpc('worker_claim_job', { p_kinds: KINDS, p_worker: HOST })
  if (error) { log(`claim KO : ${error.message}`); return null }
  const rows = Array.isArray(data) ? data : (data ? [data] : [])
  return rows[0] || null
}

async function finish(job: any, ok: boolean, result: Record<string, unknown>, error?: string) {
  const now = new Date().toISOString()
  await sb.from('worker_jobs').update({
    status: ok ? 'done' : 'failed', result, error: error ?? null, finished_at: now, updated_at: now,
  }).eq('id', job.id)
}

async function runVabClose(job: any) {
  const { missionId, externalId, actorId } = job.payload || {}
  if (!missionId || !externalId) throw new Error('payload incomplet (missionId, externalId)')
  const { runVabTowClose } = await import('@/lib/cloture/transform/vab')
  const t0 = Date.now()
  await runVabTowClose({ missionId, externalId, actorId: actorId ?? null })
  // Le code de clôture trace tout dans mission_logs ; ici on ne constate que
  // l'essentiel : la fiche porte-t-elle vab_closed_at ?
  const { data: f } = await sb.from('incoming_missions').select('vab_closed_at, vehicle_plate').eq('id', missionId).maybeSingle()
  const closed = !!(f as any)?.vab_closed_at
  return { ok: closed, result: { closed, plate: (f as any)?.vehicle_plate || null, seconds: Math.round((Date.now() - t0) / 1000) } }
}

async function runJob(job: any) {
  busy = job.id
  log(`▶ ${job.kind} ${job.dedupe_key || job.id} (essai ${job.attempts})`)
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`délai dépassé (${JOB_MAX_MS / 60000} min)`)), JOB_MAX_MS))
  try {
    const out = await Promise.race([job.kind === 'vab_close' ? runVabClose(job) : Promise.reject(new Error(`type inconnu : ${job.kind}`)), timeout])
    await finish(job, out.ok, out.result, out.ok ? undefined : 'non soldé chez VAB — détail dans mission_logs')
    log(`${out.ok ? '✔' : '✖'} ${job.dedupe_key || job.id} ${JSON.stringify(out.result)}`)
  } catch (e: any) {
    await finish(job, false, {}, e?.message || String(e))
    log(`✖ ${job.dedupe_key || job.id} : ${e?.message || e}`)
  } finally {
    busy = null
    await heartbeat()
  }
}

async function main() {
  log(`démarrage — hôte ${HOST}, version ${VERSION}, types ${KINDS.join(', ')}`)
  await heartbeat()
  setInterval(heartbeat, HEARTBEAT_MS).unref()
  process.on('SIGTERM', () => { stopping = true; log('SIGTERM : on termine la demande en cours puis on sort') })
  process.on('SIGINT',  () => { stopping = true; log('SIGINT : on termine la demande en cours puis on sort') })

  while (!stopping) {
    try {
      if (await vercelWorkingLocally()) {
        log('Vercel clôture lui-même en ce moment : on attend')
      } else {
        const job = await claim()
        if (job) { await runJob(job); continue }   // enchaîne sans attendre s'il y en a d'autres
      }
    } catch (e: any) { log(`boucle : ${e?.message || e}`) }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
  log('arrêt propre')
  process.exit(0)
}

main().catch(e => { console.error('[worker] fatal', e); process.exit(1) })
