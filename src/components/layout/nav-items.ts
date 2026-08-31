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
  role?:    'dispatcher_or_admin' | 'superadmin' | 'superadmin_or_rh' | 'non_driver'
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',     label: 'Dashboard',        i18nKey: 'nav.dashboard',     icon: '🏠', moduleId: null },
  { href: '/recherche',     label: 'Recherche',        i18nKey: 'nav.search',        icon: '🔍', moduleId: null },
  { href: '/dispatch',      label: 'Dispatch',         icon: '📡', moduleId: 'missions' },
  // Olivier 2026-06-22 : module en construction → visible superadmin uniquement
  // pour l'instant (repasser sur moduleId 'relivraison' quand opérationnel).
  { href: '/relivraison',   label: 'Relivraison',      icon: '🔁', moduleId: null, role: 'superadmin' },
  { href: '/reception',     label: 'Réception',        icon: '🛎️', moduleId: null, role: 'superadmin' },
  // Olivier 2026-07-31 : module Gestion Achat en test → superadmin uniquement
  // (créer un moduleId 'achats' + rôle Acheteur quand opérationnel).
  { href: '/achats',        label: 'Gestion Achat',    icon: '📦', moduleId: null, role: 'superadmin' },
  // Olivier 2026-08-01 : module Gestion du Personnel / paie en test → superadmin.
  { href: '/personnel',     label: 'Gestion du personnel', icon: '👤', moduleId: null, role: 'superadmin_or_rh' },
  { href: '/mission',          label: 'Mes Missions',        i18nKey: 'nav.my_missions',   icon: '🚗', moduleId: 'driver_missions' },
  { href: '/missions-dispo',   label: 'Momo Market',                                       icon: '🛒', moduleId: 'driver_missions' },
  // Olivier 2026-08-03 : « La tête à Matthieu » — accessible à tout le personnel.
  { href: '/matthieu',      label: 'La tête à Matthieu', icon: '🔧', moduleId: null },
  { href: '/services/tgr',  label: 'TGR Touring',      i18nKey: 'nav.services_tgr',  icon: '🛡️', moduleId: 'tgr' },
  { href: '/admin/tgr',     label: 'TGR Gestion',      icon: '📋', moduleId: 'admin' },
  // Déploiement du flux 2 (clôture unifiée) : grille chauffeur × assistance.
  { href: '/admin/flux2',   label: 'Flux 2',           icon: '⚡', moduleId: null, role: 'superadmin' },
  { href: '/facturation',       label: 'Facturation',         icon: '🧾', moduleId: 'facturation' },
  { href: '/missions-terminees', label: 'Missions terminées', i18nKey: 'nav.finished', icon: '📂', moduleId: 'facturation_or_missions' },
  { href: '/admin/amendes',     label: 'Amendes',             icon: '⚠️', moduleId: 'facturation_or_admin' },
  { href: '/admin/ventes',      label: 'Ventes véhicules',    icon: '🚗', moduleId: 'facturation_or_admin' },
  { href: '/admin/mail-agent',  label: 'Agent Mail',          icon: '📬', moduleId: 'mail_agent' },
  // Olivier 2026-06-02 : Dépanneuses retirée de la sidebar globale (fonction
  // secondaire, accessible via /admin → tuile + AdminNav latérale).
  { href: '/finance',           label: 'Finance',             icon: '💵', moduleId: 'finance' },
  { href: '/stats',             label: 'Statistiques',        icon: '📊', moduleId: 'stats' },
  { href: '/fourriere',     label: 'Fourrière',        icon: '🚓', moduleId: 'fourriere' },
  { href: '/francofolies',  label: 'Francofolies',     icon: '🎪', moduleId: 'francofolies' },
  { href: '/check-vehicule',label: 'Check Véhicule',   i18nKey: 'nav.check',         icon: '🔧', moduleId: 'check_vehicle' },
  { href: '/garde',         label: 'Garde',            icon: '🛡️', moduleId: null, role: 'dispatcher_or_admin' },
  { href: '/garage-info',   label: 'Garage Info',      icon: 'ℹ️', moduleId: null, role: 'non_driver' },
  { href: '/admin',         label: 'Administration',   icon: '⚙️', moduleId: 'admin' },
  { href: '/ma-paie',       label: 'Mes Prestations',  icon: '📋', moduleId: null },
  { href: '/aide',          label: 'Aide',             i18nKey: 'nav.help',          icon: '📖', moduleId: null },
  { href: '/assistant',     label: 'Assistant IA',     icon: '🤖', moduleId: null, role: 'superadmin' },
  { href: '/journal',       label: 'Journal',          icon: '📓', moduleId: null, role: 'superadmin' },
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
  userRoles?:   string[] | null
}): NavItem[] {
  const { userModules, userRole, userNavOrder, userRoles } = opts
  const roleList     = [userRole, ...(Array.isArray(userRoles) ? userRoles : [])]
  const isAdmin      = ['admin', 'superadmin'].includes(userRole)
  const isDispatcher = ['dispatcher', 'admin', 'superadmin'].includes(userRole)
  const isSuperadmin = userRole === 'superadmin'
  const isRH         = roleList.includes('rh')

  const visible = NAV_ITEMS.filter(item => {
    if (item.role === 'superadmin')          return isSuperadmin
    if (item.role === 'superadmin_or_rh')    return isSuperadmin || isRH
    if (item.role === 'dispatcher_or_admin') return isDispatcher
    if (item.role === 'non_driver')          return userRole !== 'driver' && userRole !== 'garage'
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
    // Agent Mail : module attribuable à Jona/Momo, et visible d'office pour l'admin.
    if (item.moduleId === 'mail_agent') {
      return isAdmin || userModules.includes('mail_agent')
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
