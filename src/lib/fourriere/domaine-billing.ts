// src/lib/fourriere/domaine-billing.ts
//
// Gardiennage facturable à l'État (Domaine), regroupé par DATE DE VENTE.
// Règles (Olivier 2026-06-29) :
//   - Le véhicule saisi est remis au Domaine (domaine_remise_date), puis enlevé
//     du parc (domaine_enlevement_date), puis vendu (domaine_vente_date).
//   - Jours facturés = remise Domaine → date d'enlèvement INCLUSE, au tarif parc
//     saisie (SERV-PARC annuel, variante cyclo). Découpage par année civile.
//   - La DATE DE VENTE détermine le trimestre d'apparition ; la liste est
//     regroupée par date de vente.

const DAY = 24 * 60 * 60 * 1000
const ms  = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)
const isCyclo = (cls?: string | null) => /moto|cyclo/i.test(String(cls || ''))

export interface DomaineRow {
  mission_number: number | null
  plate:    string        // N° Véhicule / plaque
  vehicle:  string        // Marque + modèle
  vin:      string        // Châssis n°
  dossier:  string
  remise:   string        // Date IN = remise Domaine (YYYY-MM-DD)
  enlevement: string      // Date OUT = enlèvement (YYYY-MM-DD) ou ''
  vente:    string        // date de vente (YYYY-MM-DD)
  firm:     string        // firme ayant remporté la soumission
  days:     number        // Date OUT − Date IN
  rate:     number | null // tarif/jour (null si plusieurs années)
  amount:   number        // frais HTVA
}

export interface DomaineGroup { vente: string; rows: DomaineRow[]; days: number; amount: number }

interface RateLine { price: number; cyclo: boolean; from: string; to: string | null }

/** @param from / @param to : bornes inclusives sur la DATE DE VENTE (YYYY-MM-DD). */
export async function computeDomaineBilling(
  sb: any, from: string, to: string,
): Promise<{ groups: DomaineGroup[]; total: number; totalDays: number; count: number }> {
  // 1. Tarifs gardiennage saisie.
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

  // 2. Véhicules VENDUS par le Domaine dans la période (filtre sur la date de vente).
  const { data: missions } = await sb
    .from('incoming_missions')
    .select('mission_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, vehicle_class, dossier_number, domaine_remise_date, domaine_enlevement_date, domaine_vente_date, domaine_vente_firm')
    .not('domaine_vente_date', 'is', null)
    .gte('domaine_vente_date', from)
    .lte('domaine_vente_date', to)
    .limit(5000)

  const all: DomaineRow[] = []
  for (const m of missions || []) {
    if (!m.domaine_remise_date) continue
    const remiseMs = ms(m.domaine_remise_date)
    // Jours = remise → enlèvement INCLUS. Sans date d'enlèvement, on ne facture
    // pas encore (gardiennage non clôturé) → days = 0, montant 0 (visible mais à compléter).
    const enlMs = m.domaine_enlevement_date ? ms(m.domaine_enlevement_date) : null
    const cyclo = isCyclo(m.vehicle_class)
    let days = 0, amount = 0
    const ratesUsed = new Set<number | null>()
    if (enlMs != null && enlMs >= remiseMs) {
      // Jours = Date OUT − Date IN (remise non comptée, enlèvement = dernier jour).
      const end = enlMs
      let cur = remiseMs
      while (cur < end) {
        const y = new Date(cur).getUTCFullYear()
        const yearEnd = Date.parse(`${y + 1}-01-01T00:00:00Z`)
        const segEnd = Math.min(end, yearEnd)
        const segDays = Math.floor((segEnd - cur) / DAY)
        if (segDays > 0) {
          const r = rateFor(y, cyclo)
          ratesUsed.add(r); days += segDays; amount += segDays * (r || 0)
        }
        cur = yearEnd
      }
    }
    all.push({
      mission_number: m.mission_number,
      plate:    m.vehicle_plate || '',
      vehicle:  [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' '),
      vin:      m.vehicle_vin || '',
      dossier:  m.dossier_number || '',
      remise:   m.domaine_remise_date,
      enlevement: m.domaine_enlevement_date || '',
      vente:    m.domaine_vente_date,
      firm:     m.domaine_vente_firm || '',
      days,
      rate:     ratesUsed.size === 1 ? [...ratesUsed][0] : null,
      amount:   Math.round(amount * 100) / 100,
    })
  }

  // 3. Regroupement par date de vente.
  const byVente = new Map<string, DomaineRow[]>()
  for (const r of all) {
    const list = byVente.get(r.vente) || []
    list.push(r); byVente.set(r.vente, list)
  }
  const groups: DomaineGroup[] = [...byVente.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([vente, rows]) => {
      rows.sort((x, y) => x.plate.localeCompare(y.plate))
      const days = rows.reduce((s, r) => s + r.days, 0)
      const amount = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
      return { vente, rows, days, amount }
    })

  const total = Math.round(groups.reduce((s, g) => s + g.amount, 0) * 100) / 100
  const totalDays = groups.reduce((s, g) => s + g.days, 0)
  return { groups, total, totalDays, count: all.length }
}
