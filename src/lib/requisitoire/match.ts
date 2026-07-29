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
  autoAttach: boolean                   // clé forte + adresse précise + unique + date cohérente
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

// Mots vides d'adresse (types de voie, articles) : présents dans presque toutes
// les adresses → aucun pouvoir discriminant. À exclure du scoring.
const ADDR_STOP = new Set([
  'rue','av','ave','avenue','chaussee','chau','boulevard','bld','bd','place','pl',
  'quai','chemin','clos','impasse','allee','all','route','rte','voie','sentier',
  'de','du','des','la','le','les','saint','ste','sur','au','aux','en','residence','res',
])

/**
 * Classe les tokens d'une adresse :
 *  - distinctive : noms propres (rue « hodimont », localité « verviers »…) → fort
 *  - cp          : codes postaux (numériques) → faible (toute la ville les partage)
 */
function classifyAddr(v: string | null | undefined): { distinctive: Set<string>; cp: Set<string> } {
  const distinctive = new Set<string>()
  const cp = new Set<string>()
  for (const t of tokens(v)) {
    if (/^\d+$/.test(t)) cp.add(t)
    else if (!ADDR_STOP.has(t)) distinctive.add(t)
  }
  return { distinctive, cp }
}

/**
 * Charge un jeu de fiches candidates (fenêtre récente + ciblage plaque/VIN)
 * et les score. `sb` = client admin Supabase.
 */
export async function findRequisitoireCandidates(sb: any, ex: RequisitoireExtract): Promise<MatchResult> {
  const cols = 'id, mission_number, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, incident_address, incident_city, incident_at, status, dossier_number, source, created_at, archived_at'

  // Un réquisitoire (saisie police) ne concerne QUE des fiches de source Police
  // (saisie/accident/mal garée/SNC/AVP/rodéo…). On filtre là-dessus pour écarter
  // le bruit (fiches assistance/privé à la même adresse ou date). Olivier 2026-07-06.
  const POLICE = '%police%'

  const rowsById = new Map<string, any>()
  const addRows = (rows: any[] | null) => { for (const r of rows || []) if (r && !r.archived_at) rowsById.set(r.id, r) }

  // 1. Fenêtre récente (les fiches fourrière/parc sont récentes) — non archivées.
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString()
  {
    const { data } = await sb.from('incoming_missions').select(cols)
      .is('archived_at', null).ilike('source', POLICE).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(800)
    addRows(data)
  }
  // 2. Ciblage VIN (5 derniers) — attrape aussi les fiches hors fenêtre.
  const vinTail = ex.vin ? last5(ex.vin) : ''
  if (vinTail.length >= 4) {
    const { data } = await sb.from('incoming_missions').select(cols)
      .is('archived_at', null).ilike('source', POLICE).ilike('vehicle_vin', `%${vinTail}`).limit(50)
    addRows(data)
  }
  // 3. Ciblage plaque (contient) — best-effort, la normalisation fine se fait en JS.
  const plateCore = norm(ex.plaque)
  if (plateCore.length >= 4) {
    const inner = plateCore.length > 2 ? plateCore.slice(1, -1) : plateCore
    const { data } = await sb.from('incoming_missions').select(cols)
      .is('archived_at', null).ilike('source', POLICE).ilike('vehicle_plate', `%${inner}%`).limit(50)
    addRows(data)
  }
  // 4. Ciblage ADRESSE (rue / code postal / ville) — attrape les fiches HORS de la
  //    fenêtre récente quand le réquisitoire n'a NI plaque NI VIN présent sur la
  //    fiche (cas fréquent : saisie ancienne, réquisitoire arrivé plus tard).
  //    Olivier 2026-07-06 : sans ça, une fiche qui colle sur adresse+date+marque
  //    n'était jamais proposée si elle sortait du top 800 récent.
  const addrTargets = Array.from(new Set(tokens(ex.adresse).filter(t => t.length >= 4))).slice(0, 5)
  for (const t of addrTargets) {
    const { data } = await sb.from('incoming_missions').select(cols)
      .is('archived_at', null).ilike('source', POLICE)
      .or(`incident_address.ilike.%${t}%,incident_city.ilike.%${t}%`)
      .order('created_at', { ascending: false }).limit(60)
    addRows(data)
  }

  const exPlate = norm(ex.plaque)
  const exVinTail = vinTail
  const exAddr = classifyAddr(ex.adresse)
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
    // Adresse : un token DISTINCTIF partagé (nom de rue / localité, ex « hodimont »)
    // vaut BEAUCOUP plus qu'un simple code postal (que toute la ville partage).
    // Une RUE exacte doit primer sur « même ville + date proche ».
    if (exAddr.distinctive.size || exAddr.cp.size) {
      const rAddr = classifyAddr(`${r.incident_address || ''} ${r.incident_city || ''}`)
      let distinct = 0
      for (const t of exAddr.distinctive) if (rAddr.distinctive.has(t)) distinct++
      let cp = 0
      for (const t of exAddr.cp) if (rAddr.cp.has(t)) cp++
      if (distinct > 0) { score += Math.min(24, distinct * 12); reasons.push(distinct >= 2 ? 'Adresse précise' : 'Adresse concordante') }
      else if (cp > 0)  { score += 4; reasons.push('Même localité') }
    }
    // date de réquisition vs date d'intervention. Présente sur le doc :
    //   - ≤ 1 j  → concorde → renforce la confiance
    //   - > 1 j  → CONTREDIT → pénalité (diminue la confiance)
    // Absente → neutre. Olivier 2026-07-29.
    const dd = daysApart(ex.date_requisition, r.incident_at)
    if (dd != null) {
      if (dd <= 1) { score += 15; reasons.push('Date concordante') }
      else         { score -= 15; reasons.push('Date discordante (>1j)') }
    }
    // marque / modèle : corroboration spécifique. Le duo marque+modèle est un
    // signal fort (surtout couplé à une rue exacte) → bonus combiné.
    const brandOk = !!exBrand && (r.vehicle_brand || '').toLowerCase().includes(exBrand)
    const modelOk = !!exModel && (r.vehicle_model || '').toLowerCase().includes(exModel)
    if (brandOk) { score += 8; reasons.push('Marque') }
    if (modelOk) { score += 8; reasons.push('Modèle') }
    if (brandOk && modelOk) { score += 6 }   // bonus duo marque+modèle

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

  // Confiance : 'high' (= candidat à l'auto-attache) UNIQUEMENT sur une clé forte
  // d'identité (plaque OU VIN) nettement en tête. Marque + adresse, même parfaits,
  // restent 'low' → proposés en tête mais rattachement MANUEL (on n'auto-attache
  // jamais sans plaque/VIN). Olivier 2026-07-06.
  let confidence: MatchResult['confidence'] = 'none'
  let autoAttach = false
  if (candidates.length) {
    const top = candidates[0]
    const second = candidates[1]
    const hasStrongKey = top.reasons.some(r => r.startsWith('Plaque') || r.startsWith('VIN'))
    const strongUnique = hasStrongKey && top.score >= 50 && (!second || top.score - second.score >= 20)
    confidence = strongUnique ? 'high' : 'low'

    // Auto-rattachement (Olivier 2026-07-29) : clé forte + ADRESSE PRÉCISE +
    // candidat unique, et la date de réquisition (si présente sur le doc) ne
    // contredit pas : elle doit être à ≤ 1 JOUR de la fiche. Date absente =
    // n'empêche pas ; date présente mais > 1 j = on bloque (→ manuel). Les LEVÉES
    // sont exclues en amont (intake) car elles arrêtent le gardiennage.
    const preciseAddr = top.reasons.includes('Adresse précise')
    const dd = daysApart(ex.date_requisition, top.incident_at)
    const dateOk = (dd == null) || dd <= 1
    autoAttach = strongUnique && preciseAddr && dateOk
  }

  return { candidates: candidates.slice(0, 8), confidence, best: candidates[0] || null, autoAttach }
}
