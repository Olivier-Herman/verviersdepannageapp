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

/** True si Relivraison (vehicule en parc -> client). */
export const isRelivraison = (t: string | null | undefined): boolean =>
  ['rel', 'relivraison'].includes(normalizeType(t))

/** True si Remorquage avec etape parc puis relivraison (REM+REL). */
export const isRemRel = (t: string | null | undefined): boolean =>
  ['rem+rel', 'rem_rel', 'remrel'].includes(normalizeType(t))

/** Variantes DB pour filter .in() Supabase (qui ne supporte pas insensible
 *  casse nativement). Utilise avec .in('mission_type', TYPE_VARIANTS[canon]). */
export const TYPE_VARIANTS: Record<string, string[]> = {
  remorquage:   ['rem', 'REM', 'Rem', 'remorquage', 'Remorquage', 'REMORQUAGE'],
  depannage:    ['dsp', 'DSP', 'Dsp', 'depannage', 'Depannage', 'DEPANNAGE', 'reparation_place', 'REPARATION_PLACE'],
  trajet_vide:  ['trajet_vide', 'TRAJET_VIDE'],
  transport:    ['transport', 'Transport', 'TRANSPORT'],
  relivraison:  ['rel', 'REL', 'Rel', 'relivraison', 'Relivraison', 'RELIVRAISON'],
  remorquage_relivraison: ['rem+rel', 'REM+REL', 'rem_rel', 'REM_REL'],
}

/** Label court par defaut (REM, DSP, Transport, TVD). */
export const TYPE_LABEL_SHORT: Record<string, string> = {
  // Source Gardiennage : le type designe le regime de gardiennage applique
  // (grille /admin/tarifs), pas un deplacement. Olivier 2026-08-26.
  assistance:             'Assistance',
  saisie:                 'Saisie',
  siabis:                 'Siabis',
  autre:                  'Autre',
  remorquage:             'REM',
  depannage:              'DSP',
  reparation_place:       'DSP', // alias
  transport:              'Transport',
  trajet_vide:            'TVD',
  relivraison:            'REL',
  remorquage_relivraison: 'REM+REL',
}

/** Label long avec emoji pour notif / affichage detaille. */
export const TYPE_LABEL_LONG: Record<string, string> = {
  assistance:             '🛟 Gardiennage Assistance',
  saisie:                 '⚖️ Gardiennage Saisie',
  siabis:                 '🛣️ Gardiennage Siabis',
  autre:                  '📦 Autre',
  remorquage:             '🚛 Remorquage',
  depannage:              '🔧 Dépannage',
  reparation_place:       '🔧 Dépannage', // alias
  transport:              '🚐 Transport',
  trajet_vide:            '📍 Trajet à vide',
  relivraison:            '🚚 Relivraison',
  remorquage_relivraison: '🚛 Remorquage + 🚚 Relivraison',
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

// ── CATALOGUE DES TYPES (audit dispatch P3, 14/09/2026) ─────────────────────
// Les listes de types vivaient en dur dans sept écrans (fiche, dossier, tarifs,
// stats, facturation…), chacune à sa façon. Elles se lisent ici et nulle part
// ailleurs — cf [[project_admin_zero_hardcode]].

/** Types proposés dans les sélecteurs (fiche dispatch, Vue dossier). */
export const MISSION_TYPE_KEYS = ['remorquage', 'depannage', 'transport', 'trajet_vide', 'reparation_place', 'relivraison', 'autre'] as const
/** Source Gardiennage : le véhicule entre au parc sans déplacement, le « type »
 *  désigne le régime de gardiennage appliqué (grille /admin/tarifs). Olivier 2026-08-26. */
export const GARDIENNAGE_TYPE_KEYS = ['assistance', 'saisie', 'siabis', 'autre'] as const

/** Types proposés pour une source donnée. */
export const typesForSource = (src: string | null | undefined): string[] =>
  normalizeType(src) === 'gardiennage' ? [...GARDIENNAGE_TYPE_KEYS] : [...MISSION_TYPE_KEYS]

/** Libellé de sélecteur (« REM — remorquage »). */
export const TYPE_LABEL_SELECT: Record<string, string> = {
  remorquage:       'REM — remorquage',
  depannage:        'DSP — dépannage sur place',
  transport:        'Transport',
  trajet_vide:      'TVD — trajet à vide',
  reparation_place: 'RPL — réparation sur place',
  relivraison:      'REL — relivraison',
  autre:            'Autre',
}

/** Intervention SANS destination : dépannage sur place, réparation sur place, trajet à vide. */
export const isSansDestination = (t: string | null | undefined): boolean =>
  isDsp(t) || isTrajetVide(t)

export type MissionKind = 'REL' | 'REM' | 'DSP' | 'DPR' | 'AUTRE'

/** Famille d'une mission pour les listes (Missions terminées, Facturation, modale Facturer).
 *  REL : type relivraison, OU incident_type='relivraison' (Kaze), OU fiche enfant (parent_mission_id). */
export function missionKind(m: { mission_type?: string | null; incident_type?: string | null; parent_mission_id?: string | null }): MissionKind {
  const it = normalizeType(m.incident_type)
  if (isRelivraison(m.mission_type) || it === 'relivraison' || m.parent_mission_id) return 'REL'
  if (it === 'dpr')                       return 'DPR'
  if (isRemorquage(m.mission_type))       return 'REM'
  if (isSansDestination(m.mission_type))  return 'DSP'
  return 'AUTRE'
}
