// src/lib/highways/parse.ts
//
// Analyse d'une adresse d'intervention "autoroute" saisie librement par le
// chauffeur ou l'assistance, du type :
//   "A27 BK22.3 direction Luxembourg"
//   "A3 borne 78+300 vers Aachen"
//   "E42 / A27 pk 22,3 sens Verviers"
//
// → extrait l'autoroute (réf. A-number), la borne kilométrique (en km décimal),
//   la borne "brute" telle qu'affichée, et la direction/sens.
//
// Ces adresses ne sont pas géocodables par Google → on les résout ensuite via le
// service des bornes kilométriques du SPW (voir spw-bk.ts).

export interface ParsedHighway {
  ok:          boolean
  highwayRef:  string | null   // ex "A27" (lettre + numéro, sans zéro de tête)
  km:          number | null   // ex 22.3 (en kilomètres décimaux)
  borneLabel:  string | null   // ex "22.3" (forme normalisée pour le champ BK)
  direction:   string | null   // ex "Luxembourg"
}

// Autoroute belge : A + 1-3 chiffres (A27, A3, A601...). On accepte aussi un
// éventuel suffixe (A601a) mais on le garde tel quel.
const HIGHWAY_RE = /\bA\s?0*(\d{1,3}[a-z]?)\b/i

// Borne : "BK 22.3", "B.K.22,3", "borne 22.3", "PK 22.3", "km 22.3",
// notation belge "22+300" (= 22 km + 300 m), décimal nu "22.3", ou entier nu
// "22". La recherche se fait APRÈS l'autoroute pour ne pas confondre avec son
// numéro.
const BORNE_KEYWORD_RE = /\b(?:b\.?\s?k\.?|p\.?\s?k\.?|borne|km)\s*[:.]?\s*(\d{1,3})(?:\s*[+]\s*(\d{1,3})|[.,](\d{1,3}))?/i
const BORNE_BELGE_RE   = /\b(\d{1,3})\s*\+\s*(\d{1,3})\b/                 // 22+300
const BORNE_DECIMAL_RE = /\b(\d{1,3})[.,](\d{1,2})\b/                    // 22.3 / 22,3
const BORNE_INT_RE     = /\b(\d{1,3})\b/                                 // 22 (entier nu)

// Direction / sens avec mot-clé : "direction Luxembourg", "dir. Aachen",
// "vers Liège", "sens Verviers". On capture jusqu'à une virgule / fin.
const DIRECTION_RE = /\b(?:direction|dir\.?|vers|sens)\s+([A-Za-zÀ-ÿ'’.\- ]{2,40}?)(?:[,;]|$)/i
// Mots-clés de borne, à retirer avant le repli "direction en un mot".
const BORNE_WORDS_RE = /\b(?:b\.?\s?k\.?|p\.?\s?k\.?|borne|km|pk)\b/gi

/** Convertit une borne "22", "22.3", "22+300" en km décimal. */
function toKm(whole: string, plusMeters?: string, decimals?: string): number {
  const w = parseInt(whole, 10)
  if (plusMeters != null) return w + parseInt(plusMeters, 10) / 1000        // 22+300 → 22.3
  if (decimals   != null) return parseFloat(`${w}.${decimals}`)             // 22.3
  return w
}

/** Formate un km décimal en libellé court "22.3" (sans zéros inutiles). */
function fmtKm(km: number): string {
  return (Math.round(km * 1000) / 1000).toString()
}

export function parseHighwayAddress(input: string | null | undefined): ParsedHighway {
  const empty: ParsedHighway = { ok: false, highwayRef: null, km: null, borneLabel: null, direction: null }
  if (!input) return empty
  const text = input.trim()

  const hw = text.match(HIGHWAY_RE)
  const highwayRef = hw ? `A${hw[1].toUpperCase()}` : null

  // On cherche la borne APRÈS l'autoroute pour ne pas prendre son numéro.
  const after = hw ? text.slice((hw.index || 0) + hw[0].length) : text

  // Borne : mot-clé (BK/PK/borne/km) > notation belge (22+300) > décimal (22.3)
  // > entier nu (22).
  let km: number | null = null
  let m: RegExpMatchArray | null
  if      ((m = after.match(BORNE_KEYWORD_RE))) km = toKm(m[1], m[2], m[3])
  else if ((m = after.match(BORNE_BELGE_RE)))   km = toKm(m[1], m[2])
  else if ((m = after.match(BORNE_DECIMAL_RE))) km = toKm(m[1], undefined, m[2])
  else if ((m = after.match(BORNE_INT_RE)))     km = toKm(m[1])

  // Direction : mot-clé explicite, sinon repli "un seul mot restant" (ex "lux",
  // "Liège") une fois l'autoroute + la borne retirées.
  let direction: string | null = null
  const md = text.match(DIRECTION_RE)
  if (md) {
    direction = md[1].trim().replace(/\s+/g, ' ')
  } else {
    const rest = after.replace(BORNE_WORDS_RE, ' ').replace(/[\d.,+]/g, ' ')
    const tokens = rest.split(/[\s;]+/).filter(t => t.length >= 2 && /^[A-Za-zÀ-ÿ'’.\-]+$/.test(t))
    if (tokens.length === 1) direction = tokens[0]
  }

  return {
    ok:         !!(highwayRef && km != null),
    highwayRef,
    km,
    borneLabel: km != null ? fmtKm(km) : null,
    direction,
  }
}

// Heuristique LARGE « cette adresse est-elle sur autoroute ? » — utilisée pour
// PROPOSER (modal) un basculement en Siabis à la validation dispatch. Les faux
// positifs sont acceptables : le dispatcher peut choisir « Laisser en normal ».
// Détecte : réf autoroute A-number (via parseHighwayAddress), réf E-number
// (E40, E42, E411…), mots-clés « autoroute » / « voie rapide » / « bretelle »,
// ou un marqueur de borne kilométrique (BK / PK) — typique des adresses Touring
// sur autoroute (« E42 BK 22.3 sens Liège »).
const HIGHWAY_HINT_RE = /\bautoroute\b|\bvoie\s+rapide\b|\bbretelle\b|\bE\s?0*\d{1,3}[a-z]?\b|\b(?:b\.?\s?k|p\.?\s?k)\b\.?\s*\d/i
export function isHighwayAddress(input: string | null | undefined): boolean {
  if (!input) return false
  if (parseHighwayAddress(input).highwayRef) return true
  return HIGHWAY_HINT_RE.test(input)
}
