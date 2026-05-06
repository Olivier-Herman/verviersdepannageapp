// src/components/ui/Avatar/colors.ts
//
// Mapping hybride couleur d'avatar :
// - 5 utilisateurs core ont une couleur fixe (par userId ET par prénom lowercase)
// - Sinon : hash du `email` (préféré, plus stable que `name`) → palette de fallback
//
// Décision Olivier : email préféré au name pour le hash car name peut changer
// avec accents/casse.

/**
 * Couleur fixe pour les 5 utilisateurs core.
 * Clé = userId (string) OU prénom lowercase (premier mot du `name`).
 * Une même couleur peut donc être atteinte par 2 routes (userId ou prénom).
 */
export const CORE_USER_COLORS: Record<string, string> = {
  // Mobi (id 8) → rouge marque
  '8':       'bg-gradient-to-br from-red-500 to-red-700',
  mobi:      'bg-gradient-to-br from-red-500 to-red-700',
  // Jonathan (id 7) → bleu
  '7':       'bg-gradient-to-br from-blue-500 to-blue-700',
  jonathan:  'bg-gradient-to-br from-blue-500 to-blue-700',
  // Frédéric Bovy → orange
  bovy:      'bg-gradient-to-br from-orange-500 to-orange-600',
  // Frédéric Palm → vert
  palm:      'bg-gradient-to-br from-green-500 to-green-700',
  // Momo (id 5) → gris (stone, palette chaude)
  '5':       'bg-gradient-to-br from-stone-400 to-stone-600',
  momo:      'bg-gradient-to-br from-stone-400 to-stone-600',
}

/**
 * Palette de 8 gradients harmonieux pour les utilisateurs hors core.
 * Évite tout conflit avec les couleurs core (rouge/bleu/orange/vert/gris).
 */
export const FALLBACK_PALETTE: string[] = [
  'bg-gradient-to-br from-violet-500 to-violet-700',
  'bg-gradient-to-br from-cyan-500 to-cyan-700',
  'bg-gradient-to-br from-pink-500 to-pink-700',
  'bg-gradient-to-br from-amber-500 to-amber-700',
  'bg-gradient-to-br from-emerald-500 to-emerald-700',
  'bg-gradient-to-br from-fuchsia-500 to-fuchsia-700',
  'bg-gradient-to-br from-teal-500 to-teal-700',
  'bg-gradient-to-br from-indigo-500 to-indigo-700',
]

/** Hash 32-bit déterministe (djb2-like). */
function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Détermine la classe gradient Tailwind pour un avatar.
 *
 * Ordre :
 *   1. Match `userId` dans CORE_USER_COLORS
 *   2. Match DERNIER mot lowercase (nom de famille) dans CORE_USER_COLORS
 *      → permet de distinguer "Frédéric Palm" et "Frédéric Bovy" qui partagent
 *        le même prénom et auraient sinon la même couleur.
 *   3. Match PREMIER mot lowercase (prénom) dans CORE_USER_COLORS
 *      → cas "Mobi" / "Jonathan" / "Momo" donnés en simple prénom.
 *   4. Hash de `email` (préféré) ou `name` modulo FALLBACK_PALETTE.length
 */
export function getAvatarColor(opts: {
  userId?: string | number
  email?:  string
  name?:   string
}): string {
  if (opts.userId !== undefined && opts.userId !== null) {
    const k = String(opts.userId)
    if (CORE_USER_COLORS[k]) return CORE_USER_COLORS[k]
  }
  if (opts.name) {
    // On filtre les tokens qui ne commencent pas par une lettre (ex: "Mobi - VD"
    // donne ["mobi", "-", "vd"] → on garde ["mobi", "vd"]).
    const words = opts.name
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(w => /^\p{L}/u.test(w))
    const last = words[words.length - 1]
    if (last && CORE_USER_COLORS[last]) return CORE_USER_COLORS[last]
    const first = words[0]
    if (first && CORE_USER_COLORS[first]) return CORE_USER_COLORS[first]
  }
  const seed = (opts.email || opts.name || '').trim().toLowerCase()
  if (!seed) return FALLBACK_PALETTE[0]
  return FALLBACK_PALETTE[hashCode(seed) % FALLBACK_PALETTE.length]
}

/**
 * Initiales lisibles à partir d'un nom complet.
 *
 * Règles :
 *   - 1 token : 1ère lettre (ex: "Jonathan" → "J", "Mobi" → "M")
 *   - 2+ tokens : 1ère lettre du 1er + 1ère lettre du dernier
 *     (ex: "Frédéric Palm" → "FP", "Marie-Claire Dupont" → "MD")
 *   - Apostrophes et tirets INTERNES à un mot sont tolérés et exploités :
 *     - "O'Brien"          → "OB"  (1 token, sub-parts O / Brien)
 *     - "Jean-Pierre"      → "JP"  (1 token, sub-parts Jean / Pierre)
 *     - "O'Brien Dupont"   → "OD"  (2 tokens, 1ères lettres)
 *     - "Jean-Pierre Bovy" → "JB"  (2 tokens, 1ères lettres)
 *   - Token de ponctuation seul (espaces autour) → on s'arrête au token précédent :
 *     - "Mobi - VD"        → "M"   ("-" entre espaces interrompt la séquence)
 *   - "" / null / nom sans lettre → "?"
 */
export function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  const trimmed = name.trim()
  if (!trimmed) return '?'

  // Token "valide" = au moins une lettre, peut contenir apostrophes / tirets internes
  const isLetterToken = (s: string) =>
    /^\p{L}+([-'’‘][\p{L}]+)*$/u.test(s)

  const allTokens = trimmed.split(/\s+/).filter(Boolean)
  // On collecte les tokens valides en ordre, et on s'arrête dès qu'on rencontre
  // un token non-valide (ponctuation seule comme "-", "·", "/", etc.).
  const validTokens: string[] = []
  for (const t of allTokens) {
    if (isLetterToken(t)) validTokens.push(t)
    else break
  }

  if (validTokens.length === 0) {
    // Fallback : 1er caractère du nom complet, à défaut "?"
    return trimmed[0]?.toUpperCase() || '?'
  }

  if (validTokens.length === 1) {
    // Un seul token valide → on regarde s'il a des sous-parties internes
    // (apostrophes/tirets) pour extraire 2 initiales (ex: "O'Brien" → "OB").
    const parts = validTokens[0].split(/['’‘\-]/u).filter(Boolean)
    if (parts.length === 1) return parts[0][0].toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }

  // 2+ tokens valides → 1ère lettre du 1er + 1ère lettre du dernier
  return (validTokens[0][0] + validTokens[validTokens.length - 1][0]).toUpperCase()
}
