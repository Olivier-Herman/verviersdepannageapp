// src/lib/cloture/transform/vab.ts
//
// TRANSFORMATION « derrière » pour une mission VAB (Olivier 2026-08-11).
//
// Première brique : le passage ON-SITE → ÉCRAN DE CODE, piloté par un Chromium
// headless (`vabCloseOnSiteBrowser`, prouvé en live sur 56132792). Elle enchaîne
// login → km + 3 derniers du VIN → « Oui » de la pop-up iframe → Unknown VIN →
// signature dessinée → Envoyer → Fin lieu de la panne → écran de code.
//
// Ce qui n'est PAS encore ici : la reprise HTTP à l'écran de code (codes Solution
// et Panne, End, pop-up DSP/REM). Le closer rend `cookieHeader` + `osvstate`
// justement pour ça — cf recette dans la mémoire VAB Comet. Non bloquant : la
// mission arrive à l'écran de code, le dispatch termine en deux clics.
//
// ⚠️ COMPTE VAB PARTAGÉ. Un run headless qui démarre pendant qu'un humain (ou un
// autre run) est sur Comet casse la session des deux côtés. D'où le VERROU
// ci-dessous : un seul pilotage à la fois, et jamais plus d'un par mission.

import { createAdminClient } from '@/lib/supabase'
import { vabCloseOnSiteBrowser } from '@/lib/vab/sign-browser'

const LOCK_KEY = 'vab_browser_lock'
/** Un run va jusqu'à ~90 s ; au-delà de 6 min le verrou est forcément périmé. */
const LOCK_TTL_MS = 6 * 60 * 1000

/** AssignmentId VAB = les chiffres de l'external_id (ex. « VAB-56132792 » → 56132792). */
export function vabAssignmentId(externalId: string | null | undefined): string | null {
  const digits = String(externalId || '').replace(/\D+/g, '')
  return digits.length >= 6 ? digits : null
}

async function acquireLock(missionId: string): Promise<boolean> {
  const sb = createAdminClient()
  const { data } = await sb.from('app_settings').select('value').eq('key', LOCK_KEY).maybeSingle()
  let cur: any = null
  try { cur = (data as any)?.value ? JSON.parse(String((data as any).value)) : null } catch { cur = null }
  if (cur?.startedAt && Date.now() - new Date(cur.startedAt).getTime() < LOCK_TTL_MS) return false
  await sb.from('app_settings').upsert(
    { key: LOCK_KEY, value: JSON.stringify({ missionId, startedAt: new Date().toISOString() }) },
    { onConflict: 'key' },
  )
  return true
}

async function releaseLock(): Promise<void> {
  const sb = createAdminClient()
  await sb.from('app_settings').upsert({ key: LOCK_KEY, value: JSON.stringify({ startedAt: null }) }, { onConflict: 'key' })
    .then(() => {}, () => {})
}

export interface VabOnSiteInput {
  missionId:   string
  externalId:  string | null
  /** Kilométrage relevé. Absent = mission vélo (« Fiets ») → on saute km + VIN. */
  km?:         string | number | null
  /** 5 derniers du VIN saisis par le chauffeur (le closer n'en garde que 3). */
  vinLastDigits?: string | null
  actorId?:    string | null
}

/**
 * Pilote l'écran on-site VAB jusqu'à l'écran de code. À lancer en TÂCHE DE FOND
 * (waitUntil) : le run dure 60-90 s, le chauffeur ne doit jamais l'attendre.
 */
export async function runVabOnSite(input: VabOnSiteInput): Promise<void> {
  const sb = createAdminClient()
  const log = (action: string, notes: string, metadata: any = {}) =>
    sb.from('mission_logs').insert({ mission_id: input.missionId, actor_id: input.actorId ?? null, action, notes, metadata })
      .then(() => {}, () => {})

  const assignmentId = vabAssignmentId(input.externalId)
  if (!assignmentId) { await log('vab_onsite_skipped', 'VAB : AssignmentId introuvable dans external_id', { externalId: input.externalId }); return }

  // Déjà fait ? (double validation, reprise du chauffeur…)
  const { data: m } = await sb.from('incoming_missions').select('vab_onsite_at, vab_closed_at').eq('id', input.missionId).maybeSingle()
  if ((m as any)?.vab_onsite_at || (m as any)?.vab_closed_at) {
    await log('vab_onsite_skipped', 'VAB : déjà amenée à l’écran de code, on ne rejoue pas', {})
    return
  }

  if (!(await acquireLock(input.missionId))) {
    await log('vab_onsite_skipped',
      '⏳ VAB : le compte est déjà utilisé (autre clôture ou session ouverte) — reprise manuelle nécessaire pour cette mission',
      { assignmentId })
    return
  }

  const started = Date.now()
  try {
    const km  = input.km == null || String(input.km).trim() === '' ? '' : String(input.km).trim()
    const vin = String(input.vinLastDigits || '').trim()
    const r = await vabCloseOnSiteBrowser({ assignmentId, km, vinLastDigits: vin })
    const secs = Math.round((Date.now() - started) / 1000)

    if (r.onCodeScreen) {
      await sb.from('incoming_missions')
        .update({ vab_onsite_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', input.missionId)
    }

    await log(
      r.onCodeScreen ? 'vab_onsite_ok' : 'vab_onsite_failed',
      r.onCodeScreen
        ? `VAB : mission amenée à l’écran de code en ${secs}s (${r.steps.join(' → ')}) — codes à valider`
        : `VAB : écran de code non atteint après ${secs}s — ${r.error || 'raison inconnue'}${r.steps.length ? ` (${r.steps.join(' → ')})` : ''}`,
      { assignmentId, km: km || null, vin: vin || null, steps: r.steps, error: r.error ?? null, diag: r.diag ?? null, seconds: secs,
        // cookieHeader + osvstate serviront à la reprise HTTP (codes + End + popup).
        handoff: r.onCodeScreen ? { cookieHeader: r.cookieHeader, osvstate: r.osvstate } : null },
    )
  } catch (e: any) {
    await log('vab_onsite_failed', `VAB : erreur pendant le pilotage — ${e?.message || e}`, { assignmentId })
  } finally {
    await releaseLock()
  }
}
