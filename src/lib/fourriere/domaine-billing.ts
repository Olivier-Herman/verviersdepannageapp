// src/lib/fourriere/domaine-billing.ts
//
// Calcul du gardiennage facturable à l'État (Domaine) sur une période :
// pour chaque véhicule saisi remis au Domaine, les jours remise → vente (ou
// fin de période si pas encore vendu), au tarif parc saisie (SERV-PARC annuel).
// Sert au tableau + à l'export Excel trimestriel. Olivier 2026-06-29.

const DAY = 24 * 60 * 60 * 1000
const ms  = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)
const isCyclo = (cls?: string | null) => /moto|cyclo/i.test(String(cls || ''))

export interface DomaineRow {
  mission_number: number | null
  plate:          string
  vehicle:        string
  dossier:        string
  remise:         string        // date remise Domaine (YYYY-MM-DD)
  vente:          string        // date vente (ou '' si en cours)
  days:           number        // jours facturables DANS la période
  rate:           number | null // tarif/jour (null si plusieurs tarifs sur la période)
  amount:         number        // montant HTVA
}

interface RateLine { price: number; cyclo: boolean; from: string; to: string | null }

/**
 * @param from / @param to : bornes inclusives de la période (YYYY-MM-DD).
 */
export async function computeDomaineBilling(
  sb: any, from: string, to: string,
): Promise<{ rows: DomaineRow[]; total: number; totalDays: number }> {
  const fromMs = ms(from), toEndMs = ms(to) + DAY    // `to` inclus → fin = lendemain 00:00

  // 1. Tarifs gardiennage saisie (SERV-PARC "Gardiennage (par jour)", hors "hors période").
  const { data: lines } = await sb
    .from('source_tariff_lines')
    .select('name, default_price, effective_from, effective_to')
    .eq('source', 'police_saisie').eq('kind', 'SERV-PARC')
  const rates: RateLine[] = (lines || [])
    .filter((l: any) => /gardiennage \(par jour\)/i.test(l.name) && !/hors période/i.test(l.name) && l.default_price != null)
    .map((l: any) => ({ price: Number(l.default_price), cyclo: /cyclo/i.test(l.name), from: l.effective_from, to: l.effective_to }))
  const rateFor = (year: number, cyclo: boolean): number | null => {
    const ref = `${year}-06-01`
    const hit = rates.find(r => r.cyclo === cyclo && (!r.from || r.from <= ref) && (!r.to || r.to >= ref))
    return hit ? hit.price : null
  }

  // 2. Véhicules remis au Domaine.
  const { data: missions } = await sb
    .from('incoming_missions')
    .select('mission_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_class, dossier_number, domaine_remise_date, domaine_vente_date')
    .not('domaine_remise_date', 'is', null)
    .not('status', 'in', '(cancelled,ignored)')
    .limit(5000)

  const rows: DomaineRow[] = []
  for (const m of missions || []) {
    const remiseMs = ms(m.domaine_remise_date)
    const venteMs  = m.domaine_vente_date ? ms(m.domaine_vente_date) : null
    // Fenêtre facturable, bornée à la période demandée.
    const start = Math.max(remiseMs, fromMs)
    const end   = Math.min(venteMs != null ? venteMs : toEndMs, toEndMs)
    if (end <= start) continue

    // Découpage par année civile (tarif annuel).
    const cyclo = isCyclo(m.vehicle_class)
    let days = 0, amount = 0
    const ratesUsed = new Set<number | null>()
    let cur = start
    while (cur < end) {
      const y = new Date(cur).getUTCFullYear()
      const yearEnd = Date.parse(`${y + 1}-01-01T00:00:00Z`)
      const segEnd = Math.min(end, yearEnd)
      const segDays = Math.floor((segEnd - cur) / DAY)
      if (segDays > 0) {
        const r = rateFor(y, cyclo)
        ratesUsed.add(r)
        days += segDays
        amount += segDays * (r || 0)
      }
      cur = yearEnd
    }
    if (days <= 0) continue

    rows.push({
      mission_number: m.mission_number,
      plate:    m.vehicle_plate || '',
      vehicle:  [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' '),
      dossier:  m.dossier_number || '',
      remise:   m.domaine_remise_date,
      vente:    m.domaine_vente_date || '',
      days,
      rate:     ratesUsed.size === 1 ? [...ratesUsed][0] : null,
      amount:   Math.round(amount * 100) / 100,
    })
  }

  rows.sort((a, b) => a.remise.localeCompare(b.remise) || a.plate.localeCompare(b.plate))
  const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const totalDays = rows.reduce((s, r) => s + r.days, 0)
  return { rows, total, totalDays }
}
