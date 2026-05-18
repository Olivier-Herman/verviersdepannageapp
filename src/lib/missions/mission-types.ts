// src/lib/missions/mission-types.ts
//
// Helpers centraux pour gerer les variantes de mission_type dans la DB.
// La valeur peut être stockee en plusieurs formats selon la source :
//   - Imports (VAB, etc.)         : minuscules ('remorquage', 'depannage')
//   - Dispatcher manuel (NewMissionClient) : majuscules ('REM', 'DSP')
//   - Wrapper iOS (driver-action change_type) : peut envoyer majuscules
//   - Anciens dossiers             : 'reparation_place' = synonyme de DSP
//
// Ces helpers normalisent + matchent tous les variants pour eviter les
// comparaisons strictes qui ratent des cas.

/** Normalise une valeur de mission_type (lowercase + trim, gere null/undefined). */
export const normalizeType = (t: string | null | undefined): string =>
  (t ?? '').toLowerCase().trim()

/** True si la mission est de type Remorquage (REM, remorquage, casse libre). */
export const isRemorquage = (t: string | null | undefined): boolean =>
  ['rem', 'remorquage'].includes(normalizeType(t))

/** True si la mission est de type Depannage / DSP / Reparation sur place
 *  (DSP, depannage, reparation_place, casse libre). DSP et reparation_place
 *  sont semantiquement identiques. */
export const isDsp = (t: string | null | undefined): boolean =>
  ['dsp', 'depannage', 'reparation_place'].includes(normalizeType(t))

/** True si Trajet a vide. */
export const isTrajetVide = (t: string | null | undefined): boolean =>
  normalizeType(t) === 'trajet_vide'

/** True si Transport / Rapatriement. */
export const isTransport = (t: string | null | undefined): boolean =>
  normalizeType(t) === 'transport'

/** Variantes DB pour filter .in() Supabase (qui ne supporte pas insensible
 *  casse nativement). Utilise avec .in('mission_type', TYPE_VARIANTS[canon]). */
export const TYPE_VARIANTS: Record<string, string[]> = {
  remorquage:  ['rem', 'REM', 'Rem', 'remorquage', 'Remorquage', 'REMORQUAGE'],
  depannage:   ['dsp', 'DSP', 'Dsp', 'depannage', 'Depannage', 'DEPANNAGE', 'reparation_place', 'REPARATION_PLACE'],
  trajet_vide: ['trajet_vide', 'TRAJET_VIDE'],
  transport:   ['transport', 'Transport', 'TRANSPORT'],
}

/** Label court par defaut (REM, DSP, Transport, TVD). */
export const TYPE_LABEL_SHORT: Record<string, string> = {
  remorquage:       'REM',
  depannage:        'DSP',
  reparation_place: 'DSP', // alias
  transport:        'Transport',
  trajet_vide:      'TVD',
}

/** Label long avec emoji pour notif / affichage detaille. */
export const TYPE_LABEL_LONG: Record<string, string> = {
  remorquage:       '🚛 Remorquage',
  depannage:        '🔧 Dépannage',
  reparation_place: '🔧 Dépannage', // alias
  transport:        '🚐 Transport',
  trajet_vide:      '📍 Trajet à vide',
}

/** Helper pour recuperer le label depuis n importe quelle valeur DB.
 *  Insensible a la casse. Retourne la valeur brute en fallback. */
export const getMissionTypeLabel = (
  t: string | null | undefined,
  format: 'short' | 'long' = 'short',
): string => {
  const norm = normalizeType(t)
  const dict = format === 'short' ? TYPE_LABEL_SHORT : TYPE_LABEL_LONG
  return dict[norm] || t || '—'
}
