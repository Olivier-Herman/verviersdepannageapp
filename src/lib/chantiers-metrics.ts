// src/lib/chantiers-metrics.ts
//
// Mesures affichées sur certaines cartes du tableau des chantiers. Lu côté
// serveur (page + API), jamais depuis le navigateur.
//
// « flux2-legacy » (Olivier 09/09/2026) : avant de retirer l'ancien écran de
// clôture, 30 jours de mesure. Chaque clôture chauffeur porte depuis le 09/09
// `metadata.closure_path` ('flux2' | 'legacy') et `metadata.flux2_gate`
// ('on' | 'off') — voir /api/missions/driver-action. Les clôtures antérieures
// se classent par la présence d'un journal Flux 2 sur la mission.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ChantierMetric { label: string; value: string; tone?: 'ok' | 'warn' | 'muted' }
export type ChantierMetrics = Record<string, ChantierMetric[]>

/** Début de la mesure Flux 2 (jour de l'instrumentation) et fin prévue (+30 j). */
export const FLUX2_MEASURE_START = '2026-09-09'
export const FLUX2_MEASURE_END   = '2026-10-09'

const FLUX2_LOGS = ['flux2_closed', 'flux2_close_failed', 'flux2_retry_ok']
const fmt = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' })

export async function chantierMetrics(sb: SupabaseClient): Promise<ChantierMetrics> {
  const out: ChantierMetrics = {}
  try { out['flux2-legacy'] = await flux2Metrics(sb) } catch (e: any) { out['flux2-legacy'] = [{ label: 'Mesure', value: `illisible : ${e?.message || e}`, tone: 'warn' }] }
  return out
}

async function flux2Metrics(sb: SupabaseClient): Promise<ChantierMetric[]> {
  const since = FLUX2_MEASURE_START + 'T00:00:00+02:00'
  const [{ data: done, error: e1 }, { data: f2, error: e2 }] = await Promise.all([
    sb.from('mission_logs').select('mission_id, metadata').in('action', ['completed', 'complete_delivery']).gte('created_at', since).limit(5000),
    sb.from('mission_logs').select('mission_id').in('action', FLUX2_LOGS).gte('created_at', since).limit(5000),
  ])
  if (e1) throw new Error(e1.message)
  if (e2) throw new Error(e2.message)
  const viaFlux2 = new Set((f2 || []).map((r: any) => r.mission_id))
  const missions = new Map<string, { path: 'flux2' | 'legacy'; gate: string | null }>()
  for (const r of (done || []) as any[]) {
    const md = r.metadata || {}
    const path: 'flux2' | 'legacy' = md.closure_path === 'flux2' || (md.closure_path !== 'legacy' && viaFlux2.has(r.mission_id)) ? 'flux2' : 'legacy'
    const prev = missions.get(r.mission_id)
    // Une mission clôturée deux fois (correction < 6 h) compte une fois ; Flux 2 l'emporte.
    missions.set(r.mission_id, { path: prev?.path === 'flux2' ? 'flux2' : path, gate: md.flux2_gate ?? prev?.gate ?? null })
  }
  let flux2 = 0, legacy = 0, legacyGateOn = 0, legacyGateOff = 0
  for (const m of missions.values()) {
    if (m.path === 'flux2') flux2++
    else { legacy++; if (m.gate === 'on') legacyGateOn++; else if (m.gate === 'off') legacyGateOff++ }
  }
  const total = flux2 + legacy
  const pct = total ? Math.round(flux2 * 100 / total) : 0
  const daysLeft = Math.max(0, Math.ceil((new Date(FLUX2_MEASURE_END + 'T00:00:00+02:00').getTime() - Date.now()) / 86_400_000))
  return [
    { label: `Clôtures depuis le ${fmt(FLUX2_MEASURE_START)}`, value: String(total), tone: 'muted' },
    { label: 'Par le Flux 2', value: total ? `${flux2} (${pct} %)` : '0', tone: 'ok' },
    { label: 'Ancien écran seul', value: String(legacy), tone: legacy ? 'warn' : 'ok' },
    { label: 'dont grille Flux 2 ouverte', value: legacyGateOn ? `${legacyGateOn} — trou de gating` : legacyGateOff || legacyGateOn ? '0' : 'pas encore mesuré', tone: legacyGateOn ? 'warn' : 'muted' },
    { label: 'Fin de mesure', value: `${fmt(FLUX2_MEASURE_END)} (J-${daysLeft})`, tone: 'muted' },
  ]
}
