// src/lib/domaine/vente-epaves-register.ts
//
// Registre « Vente d'épaves » = reflet FIDÈLE des tableaux de Rosemarie. Source =
// la trace `domaine_ventes_epaves` (TOUTES les lignes de chaque mail, rapprochées
// à une fiche VD Soft ou non — certaines épaves sont encore chez TowSoft). Le
// gardiennage se calcule à partir du mail seul (Date IN = colonne date du mail,
// Date OUT = date max d'enlèvement, éditable), au tarif parc saisie. Chaque ligne
// s'affiche ET se comptabilise, même non rapprochée. Olivier 2026-07-30.

const DAY = 24 * 60 * 60 * 1000
const ms  = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)
const isCyclo = (s?: string | null) => /cyclo|moto|scooter|mobylette/i.test(String(s || ''))

export interface VenteEpaveRow {
  id:        string          // id de la ligne de trace
  numero:    string          // référence Domaine (N° véhicule du mail)
  vehicle:   string          // marque + modèle
  vin:       string
  dateIn:    string          // Date IN (YYYY-MM-DD) ou ''
  dateOut:   string          // Date OUT (YYYY-MM-DD) ou ''
  sortieReelle: string       // date de sortie réelle ou ''
  prepared:  boolean         // « Préparation OK »
  days:      number
  rate:      number | null
  amount:    number
  matched:   boolean         // rapprochée à une fiche VD Soft
  outcome:   string          // applied | already_set | ambiguous | no_match
  flag:      'ok' | 'warn'   // warn = ambigu/no_match (orange)
  missionId: string | null
  missionNumber: number | null
  plate:     string
  zone:      string | null
}

export interface VenteEpaveGroup {
  vente: string; firm: string; rows: VenteEpaveRow[]; days: number; amount: number
}

interface RateLine { price: number; cyclo: boolean; from: string; to: string | null }

export async function computeVenteEpavesRegister(
  sb: any, from: string, to: string,
): Promise<{ groups: VenteEpaveGroup[]; total: number; totalDays: number; count: number; matched: number; unmatched: number }> {
  // 1. Tarifs gardiennage saisie (par jour, car / cyclo).
  const { data: lines } = await sb.from('source_tariff_lines')
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

  // 2. Lignes du registre (trace) sur la période (filtre sur la date de vente).
  const { data: trace } = await sb.from('domaine_ventes_epaves')
    .select('id, vente_date, firm, numero, brand, model, vin, vin_tail, date_in, date_out, sortie_reelle_date, prepare_at, max_enlevement_date, matched_mission_id, outcome')
    .gte('vente_date', from).lte('vente_date', to)
    .limit(5000)
  const rowsT = trace || []

  // 3. Enrichissement fiches rapprochées (zone, plaque, dates de secours).
  const mIds = [...new Set(rowsT.map((r: any) => r.matched_mission_id).filter(Boolean))]
  const byMission = new Map<string, any>()
  if (mIds.length) {
    const { data: ms2 } = await sb.from('incoming_missions')
      .select('id, mission_number, vehicle_plate, parc_zone_key, domaine_remise_date, domaine_enlevement_date')
      .in('id', mIds)
    for (const m of (ms2 || [])) byMission.set(m.id, m)
  }

  const all: VenteEpaveRow[] = []
  for (const r of rowsT) {
    const m = r.matched_mission_id ? byMission.get(r.matched_mission_id) : null
    // Date IN = date du mail (date_in), sinon remise de la fiche. Date OUT =
    // override éditable, sinon date max d'enlèvement du mail, sinon enlèvement fiche.
    const dateIn  = r.date_in || m?.domaine_remise_date || ''
    const dateOut = r.date_out || r.max_enlevement_date || m?.domaine_enlevement_date || ''
    const cyclo   = isCyclo(`${r.brand || ''} ${r.model || ''}`)

    let days = 0, amount = 0
    const ratesUsed = new Set<number | null>()
    if (dateIn && dateOut && ms(dateOut) >= ms(dateIn)) {
      let cur = ms(dateIn); const end = ms(dateOut)
      while (cur < end) {
        const y = new Date(cur).getUTCFullYear()
        const yearEnd = Date.parse(`${y + 1}-01-01T00:00:00Z`)
        const segEnd = Math.min(end, yearEnd)
        const segDays = Math.floor((segEnd - cur) / DAY)
        if (segDays > 0) { const rt = rateFor(y, cyclo); ratesUsed.add(rt); days += segDays; amount += segDays * (rt || 0) }
        cur = yearEnd
      }
    }
    const matched = r.outcome === 'applied' || r.outcome === 'already_set'
    all.push({
      id: r.id,
      numero: r.numero || '',
      vehicle: [r.brand, r.model].filter(Boolean).join(' '),
      vin: r.vin || '',
      dateIn, dateOut,
      sortieReelle: r.sortie_reelle_date || '',
      prepared: !!r.prepare_at,
      days,
      rate: ratesUsed.size === 1 ? [...ratesUsed][0] : null,
      amount: Math.round(amount * 100) / 100,
      matched,
      outcome: r.outcome,
      flag: matched ? 'ok' : 'warn',
      missionId: r.matched_mission_id || null,
      missionNumber: m?.mission_number ?? null,
      plate: m?.vehicle_plate || '',
      zone: m?.parc_zone_key ?? null,
    })
  }

  // 4. Regroupement par vente (date + firme).
  const byVente = new Map<string, VenteEpaveRow[]>()
  const firmOf  = new Map<string, string>()
  for (let i = 0; i < all.length; i++) {
    const key = rowsT[i].vente_date
    const list = byVente.get(key) || []; list.push(all[i]); byVente.set(key, list)
    if (rowsT[i].firm) firmOf.set(key, rowsT[i].firm)
  }
  const groups: VenteEpaveGroup[] = [...byVente.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([vente, rows]) => {
      rows.sort((x, y) => (x.numero || '').localeCompare(y.numero || '', undefined, { numeric: true }))
      const days = rows.reduce((s, r) => s + r.days, 0)
      const amount = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
      return { vente, firm: firmOf.get(vente) || '', rows, days, amount }
    })

  const total = Math.round(groups.reduce((s, g) => s + g.amount, 0) * 100) / 100
  const totalDays = groups.reduce((s, g) => s + g.days, 0)
  const matched = all.filter(r => r.matched).length
  return { groups, total, totalDays, count: all.length, matched, unmatched: all.length - matched }
}
