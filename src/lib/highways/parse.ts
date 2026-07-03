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
// notation belge "22+300" (= 22 km + 300 m). On tolère l'absence de mot-clé
// quand un nombre décimal suit directement l'autoroute.
const BORNE_KEYWORD_RE = /\b(?:b\.?\s?k\.?|p\.?\s?k\.?|borne|km)\s*[:.]?\s*(\d{1,3})(?:\s*[+]\s*(\d{1,3})|[.,](\d{1,3}))?/i
const BORNE_BELGE_RE   = /\b(\d{1,3})\s*\+\s*(\d{1,3})\b/                 // 22+300
const BORNE_DECIMAL_RE = /\b(\d{1,3})[.,](\d{1,2})\b/                    // 22.3 / 22,3

// Direction / sens : "direction Luxembourg", "dir. Aachen", "vers Liège",
// "sens Verviers". On capture jusqu'à une virgule / fin.
const DIRECTION_RE = /\b(?:direction|dir\.?|vers|sens)\s+([A-Za-zÀ-ÿ'’.\- ]{2,40}?)(?:[,;]|$)/i

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

  // Borne : priorité au mot-clé (BK/PK/borne/km), puis notation belge, puis décimal.
  let km: number | null = null
  const mk = text.match(BORNE_KEYWORD_RE)
  if (mk) {
    km = toKm(mk[1], mk[2], mk[3])
  } else {
    const mb = text.match(BORNE_BELGE_RE)
    if (mb) km = toKm(mb[1], mb[2])
    else {
      const md = text.match(BORNE_DECIMAL_RE)
      if (md) km = toKm(md[1], undefined, md[2])
    }
  }

  let direction: string | null = null
  const md = text.match(DIRECTION_RE)
  if (md) direction = md[1].trim().replace(/\s+/g, ' ')

  return {
    ok:         !!(highwayRef && km != null),
    highwayRef,
    km,
    borneLabel: km != null ? fmtKm(km) : null,
    direction,
  }
}
