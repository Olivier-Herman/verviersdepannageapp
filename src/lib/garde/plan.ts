// ============================================================
// VERVIERS DÉPANNAGE — Planning de garde (rotation prévue à l'avance)
// ------------------------------------------------------------
// Modèle (Olivier 2026-08-02) :
//  - Chaque semaine (bascule LUNDI) : 1 chauffeur de garde = JOUR + NUIT, en
//    SECOND départ. Rotation `weekly`.
//  - Un homme fixe de NUIT en PREMIER départ toutes les nuits SAUF le mercredi
//    (son jour de congé) : `night_fixed`.
//  - Mercredi : un chauffeur (rotation INDÉPENDANTE `wednesday`) passe PREMIER
//    départ de nuit ; le garde de la semaine reste second départ.
// ============================================================

// Exception ponctuelle : remplace le garde d'une SEMAINE (scope 'week', date =
// n'importe quel jour de la semaine visée) ou le 1er départ d'une NUIT précise
// (scope 'night', date = ce jour). Une inversion = deux exceptions 'week'.
export interface GardeException { scope: 'week' | 'night'; date: string; user_id: string; note?: string }

export interface GardeConfig {
  anchor_monday: string        // un LUNDI de référence (semaine index 0)
  weekly:        string[]      // rotation hebdo (user_ids ; DOUBLONS autorisés)
  wednesday:     string[]      // rotation premier départ du mercredi (user_ids ; doublons ok)
  night_fixed:   string | null // homme de nuit fixe (premier départ sauf mercredi)
  exceptions?:   GardeException[]
  day_start?:    string        // horaire jour début (défaut 08:00)
  day_end?:      string        // horaire jour fin   (défaut 18:00)
  night_start?:  string        // horaire nuit début (défaut 18:00)
  night_end?:    string        // horaire nuit fin   (défaut 08:00)
}

export const GARDE_HOURS_DEFAULT = { day_start: '08:00', day_end: '18:00', night_start: '18:00', night_end: '08:00' }

export interface GardeDay {
  date:         string   // YYYY-MM-DD
  week_no:      number   // n° de semaine ISO
  weekly_garde: string | null   // user_id du garde de la semaine (jour+nuit, 2e départ)
  night_first:  string | null   // user_id du premier départ de nuit ce jour-là
}

const DAY = 86400000
const pad2 = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const mod = (a: number, n: number) => n > 0 ? ((a % n) + n) % n : 0

export function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (x.getDay() + 6) % 7   // lundi = 0
  x.setDate(x.getDate() - day)
  return x
}

export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)          // jeudi de la semaine ISO
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const fday = (firstThu.getUTCDay() + 6) % 7
  return 1 + Math.round(((d.getTime() - firstThu.getTime()) / DAY - 3 + fday) / 7)
}

/** Génère le planning jour par jour entre from et to (inclus). */
export function computeGardePlan(cfg: GardeConfig, from: Date, to: Date): GardeDay[] {
  const anchor = mondayOf(new Date(cfg.anchor_monday + 'T00:00:00'))
  // Exceptions indexées : par lundi de semaine (scope week) et par date (scope night).
  const weekEx = new Map<string, string>()   // mondayISO -> user_id
  const nightEx = new Map<string, string>()  // dateISO   -> user_id
  for (const e of (cfg.exceptions || [])) {
    if (!e?.date || !e.user_id) continue
    if (e.scope === 'week') weekEx.set(iso(mondayOf(new Date(e.date + 'T00:00:00'))), e.user_id)
    else if (e.scope === 'night') nightEx.set(e.date, e.user_id)
  }
  const out: GardeDay[] = []
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  while (cur <= end) {
    const mon = mondayOf(cur)
    const monIso = iso(mon)
    const weekIndex = Math.round((mon.getTime() - anchor.getTime()) / (7 * DAY))
    const dateIso = iso(cur)
    // Garde de la semaine : exception 'week' prioritaire, sinon rotation.
    let weekly = weekEx.has(monIso) ? weekEx.get(monIso)! : (cfg.weekly?.length ? cfg.weekly[mod(weekIndex, cfg.weekly.length)] : null)
    // 1er départ nuit : exception 'night' du jour prioritaire, sinon mercredi/fixe.
    const isWed = cur.getDay() === 3
    let nightFirst = nightEx.has(dateIso) ? nightEx.get(dateIso)!
      : isWed ? (cfg.wednesday?.length ? cfg.wednesday[mod(weekIndex, cfg.wednesday.length)] : null)
      : (cfg.night_fixed || null)
    out.push({ date: dateIso, week_no: isoWeek(cur), weekly_garde: weekly, night_first: nightFirst })
    cur.setDate(cur.getDate() + 1)
  }
  return out
}
