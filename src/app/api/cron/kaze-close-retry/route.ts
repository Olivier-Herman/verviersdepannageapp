// Filet de clôture Kaze (Olivier 10/09/2026 : audit = 33 dossiers en attente + 11 en cours chez
// Kaze, dont 12 missions terminées chez nous depuis des semaines). Toutes les 30 min : les jobs
// encore ouverts chez Kaze (assigned / started / in_progress) dont la mission VD Soft est
// terminée sont clôturés chez eux avec nos photos et notre signature. Même esprit que
// vab-close-retry : la liste ouverte de Kaze est la seule vérité, on ne marque rien chez nous.
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { listJobs }          from '@/lib/kaze/client'
import { closeKazeJob }      from '@/lib/kaze/close-job'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const CLOSED = ['completed', 'to_invoice', 'invoiced']

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  const trace = async (payload: any) => sb.from('app_settings').upsert({ key: 'kaze_close_retry_last_run', value: JSON.stringify({ at: new Date().toISOString(), ...payload }), updated_at: new Date().toISOString() }, { onConflict: 'key' }).then(() => {}, () => {})

  let jobs: any[] = []
  try {
    for (let page = 1; page <= 5; page++) {
      const r: any = await listJobs({ statuses: ['assigned', 'started', 'in_progress'] as any, page, perPage: 100, orderField: 'updated_at', orderDirection: 'desc' })
      const rows = Array.isArray(r) ? r : (r?.data || r?.jobs || r?.items || [])
      jobs.push(...rows); if (rows.length < 100) break
    }
  } catch (e: any) {
    await trace({ ok: false, error: `Kaze injoignable : ${e?.message || e}` })
    return NextResponse.json({ ok: false, error: `Kaze : ${e?.message || e}` }, { status: 502 })
  }
  if (!jobs.length) { await trace({ ok: true, ouverts: 0, aTraiter: 0 }); return NextResponse.json({ ok: true, ouverts: 0, aTraiter: 0 }) }

  const ids = jobs.map(j => j.id)
  const { data: ms } = await sb.from('incoming_missions')
    .select('id, mission_number, kaze_job_id, status, vehicle_plate, driver_photos, client_signature')
    .in('kaze_job_id', ids).in('status', CLOSED).eq('dossier_leg', false)
  const results: any[] = []
  let done = 0
  for (const m of (ms || []).slice(0, 8)) {   // 8 par passage : chaque clôture = plusieurs appels Kaze
    const photos = Array.isArray(m.driver_photos) ? m.driver_photos.filter((u: string) => /^https?:/.test(u)) : []
    const sig = m.client_signature && /^https?:/.test(m.client_signature) ? m.client_signature : undefined
    let r: any
    try { r = await closeKazeJob(m.kaze_job_id, { driverPhotos: photos, signatureUrl: sig }) } catch (e: any) { r = { ok: false, error: e?.message || String(e), steps_done: [] } }
    if (r.ok) done++
    results.push({ mission: m.mission_number, job: String(m.kaze_job_id).slice(0, 8), ok: r.ok, status: r.status, error: r.error ?? null })
    await sb.from('mission_logs').insert({
      mission_id: m.id, action: r.ok ? 'kaze_synced' : 'kaze_sync_error',
      notes: r.ok ? `Kaze ↗ clôture rattrapée par le filet (statut ${r.status})` : `Kaze ↗ filet de clôture : échec — ${r.error || 'raison inconnue'}`,
      metadata: { filet: true, ok: r.ok, status: r.status, error: r.error ?? null },
    }).then(() => {}, () => {})
  }
  const payload = { ok: true, ouverts: jobs.length, aTraiter: (ms || []).length, clotures: done, results }
  await trace(payload)
  return NextResponse.json(payload)
}
