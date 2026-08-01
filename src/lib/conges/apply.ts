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
