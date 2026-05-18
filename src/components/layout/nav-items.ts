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
  { href: '/recherche',     label: 'Recherche',        icon: '🔍', moduleId: null },
  { href: '/dispatch',      label: 'Dispatch',         icon: '📡', moduleId: 'missions' },
  { href: '/mission',       label: 'Mes Missions',     icon: '🚗', moduleId: 'driver_missions' },
  { href: '/services/tgr',  label: 'TGR Touring',      icon: '🛡️', moduleId: 'tgr' },
  { href: '/admin/tgr',     label: 'TGR Gestion',      icon: '📋', moduleId: 'admin' },
  { href: '/facturation',       label: 'Facturation',         icon: '🧾', moduleId: 'facturation' },
  { href: '/missions-terminees', label: 'Missions terminées', icon: '📂', moduleId: 'facturation_or_missions' },
  { href: '/finance',           label: 'Finance',             icon: '💵', moduleId: 'finance' },
  { href: '/stats',             label: 'Statistiques',        icon: '📊', moduleId: 'stats' },
  { href: '/fourriere',     label: 'Fourrière',        icon: '🚓', moduleId: 'fourriere' },
  { href: '/check-vehicule',label: 'Check Véhicule',   icon: '🔧', moduleId: 'check_vehicle' },
  { href: '/garde',         label: 'Garde',            icon: '🛡️', moduleId: null, role: 'dispatcher_or_admin' },
  { href: '/admin',         label: 'Administration',   icon: '⚙️', moduleId: 'admin' },
  // 'Mon Profil' retire de la sidebar : doublon avec le UserBlock cliquable
  // en bas qui pointe deja vers /profil.
]

/**
 * Filtre les NAV_ITEMS selon les modules accordés à l'utilisateur et son rôle.
 * Retourne les items visibles dans l'ordre d'affichage.
 *
 * Si `userNavOrder` est fourni (array de hrefs personnalises par l'user via
 * drag & drop dans /profil), les items autorises sont rendus dans cet ordre.
 * Les nouveaux items (ajoutes apres la personnalisation) viennent a la fin
 * dans leur ordre par defaut.
 */
export function filterNavItems(opts: {
  userModules:  string[]
  userRole:     string
  userNavOrder?: string[] | null
}): NavItem[] {
  const { userModules, userRole, userNavOrder } = opts
  const isAdmin      = ['admin', 'superadmin'].includes(userRole)
  const isDispatcher = ['dispatcher', 'admin', 'superadmin'].includes(userRole)

  const visible = NAV_ITEMS.filter(item => {
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
    if (item.moduleId === 'facturation_or_missions') {
      return userModules.includes('facturation') || userModules.includes('missions')
    }
    return userModules.includes(item.moduleId)
  })

  // Si l'user a un ordre personnalise → applique-le, avec les items
  // non-presents dans l'ordre custom a la fin (cas d'un nouveau menu
  // ajoute apres la personnalisation).
  if (Array.isArray(userNavOrder) && userNavOrder.length > 0) {
    const visibleByHref = new Map(visible.map(item => [item.href, item]))
    const ordered: NavItem[] = []
    const seen = new Set<string>()
    for (const href of userNavOrder) {
      const item = visibleByHref.get(href)
      if (item) { ordered.push(item); seen.add(href) }
    }
    // Items visibles non-presents dans l'ordre custom -> a la fin
    for (const item of visible) {
      if (!seen.has(item.href)) ordered.push(item)
    }
    return ordered
  }

  return visible
}
