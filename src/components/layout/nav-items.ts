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
  label:    string             // Libelle par defaut (francais), affiche si i18nKey absent
  i18nKey?: string             // Cle dans le dictionnaire i18n (cf src/lib/i18n/dictionaries) pour affichage bilingue en mode sq
  icon:     string
  moduleId: string | null
  role?:    'dispatcher_or_admin' | 'superadmin'
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',     label: 'Dashboard',        i18nKey: 'nav.dashboard',     icon: '🏠', moduleId: null },
  { href: '/recherche',     label: 'Recherche',        i18nKey: 'nav.search',        icon: '🔍', moduleId: null },
  { href: '/dispatch',      label: 'Dispatch',         icon: '📡', moduleId: 'missions' },
  // Olivier 2026-06-22 : module en construction → visible superadmin uniquement
  // pour l'instant (repasser sur moduleId 'relivraison' quand opérationnel).
  { href: '/relivraison',   label: 'Relivraison',      icon: '🔁', moduleId: null, role: 'superadmin' },
  { href: '/mission',          label: 'Mes Missions',        i18nKey: 'nav.my_missions',   icon: '🚗', moduleId: 'driver_missions' },
  { href: '/missions-dispo',   label: 'Momo Market',                                       icon: '🛒', moduleId: 'driver_missions' },
  { href: '/services/tgr',  label: 'TGR Touring',      i18nKey: 'nav.services_tgr',  icon: '🛡️', moduleId: 'tgr' },
  { href: '/admin/tgr',     label: 'TGR Gestion',      icon: '📋', moduleId: 'admin' },
  { href: '/facturation',       label: 'Facturation',         icon: '🧾', moduleId: 'facturation' },
  { href: '/missions-terminees', label: 'Missions terminées', i18nKey: 'nav.finished', icon: '📂', moduleId: 'facturation_or_missions' },
  { href: '/admin/amendes',     label: 'Amendes',             icon: '⚠️', moduleId: 'facturation_or_admin' },
  // Olivier 2026-06-02 : Dépanneuses retirée de la sidebar globale (fonction
  // secondaire, accessible via /admin → tuile + AdminNav latérale).
  { href: '/finance',           label: 'Finance',             icon: '💵', moduleId: 'finance' },
  { href: '/stats',             label: 'Statistiques',        icon: '📊', moduleId: 'stats' },
  { href: '/fourriere',     label: 'Fourrière',        icon: '🚓', moduleId: 'fourriere' },
  { href: '/check-vehicule',label: 'Check Véhicule',   i18nKey: 'nav.check',         icon: '🔧', moduleId: 'check_vehicle' },
  { href: '/garde',         label: 'Garde',            icon: '🛡️', moduleId: null, role: 'dispatcher_or_admin' },
  { href: '/admin',         label: 'Administration',   icon: '⚙️', moduleId: 'admin' },
  { href: '/aide',          label: 'Aide',             i18nKey: 'nav.help',          icon: '📖', moduleId: null },
  { href: '/assistant',     label: 'Assistant IA',     icon: '🤖', moduleId: null, role: 'superadmin' },
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
  const isSuperadmin = userRole === 'superadmin'

  const visible = NAV_ITEMS.filter(item => {
    if (item.role === 'superadmin')          return isSuperadmin
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
    if (item.moduleId === 'facturation_or_admin') {
      return isAdmin || userModules.includes('facturation')
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
