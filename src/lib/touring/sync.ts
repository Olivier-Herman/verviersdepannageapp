// src/lib/touring/sync.ts
//
// Synchronise les statuts d'une mission VD Soft vers Touring COMEX :
//   • en route  → onRoad (05)
//   • sur place → onSpot (06)
// Appelé au POINTAGE du chauffeur (heure réelle) ET par le CRON SLA (auto-timing).
// Idempotent (colonnes touring_onroad_at / touring_onspot_at) et GATÉ par
// TOURING_COMEX_MODE=import (aucune mutation réelle tant que l'intégration n'est
// pas activée).
//
// SLA Touring (depuis touring_accepted_at, posé au « Valider ») :
//   • démarré (onRoad)   ≤ accept + 10 min  → operDate clampé à 10 min
//   • sur place (onSpot)  ≤ accept + 45 min  → réel clampé à 45, auto = rand(20..45)
//   • COMEX exige onRoad AVANT onSpot → on pousse un onRoad backdaté au besoin
// Cf mémoire project_touring_comex_integration.

import { setTouringOnRoad, setTouringOnSpot } from './comex'

const MIN = 60_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any   // client admin Supabase

interface TouringFiche {
  id:                   string
  source:               string | null
  source_format:        string | null
  raw_content:          string | null
  touring_accepted_at:  string | null
  touring_onroad_at:    string | null
  touring_onspot_at:    string | null
}

/** true si la synchro COMEX réelle est activée (kill-switch global). */
export function touringSyncEnabled(): boolean {
  return process.env.TOURING_COMEX_MODE === 'import'
}

function comexKeys(f: TouringFiche): { CID_DOS: string; CID_SEQ_ACTION: string } | null {
  // Lien COMEX = source_format 'comex' + clés CID dans raw_content. On ne gate
  // PLUS sur source='touring' : une mission COMEX autoroute est auto-classée en
  // Siabis (police_snc / sia_couvert) mais son pointage (en route / sur place)
  // doit continuer à partir dans COMEX. Olivier 2026-07-09.
  if (f.source_format !== 'comex' || !f.raw_content) return null
  let cid: any
  try { cid = JSON.parse(f.raw_content) } catch { return null }
  const CID_DOS = String(cid?.CID_DOS || '').trim()
  const CID_SEQ_ACTION = String(cid?.CID_SEQ_ACTION || '').trim()
  if (!CID_DOS || !CID_SEQ_ACTION) return null
  return { CID_DOS, CID_SEQ_ACTION }
}

async function loadFiche(supabase: Sb, missionId: string): Promise<TouringFiche | null> {
  const { data } = await supabase.from('incoming_missions')
    .select('id, source, source_format, raw_content, touring_accepted_at, touring_onroad_at, touring_onspot_at')
    .eq('id', missionId).maybeSingle()
  return (data as TouringFiche) || null
}

async function logSync(supabase: Sb, missionId: string, actorId: string | null, ok: boolean, notes: string, meta: any) {
  await supabase.from('mission_logs').insert({
    mission_id: missionId, actor_id: actorId,
    action: ok ? 'touring_synced' : 'touring_sync_error',
    notes, metadata: meta,
  }).then(() => {}, () => {})
}

// ── Calcul des heures d'opération (SLA) ───────────────────────────────────────
function clampOnRoad(at: Date, accept: Date | null): Date {
  if (!accept) return at
  const max = new Date(accept.getTime() + 10 * MIN)   // démarré ≤ accept+10min
  return at.getTime() > max.getTime() ? max : at
}
function clampOnSpot(at: Date, accept: Date | null): Date {
  if (!accept) return at
  const max = new Date(accept.getTime() + 45 * MIN)   // sur place ≤ accept+45min
  return at.getTime() > max.getTime() ? max : at
}
function autoOnSpot(accept: Date | null): Date {
  const base = accept || new Date(Date.now() - 45 * MIN)
  const rand = 20 + Math.floor(Math.random() * 26)    // 20..45 min (variation)
  return new Date(base.getTime() + rand * MIN)
}
function onRoadBefore(spotAt: Date, accept: Date | null): Date {
  // ≤ accept+10min ET strictement avant l'arrivée (marge 2 min).
  const cand = accept ? new Date(accept.getTime() + 8 * MIN) : new Date(spotAt.getTime() - 5 * MIN)
  const beforeSpot = new Date(spotAt.getTime() - 2 * MIN)
  return cand.getTime() < beforeSpot.getTime() ? cand : beforeSpot
}

/**
 * Pousse « en route » (onRoad) dans COMEX. `at` = heure réelle du pointage
 * (défaut maintenant), clampée à accept+10min. Idempotent. true si poussé.
 */
export async function syncTouringOnRoad(
  supabase: Sb, missionId: string, opts?: { at?: Date; actorId?: string | null },
): Promise<boolean> {
  if (!touringSyncEnabled()) return false
  const f = await loadFiche(supabase, missionId)
  if (!f) return false
  const keys = comexKeys(f)
  if (!keys) return false
  if (f.touring_onroad_at) return false   // déjà poussé (idempotent)

  const accept = f.touring_accepted_at ? new Date(f.touring_accepted_at) : null
  const at = clampOnRoad(opts?.at || new Date(), accept)
  const r = await setTouringOnRoad(keys, { at })
  if (r.ok) {
    await supabase.from('incoming_missions').update({ touring_onroad_at: new Date().toISOString() }).eq('id', missionId)
  }
  await logSync(supabase, missionId, opts?.actorId ?? null, r.ok,
    r.ok ? `Touring COMEX ↗ en route (${at.toISOString()})` : `Touring COMEX ↗ échec en route — ${r.error}`,
    { ...keys, step: 'onRoad', operAt: at.toISOString() })
  return r.ok
}

/**
 * Pousse « sur place » (onSpot) dans COMEX, en garantissant qu'un onRoad
 * (backdaté ≤ accept+10min) le précède. `at` = heure réelle d'arrivée si fournie
 * (chauffeur, clampée ≤ accept+45), sinon AUTO = accept + rand(20..45min)
 * (cron SLA). Idempotent. true si poussé.
 */
export async function syncTouringOnSpot(
  supabase: Sb, missionId: string, opts?: { at?: Date; actorId?: string | null },
): Promise<boolean> {
  if (!touringSyncEnabled()) return false
  const f = await loadFiche(supabase, missionId)
  if (!f) return false
  const keys = comexKeys(f)
  if (!keys) return false
  if (f.touring_onspot_at) return false   // déjà poussé (idempotent)

  const accept = f.touring_accepted_at ? new Date(f.touring_accepted_at) : null
  const spotAt = opts?.at ? clampOnSpot(opts.at, accept) : autoOnSpot(accept)

  // COMEX exige onRoad avant onSpot : le pousser (backdaté) s'il manque.
  if (!f.touring_onroad_at) {
    const roadAt = onRoadBefore(spotAt, accept)
    const rr = await setTouringOnRoad(keys, { at: roadAt })
    if (rr.ok) {
      await supabase.from('incoming_missions').update({ touring_onroad_at: new Date().toISOString() }).eq('id', missionId)
      await logSync(supabase, missionId, opts?.actorId ?? null, true,
        `Touring COMEX ↗ en route (auto, avant sur place, ${roadAt.toISOString()})`, { ...keys, step: 'onRoad', operAt: roadAt.toISOString() })
    } else {
      await logSync(supabase, missionId, opts?.actorId ?? null, false,
        `Touring COMEX ↗ échec en route (pré-sur place) — ${rr.error}`, { ...keys, step: 'onRoad' })
      return false   // sans onRoad, COMEX refuserait le onSpot
    }
  }

  const r = await setTouringOnSpot(keys, { at: spotAt })
  if (r.ok) {
    await supabase.from('incoming_missions').update({ touring_onspot_at: new Date().toISOString() }).eq('id', missionId)
  }
  await logSync(supabase, missionId, opts?.actorId ?? null, r.ok,
    r.ok ? `Touring COMEX ↗ sur place (${spotAt.toISOString()}${opts?.at ? '' : ', auto'})` : `Touring COMEX ↗ échec sur place — ${r.error}`,
    { ...keys, step: 'onSpot', operAt: spotAt.toISOString(), auto: !opts?.at })
  return r.ok
}
