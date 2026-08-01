// src/lib/rh-access.ts
//
// Accès au module « Gestion du personnel » (Répertoire, Prestations, Rentabilité).
// = superadmin OU rôle RH. Vérifie le rôle principal ET le tableau roles[].
// Olivier 2026-08-01 : le rôle 'rh' n'est attribué à personne tant que le module
// n'est pas validé (il ne s'affiche donc pas encore aux non-superadmins).

export function isPersonnelStaff(u: any): boolean {
  if (!u) return false
  const roles = [u.role, ...(Array.isArray(u.roles) ? u.roles : [])]
  return roles.includes('superadmin') || roles.includes('rh')
}
