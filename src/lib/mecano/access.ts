// src/lib/mecano/access.ts
//
// Accès « La tête à Matthieu » — pour l'instant restreint à Matthieu + superadmin
// (phase de test). Élargir aux chauffeurs quand validé (Olivier 2026-08-03).

export const MATTHIEU_USER_ID = 'de1c6853-fd3c-47fc-b755-82c5b13b0322'

// Lancement 2026-08-03 : ouvert à tout le personnel (chauffeurs, dispatch, admin,
// rh, superadmin). Exclut uniquement les partenaires externes (garages).
export function canUseMatthieu(role?: string | null, _userId?: string | null): boolean {
  return !!role && role !== 'garage' && role !== 'partner'
}
