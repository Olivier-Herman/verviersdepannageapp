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
//
// RÈGLE TOURING (Olivier 05/10/2026, rapport « Délais d'encodage » de septembre) : un
// pointage peut être rétroactif de 9 min AU PLUS. Sur place à 12 h 31 → l'encodage
// chez COMEX doit avoir lieu au plus tard à 12 h 40. Toute heure envoyée est donc
// relevée à « maintenant − 7 min » si elle est plus ancienne (marge 2 min), et le
// sur place automatique part À l'heure tirée (accept + 20..45), plus 45 min après.

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
  on_way_at?:           string | null
}

/**
 * TGR / TRANSFERT : LE VÉHICULE EST DÉJÀ CHEZ NOUS — PAS DE SLA (Olivier 27/09/2026).
 *
 * « Le TGR Touring n'est pas soumis à la règle de départ / sur place : pour un
 * TGR, on suit le vrai pointage chauffeur. » La règle SLA (en route ≤ accept+10,
 * sur place = accept+20..45, poussés par le cron même sans chauffeur) ne vaut
 * que pour une mission d'assistance sur la route. Une commande dont le point de
 * départ est NOTRE dépôt (TGR ouvert par Touring, ou jambe de transfert créée
 * après une mise en parc) n'a rien à « rejoindre » : on ne pousse chez COMEX
 * que ce que le chauffeur pointe réellement, à l'heure réelle.
 *
 * 2GLN102 : le 21/09 le cron a poussé en route/sur place sur la commande TGR le
 * jour de sa réception, la voiture toujours au parc → commande partie en BKO
 * « faite » six jours avant la livraison, puis fausse annulation le 27/09.
 *
 * Reconnaissance sur l'enregistrement COMEX : COD_ADRESSE 'TRF' (jambe de
 * transfert), ou point de départ nommé « Verviers Dépannage » (TGR ouvert à la
 * main chez eux, COD_ADRESSE 'ROA'). ⚠️ Pas sur « D68267 » : c'est NOTRE code
 * prestataire, il préfixe le NOM de toutes nos missions (vérifié 27/09 : 60/60).
 */
export function isComexDepotStart(raw: string | null | undefined): boolean {
  if (!raw) return false
  let c: any
  try { c = JSON.parse(raw) } catch { return false }
  if (String(c?.COD_ADRESSE || '').toUpperCase() === 'TRF') return true
  const nom = String(c?.NOM || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  return /VERVIERS\s+DEPANNAGE/.test(nom)
}

/** true si la synchro COMEX réelle est activée (kill-switch global). */
export function touringSyncEnabled(): boolean {
  return process.env.TOURING_COMEX_MODE === 'import'
}

export function comexKeysOf(f: { source_format?: string | null; raw_content?: string | null }): { CID_DOS: string; CID_SEQ_ACTION: string } | null {
  return comexKeys(f as TouringFiche)
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
    .select('id, source, source_format, raw_content, touring_accepted_at, touring_onroad_at, touring_onspot_at, on_way_at')
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
const RETRO_MIN = 7   // < 9 min de rétroactivité autorisés par Touring (marge 2 min)
/** Jamais plus de RETRO_MIN minutes dans le passé au moment de l'envoi. */
function notTooOld(at: Date, now = Date.now()): Date {
  const floor = now - RETRO_MIN * MIN
  return at.getTime() < floor ? new Date(floor) : at
}
/** Heure du sur place automatique : accept + 20..45 min, fixe par mission (même tirage à chaque passage du cron). */
export function autoOnSpotTarget(missionId: string, accept: Date | null): Date {
  let h = 0
  for (const ch of missionId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const base = accept || new Date(Date.now() - 45 * MIN)
  return new Date(base.getTime() + (20 + (h % 26)) * MIN)
}
function onRoadBefore(spotAt: Date, accept: Date | null): Date {
  // ≤ accept+10min ET strictement avant l'arrivée (marge 2 min) — mais jamais plus de
  // 8 min dans le passé (règle Touring des 9 min) : au besoin 1 min avant l'arrivée.
  const cand = accept ? new Date(accept.getTime() + 8 * MIN) : new Date(spotAt.getTime() - 5 * MIN)
  const beforeSpot = new Date(spotAt.getTime() - 2 * MIN)
  let at = cand.getTime() < beforeSpot.getTime() ? cand : beforeSpot
  const floor = Date.now() - (RETRO_MIN + 1) * MIN
  if (at.getTime() < floor) at = new Date(Math.min(floor, spotAt.getTime() - MIN))
  return at
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

  // TGR / transfert : seul le pointage réel du chauffeur compte, à l'heure réelle.
  const depotStart = isComexDepotStart(f.raw_content)
  if (depotStart && !opts?.at) return false

  const accept = f.touring_accepted_at ? new Date(f.touring_accepted_at) : null
  const at = notTooOld(depotStart ? opts!.at! : clampOnRoad(opts?.at || new Date(), accept))
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

  // TGR / transfert : pas de « sur place » automatique, pas de clamp — le
  // pointage réel du chauffeur, et rien d'autre.
  const depotStart = isComexDepotStart(f.raw_content)
  if (depotStart && !opts?.at) return false

  const accept = f.touring_accepted_at ? new Date(f.touring_accepted_at) : null
  // Auto : on attend l'heure tirée (le cron repasse chaque minute) et on l'envoie à ce
  // moment-là — avant, elle partait 45 min après l'acceptation avec une heure passée.
  if (!opts?.at && !depotStart && autoOnSpotTarget(missionId, accept).getTime() > Date.now()) return false
  const spotAt = notTooOld(depotStart ? opts!.at! : (opts?.at ? clampOnSpot(opts.at, accept) : autoOnSpotTarget(missionId, accept)))

  // COMEX exige onRoad avant onSpot : le pousser (backdaté) s'il manque.
  if (!f.touring_onroad_at) {
    // TGR : l'heure de départ réelle du chauffeur si on l'a, sinon juste avant l'arrivée.
    const roadAt = depotStart
      ? (f.on_way_at && Date.parse(f.on_way_at) < spotAt.getTime() - MIN ? new Date(f.on_way_at) : new Date(spotAt.getTime() - 2 * MIN))
      : onRoadBefore(spotAt, accept)
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
    r.already ? 'Touring COMEX ✓ sur place — déjà enregistré chez eux'
      : r.ok ? `Touring COMEX ↗ sur place (${spotAt.toISOString()}${opts?.at ? '' : ', auto'})`
      : `Touring COMEX ↗ échec sur place — ${r.error}`,
    { ...keys, step: 'onSpot', operAt: spotAt.toISOString(), auto: !opts?.at, already: !!r.already })
  return r.ok
}
