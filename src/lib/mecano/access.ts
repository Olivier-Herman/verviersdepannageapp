// src/lib/mecano/access.ts
//
// Accès « La tête à Matthieu » — pour l'instant restreint à Matthieu + superadmin
// (phase de test). Élargir aux chauffeurs quand validé (Olivier 2026-08-03).

export const MATTHIEU_USER_ID = 'de1c6853-fd3c-47fc-b755-82c5b13b0322'

export function canUseMatthieu(role?: string | null, userId?: string | null): boolean {
  return role === 'superadmin' || userId === MATTHIEU_USER_ID
}
