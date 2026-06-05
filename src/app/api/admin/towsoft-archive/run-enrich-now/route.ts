// src/app/api/admin/towsoft-archive/run-enrich-now/route.ts
//
// POST /api/admin/towsoft-archive/run-enrich-now
// Body: { batch_size?: number } (default 60)
//
// Olivier 2026-06-05 : trigger manuel d enrichissement archive TowSoft.
// Pas de cron : on passe par bouton "Rattraper tout" dans l UI admin
// qui boucle avec interval 3 min (60 missions / 3 min = ~1,5 jour pour 47k).
//
// Reutilise fetchTowsoftDetail (5 endpoints scrape) qui marche deja sur
// la migration fourriere.

import { NextResponse }       from 'next/server'
import { getServerSession }   from 'next-auth'
import { authOptions }        from '@/lib/auth'
import { createAdminClient }  from '@/lib/supabase'
import { fetchTowsoftDetail } from '@/lib/towsoft-detail'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300  // 5 min max (Vercel Pro)

const DEFAULT_BATCH    = 60
const CONCURRENCY      = 2
const DELAY_BETWEEN_MS = 700
const MAX_ATTEMPTS     = 5

// Statuts TowSoft consideres comme "annule" (a affiner via Olivier).
// Pour l instant on stocke avec flag is_cancelled=true, on filtre cote UI.
const CANCELLED_APPEL_STATUSES = new Set<string>(['0', '7', '8'])  // hypothese a verifier

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden — admin/superadmin uniquement' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const batchSize = Math.min(Math.max(parseInt(body.batch_size, 10) || DEFAULT_BATCH, 1), 100)

  const sb = createAdminClient()
  const nowIso = new Date().toISOString()

  // Selection des prochaines missions a enrichir : pas encore fetch + pas en retry actif
  const { data: rows, error: selErr } = await sb
    .from('towsoft_archive')
    .select('id, towsoft_num, enrich_attempts')
    .is('detail_fetched_at', null)
    .lt('enrich_attempts', MAX_ATTEMPTS)
    .or(`next_enrich_retry_at.is.null,next_enrich_retry_at.lte.${nowIso}`)
    .order('towsoft_num', { ascending: true })
    .limit(batchSize)

  if (selErr) {
    return NextResponse.json({ error: `SELECT KO : ${selErr.message}` }, { status: 500 })
  }
  if (!rows || rows.length === 0) {
    const { count: remaining } = await sb
      .from('towsoft_archive')
      .select('id', { count: 'exact', head: true })
      .is('detail_fetched_at', null)
    return NextResponse.json({
      ok: true,
      processed: 0,
      enriched:  0,
      failed:    0,
      remaining: remaining || 0,
      message:   `Rien à enrichir (queue vide ou tous en retry trop tot). Reste ${remaining || 0} a faire.`,
    })
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
        const status = detail.appel_status || null
        const isCancelled = status ? CANCELLED_APPEL_STATUSES.has(status) : false

        // Date TowSoft : detail.date_appel est au format "YYYY-MM-DD HH:mm:ss"
        // On essaie de la convertir en TIMESTAMPTZ (sinon null)
        let dateAppelTz: string | null = null
        if (detail.date_appel) {
          const d = new Date(detail.date_appel.replace(' ', 'T') + '+01:00')
          if (!isNaN(d.getTime())) dateAppelTz = d.toISOString()
        }

        await sb
          .from('towsoft_archive')
          .update({
            detail_payload:    detail,
            detail_fetched_at: new Date().toISOString(),
            detail_error:      null,
            plate:             detail.immatriculation || null,
            vin:               detail.vin || null,
            brand:             detail.marque || null,
            model:             detail.modele || null,
            motif:             detail.motif_parc || detail.nature || null,
            client_name:       detail.client_name || null,
            date_appel:        dateAppelTz,
            appel_status:      status,
            is_cancelled:      isCancelled,
            updated_at:        new Date().toISOString(),
          })
          .eq('id', row.id)
        enriched++
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 500)
        const newAttempts = (row.enrich_attempts || 0) + 1
        // Backoff exponentiel : 5min → 10min → 20min → 40min → max 1h
        const nextDelayMin = Math.min(5 * Math.pow(2, newAttempts - 1), 60)
        await sb
          .from('towsoft_archive')
          .update({
            enrich_attempts:      newAttempts,
            enrich_error:         msg.slice(0, 500),
            next_enrich_retry_at: new Date(Date.now() + nextDelayMin * 60 * 1000).toISOString(),
            updated_at:           new Date().toISOString(),
          })
          .eq('id', row.id)
        failed++
        if (errorSamples.length < 5) errorSamples.push({ towsoft_num: row.towsoft_num, error: msg.slice(0, 200) })
      }
      if (idx < rows!.length) await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS))
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  const { count: remaining } = await sb
    .from('towsoft_archive')
    .select('id', { count: 'exact', head: true })
    .is('detail_fetched_at', null)

  return NextResponse.json({
    ok:        true,
    processed: rows.length,
    enriched,
    failed,
    remaining: remaining || 0,
    error_samples: errorSamples,
    message: enriched > 0
      ? `${enriched} missions enrichies (${remaining} restantes)`
      : `${failed} en echec — voir error_samples`,
  })
}
