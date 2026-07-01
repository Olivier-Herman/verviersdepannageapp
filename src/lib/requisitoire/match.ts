// src/lib/requisitoire/match.ts
//
// Rapprochement d'un réquisitoire extrait avec une fiche mission existante.
// Multi-signal (le n° de PV n'est PAS une clé : il n'est pas encore sur la
// fiche, c'est le réquisitoire qui l'apporte) :
//   - plaque exacte (normalisée)        → forte
//   - VIN 5 derniers caractères         → forte
//   - adresse (ville/tokens) + date     → moyenne
//   - marque / modèle                   → faible (corrobore)
//
// Convergence vers UNE seule fiche à score élevé → confidence 'high' (candidate
// à l'annexion auto plus tard) ; 0/ambigu/plusieurs → 'low'/'none' → file
// humaine. Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import type { RequisitoireExtract } from './extract'

export interface RequisitoireCandidate {
  mission_id:     string
  mission_number: string | null
  vehicle_plate:  string | null
  vehicle_vin:    string | null
  vehicle_brand:  string | null
  vehicle_model:  string | null
  incident_address: string | null
  incident_city:  string | null
  incident_at:    string | null
  status:         string | null
  dossier_number: string | null
  score:          number
  reasons:        string[]
}

export interface MatchResult {
  candidates: RequisitoireCandidate[]   // triés score desc
  confidence: 'high' | 'low' | 'none'
  best:       RequisitoireCandidate | null
}

const norm  = (v: string | null | undefined) => (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const last5 = (v: string | null | undefined) => { const n = norm(v); return n.length >= 5 ? n.slice(-5) : n }

// Retire les accents sans dépendre d'une classe de combinants littérale.
function stripAccents(s: string): string {
  return s.normalize('NFD').split('').filter(c => {
    const code = c.charCodeAt(0)
    return code < 0x0300 || code > 0x036f
  }).join('')
}

function daysApart(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const da = Date.parse(a), db = Date.parse(b)
  if (isNaN(da) || isNaN(db)) return null
  return Math.abs(da - db) / 86_400_000
}

function tokens(v: string | null | undefined): string[] {
  return stripAccents((v || '').toLowerCase()).split(/[^a-z0-9]+/).filter(t => t.length >= 3)
}

/**
 * Charge un jeu de fiches candidates (fenêtre récente + ciblage plaque/VIN)
 * et les score. `sb` = client admin Supabase.
 */
export async function findRequisitoireCandidates(sb: any, ex: RequisitoireExtract): Promise<MatchResult> {
  const cols = 'id, mission_number, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, incident_address, incident_city, incident_at, status, dossier_number, created_at, archived_at'

  const rowsById = new Map<string, any>()
  const addRows = (rows: any[] | null) => { for (const r of rows || []) if (r && !r.archived_at) rowsById.set(r.id, r) }

  // 1. Fenêtre récente (les fiches fourrière/parc sont récentes) — non archivées.
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString()
  {
    const { data } = await sb.from('incoming_missions').select(cols)
      .is('archived_at', null).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(800)
    addRows(data)
  }
  // 2. Ciblage VIN (5 derniers) — attrape aussi les fiches hors fenêtre.
  const vinTail = ex.vin ? last5(ex.vin) : ''
  if (vinTail.length >= 4) {
    const { data } = await sb.from('incoming_missions').select(cols)
      .is('archived_at', null).ilike('vehicle_vin', `%${vinTail}`).limit(50)
    addRows(data)
  }
  // 3. Ciblage plaque (contient) — best-effort, la normalisation fine se fait en JS.
  const plateCore = norm(ex.plaque)
  if (plateCore.length >= 4) {
    const inner = plateCore.length > 2 ? plateCore.slice(1, -1) : plateCore
    const { data } = await sb.from('incoming_missions').select(cols)
      .is('archived_at', null).ilike('vehicle_plate', `%${inner}%`).limit(50)
    addRows(data)
  }

  const exPlate = norm(ex.plaque)
  const exVinTail = vinTail
  const exCityTokens = new Set<string>(tokens(ex.adresse))
  const exBrand = (ex.marque || '').toLowerCase().trim()
  const exModel = (ex.modele || '').toLowerCase().trim()

  const candidates: RequisitoireCandidate[] = []
  for (const r of rowsById.values()) {
    let score = 0
    const reasons: string[] = []

    if (exPlate && norm(r.vehicle_plate) && norm(r.vehicle_plate) === exPlate) {
      score += 50; reasons.push('Plaque exacte')
    }
    if (exVinTail.length >= 5 && last5(r.vehicle_vin) === exVinTail) {
      score += 50; reasons.push('VIN (5 derniers) identiques')
    }
    // adresse : recouvrement de tokens (ville / rue)
    if (exCityTokens.size) {
      const rowTokens = new Set<string>([...tokens(r.incident_address), ...tokens(r.incident_city)])
      let overlap = 0
      for (const t of exCityTokens) if (rowTokens.has(t)) overlap++
      if (overlap >= 1) { score += Math.min(15, 5 + overlap * 5); reasons.push('Adresse concordante') }
    }
    // date : réquisitoire vs date d'intervention
    const dd = daysApart(ex.date_requisition, r.incident_at)
    if (dd != null && dd <= 3) { score += 15; reasons.push('Date proche') }
    else if (dd != null && dd <= 10) { score += 6; reasons.push('Date compatible') }
    // marque / modèle
    if (exBrand && (r.vehicle_brand || '').toLowerCase().includes(exBrand)) { score += 5; reasons.push('Marque') }
    if (exModel && (r.vehicle_model || '').toLowerCase().includes(exModel)) { score += 5; reasons.push('Modèle') }

    if (score > 0) {
      candidates.push({
        mission_id: r.id, mission_number: r.mission_number,
        vehicle_plate: r.vehicle_plate, vehicle_vin: r.vehicle_vin,
        vehicle_brand: r.vehicle_brand, vehicle_model: r.vehicle_model,
        incident_address: r.incident_address, incident_city: r.incident_city,
        incident_at: r.incident_at, status: r.status, dossier_number: r.dossier_number,
        score, reasons,
      })
    }
  }

  candidates.sort((a, b) => b.score - a.score)

  // Confiance : un seul candidat "fort" (≥50 = signal plaque OU VIN) et nettement
  // devant le 2e → high. Sinon low (si au moins un candidat) ou none.
  let confidence: MatchResult['confidence'] = 'none'
  if (candidates.length) {
    const top = candidates[0]
    const second = candidates[1]
    const strongUnique = top.score >= 50 && (!second || top.score - second.score >= 20)
    confidence = strongUnique ? 'high' : 'low'
  }

  return { candidates: candidates.slice(0, 8), confidence, best: candidates[0] || null }
}
