// src/lib/access.ts
//
// Contrôle d'accès basé SESSION. next-auth peuple role/roles/modules sur la
// session (les MODULES viennent de la table `user_modules` via loadModules —
// il n'y a PAS de colonne `users.modules`). Ne JAMAIS faire
// `users.select('...modules...')` : la requête échoue (colonne inexistante) →
// data null → 403 pour tout le monde. Toujours lire l'accès depuis la session.
// Olivier 2026-08-09.

export interface SessionAccess {
  id:      string | null
  ok:      boolean
  roles:   string[]
  modules: string[]
}

/**
 * Résout l'accès d'une session.
 *   opts.roles   — rôles qui donnent accès (défaut admin/superadmin)
 *   opts.modules — modules qui donnent accès (défaut aucun)
 * ok = true si l'un des rôles OU l'un des modules matche.
 */
export function sessionAccess(
  session: any,
  opts: { roles?: string[]; modules?: string[] } = {},
): SessionAccess {
  const u = session?.user || null
  const roles   = u ? ([u.role, ...(Array.isArray(u.roles) ? u.roles : [])].filter(Boolean) as string[]) : []
  const modules = u && Array.isArray(u.modules) ? (u.modules as string[]) : []
  const allowRoles   = opts.roles   ?? ['admin', 'superadmin']
  const allowModules = opts.modules ?? []
  const ok = !!u && (roles.some(r => allowRoles.includes(r)) || modules.some(m => allowModules.includes(m)))
  return { id: (u?.id as string) || null, ok, roles, modules }
}
