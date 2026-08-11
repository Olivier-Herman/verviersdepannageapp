// src/lib/cloture/queue.ts
//
// File d'attente des clôtures d'assistance (Olivier 2026-08-11) :
// « il ne faut JAMAIS qu'une application tierce nous bloque. On doit pouvoir
//   avancer, mettre en mémoire, et rattraper quand la connexion revient. »
//
// Quand la transformation échoue pour une raison TECHNIQUE (plateforme injoignable,
// session refusée, timeout), on met la clôture en file et le chauffeur continue.
// Un cron la rejoue jusqu'à ce qu'elle passe. Une erreur MÉTIER (code de fin refusé
// par l'assistance sur ce dossier) n'est PAS mise en file : la rejouer ne changerait
// rien, il faut un humain.

import { createAdminClient } from '@/lib/supabase'
import { transformTouring, parseComexKeys, type TransformInput } from './transform/touring'
import { OUTCOMES } from './outcomes'

export interface QueuedClose {
  id: string
  mission_id: string
  assistance: string
  payload: TransformInput & { rawContent?: string | null }
  attempts: number
}

/** Une erreur qui a une chance de passer plus tard ? (panne/réseau = oui) */
export function isRetryable(error: string | null | undefined): boolean {
  const e = String(error || '').toLowerCase()
  if (!e) return true
  // Refus métier explicite → inutile de rejouer.
  if (e.includes("n'autorise pas ce type de clôture")) return false
  if (e.includes('motif')) return false
  if (e.includes('clés touring absentes')) return false
  return true
}

export async function enqueueClose(p: {
  missionId: string
  assistance: string
  input: TransformInput
  rawContent?: string | null
  actorId?: string | null
  error?: string | null
}): Promise<string | null> {
  const sb = createAdminClient()
  const { data } = await sb.from('assistance_close_queue').insert({
    mission_id: p.missionId,
    assistance: p.assistance,
    payload:    { ...p.input, rawContent: p.rawContent ?? null },
    last_error: p.error ?? null,
    created_by: p.actorId ?? null,
  }).select('id').maybeSingle()
  return (data as any)?.id ?? null
}

/**
 * Rejoue les clôtures en attente. Idempotent : on ne renvoie rien si le dossier
 * est déjà clôturé chez l'assistance (dispatch manuel, ou essai précédent dont la
 * réponse s'est perdue).
 */
export async function runAssistanceCloseRetry(limit = 10): Promise<{
  processed: number; done: number; stillPending: number; abandoned: number
  details: { mission: string; ok: boolean; note: string }[]
}> {
  const sb = createAdminClient()
  const details: { mission: string; ok: boolean; note: string }[] = []
  let done = 0, stillPending = 0, abandoned = 0

  const { data: rows } = await sb.from('assistance_close_queue')
    .select('id, mission_id, assistance, payload, attempts')
    .eq('status', 'pending').order('created_at', { ascending: true }).limit(limit)

  for (const row of (rows || []) as any[]) {
    const attempts = (row.attempts || 0) + 1
    const stamp = { attempts, last_try_at: new Date().toISOString(), updated_at: new Date().toISOString() }

    // Au-delà de ~40 essais (≈ 3 h à 5 min), on arrête d'insister : le dispatch
    // prend la main. La ligne reste visible, elle n'est jamais supprimée.
    if (attempts > 40) {
      await sb.from('assistance_close_queue').update({ ...stamp, status: 'abandoned' }).eq('id', row.id)
      abandoned++; details.push({ mission: row.mission_id, ok: false, note: 'abandonnée après 40 essais' })
      continue
    }

    if (row.assistance !== 'touring') {
      await sb.from('assistance_close_queue').update({ ...stamp, last_error: `assistance ${row.assistance} non gérée` }).eq('id', row.id)
      stillPending++; continue
    }

    const { data: m } = await sb.from('incoming_missions')
      .select('id, raw_content, source_format').eq('id', row.mission_id).maybeSingle()
    const keys = parseComexKeys((m as any)?.raw_content || row.payload?.rawContent)
    if (!keys) {
      await sb.from('assistance_close_queue').update({ ...stamp, status: 'failed', last_error: 'clés COMEX introuvables' }).eq('id', row.id)
      details.push({ mission: row.mission_id, ok: false, note: 'clés COMEX introuvables' })
      continue
    }

    const r = await transformTouring(keys, row.payload as TransformInput)

    // Déjà clôturé chez Touring (07) → rien à renvoyer, la ligne est réglée.
    const alreadyClosed = !r.ok && String(r.error || '').includes('07')
    if (r.ok || alreadyClosed) {
      await sb.from('assistance_close_queue')
        .update({ ...stamp, status: 'done', done_at: new Date().toISOString(), last_error: r.ok ? null : r.error })
        .eq('id', row.id)
      done++
      details.push({ mission: row.mission_id, ok: true, note: r.ok ? `clôturée (fin ${r.finCode})` : 'déjà clôturée' })

      if (r.ok && r.codes) {
        // Trace au format attendu par le préremplissage de l'action de suivi.
        await sb.from('mission_logs').insert({
          mission_id: row.mission_id, action: 'touring_closed',
          notes: `Clôture Touring (rattrapage auto) — code ${r.finCode} (codes ${r.codes.cause}/${r.codes.desc}/${r.codes.result})`,
          metadata: { finCode: r.finCode, ...r.codes, statusBefore: r.statusBefore, statusAfter: r.statusAfter, flux2: true, retry: true },
        }).then(() => {}, () => {})
        await sb.from('mission_logs').insert({
          mission_id: row.mission_id, action: 'flux2_retry_ok',
          notes: `Rattrapage automatique réussi — ${OUTCOMES[(row.payload as any).outcome as keyof typeof OUTCOMES]?.label || ''} (essai ${attempts})`,
          metadata: { result: r, attempts },
        }).then(() => {}, () => {})
      }
      continue
    }

    if (!isRetryable(r.error)) {
      await sb.from('assistance_close_queue').update({ ...stamp, status: 'failed', last_error: r.error }).eq('id', row.id)
      details.push({ mission: row.mission_id, ok: false, note: `refus métier : ${r.error}` })
      continue
    }

    await sb.from('assistance_close_queue').update({ ...stamp, last_error: r.error }).eq('id', row.id)
    stillPending++
    details.push({ mission: row.mission_id, ok: false, note: `réessai (${attempts}) — ${r.error}` })
  }

  return { processed: (rows || []).length, done, stillPending, abandoned, details }
}
