// src/lib/conges/apply.ts
//
// Congés : types, calcul des jours ouvrables, et écriture automatique du code
// d'absence sur la/les feuille(s) de présence du/des mois concerné(s).

export const CONGE_TYPES: Record<string, string> = {
  conge:      'Congé légal',
  recup:      'Récupération',
  sans_solde: 'Congé sans solde',
}

/** Répartit une plage de dates en { période AAAA-MM → [numéros de jour ouvrables] }
 *  (week-ends exclus). */
export function weekdaysByMonth(startDate: string, endDate: string): Record<string, number[]> {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const out: Record<string, number[]> = {}
  if (!sy || !ey) return out
  let cur = new Date(Date.UTC(sy, sm - 1, sd))
  const last = new Date(Date.UTC(ey, em - 1, ed))
  let guard = 0
  while (cur <= last && guard++ < 800) {
    const dow = cur.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const period = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`
      ;(out[period] ||= []).push(cur.getUTCDate())
    }
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

/** Nombre total de jours ouvrables d'une plage. */
export function countWeekdays(startDate: string, endDate: string): number {
  return Object.values(weekdaysByMonth(startDate, endDate)).reduce((n, arr) => n + arr.length, 0)
}

/** Heures/jour par jour de semaine (1=lundi … 5=vendredi) déduites d'une feuille. */
export function weekdayHoursFromSheet(period: string, days: Record<string, any>): Record<number, number> {
  const map: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const [y, m] = (period || '').split('-').map(Number)
  if (!y || !m) return map
  for (const [d, v] of Object.entries(days || {})) {
    if (!v || !(v.h > 0)) continue
    const dow = new Date(Date.UTC(y, m - 1, Number(d))).getUTCDay()
    if (dow >= 1 && dow <= 5) map[dow] = Math.max(map[dow], v.h)
  }
  return map
}

/** Total d'heures d'une plage selon le rythme (heures/jour de semaine). */
export function hoursForRange(dayHours: Record<number, number>, start: string, end: string): number {
  const [sy, sm, sd] = (start || '').split('-').map(Number)
  const [ey, em, ed] = (end || '').split('-').map(Number)
  if (!sy || !ey) return 0
  let cur = new Date(Date.UTC(sy, sm - 1, sd)); const last = new Date(Date.UTC(ey, em - 1, ed))
  let total = 0, guard = 0
  while (cur <= last && guard++ < 800) {
    const dow = cur.getUTCDay()
    if (dow >= 1 && dow <= 5) total += dayHours[dow] || 0
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return Math.round(total * 100) / 100
}

/** Rythme (heures/jour) d'un travailleur, depuis sa feuille de présence la plus
 *  récente ; fallback = Q/S ÷ 5. */
export async function workerDayHours(sb: any, personnelId: string): Promise<Record<number, number>> {
  const { data: sheets } = await sb.from('prestation_sheets').select('period, days, qs')
    .eq('personnel_id', personnelId).order('period', { ascending: false }).limit(1)
  const s = sheets?.[0]
  if (s) { const wh = weekdayHoursFromSheet(s.period, s.days); if (Object.values(wh).some(h => h > 0)) return wh }
  const qs = s?.qs ? parseFloat(String(s.qs).split('/')[0].replace(',', '.')) : 38
  const per = (isFinite(qs) ? qs : 38) / 5
  return { 1: per, 2: per, 3: per, 4: per, 5: per }
}

/** Recalcule days/hours d'une demande de congé d'après l'état ACTUEL des feuilles
 *  de présence : ne compte que les jours encore marqués `{abs:type}` (si le RH a
 *  remis des heures ou une autre absence, ils ne comptent plus). */
export async function recomputeCongeRequest(sb: any, req: any): Promise<void> {
  const dh = await workerDayHours(sb, req.personnel_id)
  const byMonth = weekdaysByMonth(req.start_date, req.end_date)
  let days = 0, hours = 0
  for (const [period, dayNums] of Object.entries(byMonth)) {
    const { data: sheet } = await sb.from('prestation_sheets').select('days').eq('period', period).eq('personnel_id', req.personnel_id).maybeSingle()
    const [y, m] = period.split('-').map(Number)
    for (const dn of dayNums) {
      // Pas de feuille → on garde (sera posé à l'import). Feuille → doit être `{abs:type}`.
      const stillLeave = sheet ? (sheet.days?.[String(dn)]?.abs === req.type) : true
      if (stillLeave) { days++; hours += dh[new Date(Date.UTC(y, m - 1, dn)).getUTCDay()] || 0 }
    }
  }
  await sb.from('conge_requests').update({ days, hours: Math.round(hours * 100) / 100 }).eq('id', req.id)
}

/** Synchronise les demandes de congé d'un travailleur avec la feuille d'un mois
 *  (appelé quand le RH édite la grille). */
export async function syncCongeRequestsForSheet(sb: any, personnelId: string, period: string): Promise<void> {
  if (!personnelId || !period) return
  const { data: reqs } = await sb.from('conge_requests').select('*')
    .eq('personnel_id', personnelId).in('status', ['approved', 'cancel_requested'])
    .lte('start_date', `${period}-31`).gte('end_date', `${period}-01`)
  for (const r of (reqs || [])) await recomputeCongeRequest(sb, r)
}

/** Retire un congé posé (restaure les heures prestées standard). */
export async function revertLeaveFromSheets(sb: any, personnelId: string, type: string, startDate: string, endDate: string): Promise<void> {
  const byMonth = weekdaysByMonth(startDate, endDate)
  for (const [period, dayNums] of Object.entries(byMonth)) {
    const { data: sheet } = await sb.from('prestation_sheets').select('id, days').eq('period', period).eq('personnel_id', personnelId).maybeSingle()
    if (!sheet) continue
    const days = { ...(sheet.days || {}) }
    const wh = weekdayHoursFromSheet(period, days)
    const [y, m] = period.split('-').map(Number)
    let changed = false
    for (const dn of dayNums) {
      if (days[String(dn)]?.abs === type) {
        const dow = new Date(Date.UTC(y, m - 1, dn)).getUTCDay()
        const h = wh[dow] || 0
        if (h > 0) days[String(dn)] = { h }; else delete days[String(dn)]
        changed = true
      }
    }
    if (changed) await sb.from('prestation_sheets').update({ days }).eq('id', sheet.id)
  }
}

/** Écrit le code d'absence (`{abs:type}`) sur les feuilles de présence des mois
 *  couverts, pour cette personne, sans écraser une absence déjà saisie. Renvoie
 *  le nombre de jours effectivement posés. */
export async function applyLeaveToSheets(sb: any, personnelId: string, type: string, startDate: string, endDate: string): Promise<{ applied: number; missing: string[] }> {
  const byMonth = weekdaysByMonth(startDate, endDate)
  let applied = 0
  const missing: string[] = []
  for (const [period, dayNums] of Object.entries(byMonth)) {
    const { data: sheet } = await sb.from('prestation_sheets').select('id, days')
      .eq('period', period).eq('personnel_id', personnelId).maybeSingle()
    if (!sheet) { missing.push(period); continue }   // feuille du mois pas encore importée
    const days = { ...(sheet.days || {}) }
    for (const dn of dayNums) {
      const v = days[String(dn)]
      if (!v?.abs) { days[String(dn)] = { abs: type }; applied++ }   // ne remplace pas une absence existante
    }
    await sb.from('prestation_sheets').update({ days }).eq('id', sheet.id)
  }
  return { applied, missing }
}
