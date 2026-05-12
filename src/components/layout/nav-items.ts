// src/components/layout/nav-items.ts
//
// Liste canonique des entrées du menu de gauche, partagée entre tous les
// layouts (AppShell, AdminLayoutClient, Sidebar custom dispatch).
// Chaque entrée a :
//   - moduleId : permission par module (granted dans /admin/users)
//   - role     : permission par role (alternative pour les pages role-based)
//   - moduleId === null + role === undefined → toujours visible (Dashboard)

export interface NavItem {
  href:     string
  label:    string
  icon:     string
  moduleId: string | null
  role?:    'dispatcher_or_admin'
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',     label: 'Dashboard',        icon: '🏠', moduleId: null },
  { href: '/dispatch',      label: 'Dispatch',         icon: '📡', moduleId: 'missions' },
  { href: '/mission',       label: 'Mes Missions',     icon: '🚗', moduleId: 'driver_missions' },
  { href: '/services/tgr',  label: 'TGR Touring',      icon: '🛡️', moduleId: 'tgr' },
  { href: '/facturation',   label: 'Facturation',      icon: '🧾', moduleId: 'facturation' },
  { href: '/finance',       label: 'Finance',          icon: '💵', moduleId: 'finance' },
  { href: '/fourriere',     label: 'Fourrière',        icon: '🚓', moduleId: 'fourriere' },
  { href: '/check-vehicule',label: 'Check Véhicule',   icon: '🔍', moduleId: 'check_vehicle' },
  { href: '/garde',         label: 'Garde',            icon: '🛡️', moduleId: null, role: 'dispatcher_or_admin' },
  { href: '/admin',         label: 'Administration',   icon: '⚙️', moduleId: 'admin' },
  { href: '/profil',        label: 'Mon Profil',       icon: '👤', moduleId: null },
]

/**
 * Filtre les NAV_ITEMS selon les modules accordés à l'utilisateur et son rôle.
 * Retourne les items visibles dans l'ordre d'affichage.
 */
export function filterNavItems(opts: {
  userModules: string[]
  userRole:    string
}): NavItem[] {
  const { userModules, userRole } = opts
  const isAdmin      = ['admin', 'superadmin'].includes(userRole)
  const isDispatcher = ['dispatcher', 'admin', 'superadmin'].includes(userRole)

  return NAV_ITEMS.filter(item => {
    if (item.role === 'dispatcher_or_admin') return isDispatcher
    if (item.moduleId === null) return true
    if (item.moduleId === 'admin') return isAdmin
    if (item.moduleId === 'finance') {
      return userModules.includes('encaissement')
          || userModules.includes('encaissements')
          || userModules.includes('caisse')
          || userModules.includes('avance_fonds')
          || userModules.includes('relances')
    }
    return userModules.includes(item.moduleId)
  })
}
