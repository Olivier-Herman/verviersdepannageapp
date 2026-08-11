// src/components/layout/nav-tree.ts
//
// Hiérarchie « modules → sections » du menu navigable (AppNavV2, flag nav_menu_v2).
// NAV_ITEMS (src/components/layout/nav-items.ts) reste la source de vérité des
// PERMISSIONS : cet arbre ne fait que REGROUPER des entrées déjà filtrées par
// filterNavItems(). Règles :
//
//   - chaque section est gardée par `requires` = le href d'un NAV_ITEM ; la section
//     n'apparaît que si ce NAV_ITEM est visible pour le user (donc aucun accès
//     gagné ni perdu par rapport au menu plat actuel) ;
//   - un module de groupe s'affiche dès qu'AU MOINS UNE de ses sections est visible ;
//   - un NAV_ITEM visible qui n'est référencé nulle part dans l'arbre est ajouté
//     automatiquement en module plat (filet de sécurité : un item ajouté à
//     NAV_ITEMS sans toucher ce fichier ne disparaît jamais du menu) ;
//   - l'ordre du niveau 1 suit l'ordre des items filtrés, donc l'ordre personnalisé
//     par le user (drag & drop /profil, `userNavOrder`) est respecté.

import { type NavItem } from './nav-items'

export interface NavSection {
  href:     string
  label:    string
  i18nKey?: string
  /** href du NAV_ITEM qui autorise cette section (elle-même ou son module parent). */
  requires: string
  /** Modules dont AU MOINS UN est requis, en plus de `requires` (admin/superadmin passent
   *  toujours — même règle que les tuiles de la page concernée). */
  requiresModules?: string[]
  /** Réservé au superadmin, en plus de `requires`. */
  superadminOnly?: boolean
  /** Intertitre affiché au-dessus de cette section (regroupement visuel). */
  heading?: string
}

export interface NavModule {
  key:      string
  label:    string
  i18nKey?: string
  icon:     string
  /** Module plat : lien direct, pas de niveau 2. */
  href?:     string
  sections?: NavSection[]
}

/** Modules à sections. Les modules plats sont dérivés automatiquement de NAV_ITEMS. */
export const NAV_TREE: NavModule[] = [
  {
    key: 'dispatch', label: 'Dispatch', icon: '📡',
    sections: [
      { href: '/dispatch',           label: 'Dispatch',           requires: '/dispatch' },
      { href: '/dispatch/new',       label: 'Nouvelle mission',   requires: '/dispatch' },
      { href: '/relivraison',        label: 'Relivraison',        requires: '/relivraison' },
      { href: '/missions-terminees', label: 'Missions terminées', i18nKey: 'nav.finished', requires: '/missions-terminees' },
    ],
  },
  {
    key: 'mission', label: 'Mes Missions', i18nKey: 'nav.my_missions', icon: '🚗',
    sections: [
      { href: '/mission',        label: 'Mes Missions', i18nKey: 'nav.my_missions', requires: '/mission' },
      { href: '/missions-dispo', label: 'Momo Market',  requires: '/missions-dispo' },
    ],
  },
  {
    key: 'fourriere', label: 'Fourrière', icon: '🚓',
    sections: [
      { href: '/fourriere',                     label: 'Recherche & parcs',      requires: '/fourriere' },
      { href: '/fourriere/saisies',             label: 'Saisies',                requires: '/fourriere' },
      { href: '/fourriere/requisitoires',       label: 'Réquisitoires',          requires: '/fourriere' },
      { href: '/fourriere/relance-requisitoire', label: 'Relance réquisitoires', requires: '/fourriere' },
      { href: '/fourriere/destruction',         label: 'Sortie AVP',             requires: '/fourriere' },
      { href: '/fourriere/inventaire',          label: 'Inventaire',             requires: '/fourriere' },
      { href: '/fourriere/non-localises',       label: 'Non-localisés',          requires: '/fourriere' },
      { href: '/fourriere/plan',                label: 'Plan du parc',           requires: '/fourriere' },
      { href: '/fourriere/domaine',             label: 'Domaine',                requires: '/fourriere', superadminOnly: true },
    ],
  },
  {
    key: 'facturation', label: 'Facturation', icon: '🧾',
    sections: [
      { href: '/facturation',         label: 'Facturation',    requires: '/facturation' },
      { href: '/facturation/allianz', label: 'Clôture Allianz', requires: '/facturation' },
      { href: '/facturation/touring', label: 'Touring',         requires: '/facturation' },
      { href: '/admin/amendes',       label: 'Amendes',         requires: '/admin/amendes' },
    ],
  },
  {
    // /finance est un hub : ses 5 tuiles sont de vraies pages, chacune gardée par
    // son propre module (cf src/app/finance/FinanceClient.tsx). On remonte ces
    // tuiles en sections, avec exactement le même gating.
    key: 'finance', label: 'Finance', icon: '💵',
    sections: [
      { href: '/finance',       label: 'Vue d\'ensemble',  requires: '/finance' },
      { href: '/encaissement',  label: 'Encaissement',     requires: '/finance', requiresModules: ['encaissement'] },
      { href: '/encaissements', label: 'Mouvements',       requires: '/finance', requiresModules: ['encaissements'] },
      { href: '/caisse',        label: 'Ma Caisse',        requires: '/finance', requiresModules: ['caisse'] },
      { href: '/avance-fonds',  label: 'Avance de fonds',  requires: '/finance', requiresModules: ['avance_fonds'] },
      { href: '/relances',      label: 'Relance Client',   requires: '/finance', requiresModules: ['relances'] },
    ],
  },
  {
    key: 'touring', label: 'Touring', icon: '🛡️',
    sections: [
      { href: '/services/tgr',  label: 'TGR Touring',   i18nKey: 'nav.services_tgr', requires: '/services/tgr' },
      { href: '/admin/tgr',     label: 'TGR Gestion',   requires: '/admin/tgr' },
      { href: '/stats/touring', label: 'Stats Touring', requires: '/stats' },
    ],
  },
  {
    key: 'personnel', label: 'Gestion du personnel', icon: '👤',
    sections: [
      { href: '/personnel',             label: 'Personnel',           requires: '/personnel' },
      { href: '/personnel/conges',      label: 'Congés',              requires: '/personnel' },
      { href: '/personnel/annonces',    label: 'Annonces',            requires: '/personnel' },
      { href: '/personnel/repertoire',  label: 'Répertoire',          requires: '/personnel' },
      { href: '/personnel/rentabilite', label: 'Rentabilité',         requires: '/personnel' },
      { href: '/garde',                 label: 'Planning de garde',   requires: '/garde' },
      { href: '/personnel/garde',       label: 'Configuration garde', requires: '/personnel' },
    ],
  },
  {
    // Module jeune, appelé à grossir : il garde son propre niveau 1.
    key: 'achats', label: 'Gestion Achat', icon: '📦',
    sections: [
      { href: '/achats',             label: 'Vue d\'ensemble', requires: '/achats' },
      { href: '/achats/marche',      label: 'Marché',          requires: '/achats' },
      { href: '/achats/fournisseurs', label: 'Fournisseurs',   requires: '/achats' },
      { href: '/achats/devis',       label: 'Devis',           requires: '/achats' },
      { href: '/achats/assistant',   label: 'Assistant achat', requires: '/achats' },
    ],
  },
  {
    key: 'check-vehicule', label: 'Check Véhicule', i18nKey: 'nav.check', icon: '🔧',
    sections: [
      { href: '/check-vehicule',             label: 'Check Véhicule', i18nKey: 'nav.check', requires: '/check-vehicule' },
      { href: '/check-vehicule/convocations', label: 'Convocations CT', requires: '/check-vehicule' },
    ],
  },
]

/** Hrefs de NAV_ITEMS déjà couverts par un module de l'arbre (ne pas re-lister à plat). */
const COVERED = new Set(
  NAV_TREE.flatMap(m => (m.sections || []).map(s => s.requires)),
)

export interface BuiltModule extends NavModule {
  /** Sections réellement visibles pour ce user (vide si module plat). */
  visibleSections: NavSection[]
}

/**
 * Construit le menu à 2 niveaux à partir des items DÉJÀ filtrés par filterNavItems().
 * `visible` doit être le résultat de filterNavItems() (ordre personnalisé inclus).
 */
export function buildNavTree(visible: NavItem[], userRole: string, userModules: string[] = []): BuiltModule[] {
  const isSuperadmin = userRole === 'superadmin'
  // Même convention que les hubs (Finance…) : le module 'admin' ouvre toutes les tuiles.
  const isAdmin      = isSuperadmin || userModules.includes('admin') || userRole === 'admin'
  const visibleHrefs = new Set(visible.map(i => i.href))
  const byHref = new Map(visible.map(i => [i.href, i]))
  const rank = new Map(visible.map((i, idx) => [i.href, idx]))

  const modules: { mod: BuiltModule; order: number }[] = []

  // 1) Modules à sections
  for (const mod of NAV_TREE) {
    const sections = (mod.sections || []).filter(s =>
      visibleHrefs.has(s.requires)
      && (!s.superadminOnly || isSuperadmin)
      && (!s.requiresModules || isAdmin || s.requiresModules.some(m => userModules.includes(m))),
    )
    if (sections.length === 0) continue
    const order = Math.min(...sections.map(s => rank.get(s.requires) ?? Number.MAX_SAFE_INTEGER))

    // Une seule section visible → pas de niveau 2 pour rien : le module s'aplatit
    // sur cette section (ex. un dispatcher ne voit du « Personnel » que la garde →
    // il obtient directement « Planning de garde »). On reprend le libellé et
    // l'icône du NAV_ITEM correspondant quand il existe.
    if (sections.length === 1) {
      const only = sections[0]
      const item = byHref.get(only.href)
      modules.push({
        mod: {
          key:     mod.key,
          label:   item?.label   ?? only.label,
          i18nKey: item?.i18nKey ?? only.i18nKey,
          icon:    item?.icon    ?? mod.icon,
          href:    only.href,
          visibleSections: [],
        },
        order,
      })
      continue
    }

    modules.push({ mod: { ...mod, visibleSections: sections }, order })
  }

  // 2) Items visibles non couverts → modules plats (filet de sécurité)
  for (const item of visible) {
    if (COVERED.has(item.href)) continue
    modules.push({
      mod: {
        key: item.href, label: item.label, i18nKey: item.i18nKey, icon: item.icon,
        href: item.href, visibleSections: [],
      },
      order: rank.get(item.href) ?? Number.MAX_SAFE_INTEGER,
    })
  }

  return modules.sort((a, b) => a.order - b.order).map(m => m.mod)
}

/** Le module correspondant à l'URL courante (pour ouvrir la bonne pane / surligner). */
export function findActiveModule(modules: BuiltModule[], pathname: string): BuiltModule | null {
  const matches = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'))

  let best: { mod: BuiltModule; len: number } | null = null
  for (const mod of modules) {
    const hrefs = mod.href ? [mod.href] : mod.visibleSections.map(s => s.href)
    for (const href of hrefs) {
      if (matches(href) && (!best || href.length > best.len)) best = { mod, len: href.length }
    }
  }
  return best?.mod || null
}

/** Section active dans la pane niveau 2 (le href le plus spécifique qui matche). */
export function findActiveSectionHref(mod: BuiltModule, pathname: string): string | null {
  let best: string | null = null
  for (const s of mod.visibleSections) {
    if ((pathname === s.href || pathname.startsWith(s.href + '/')) && (!best || s.href.length > best.length)) {
      best = s.href
    }
  }
  return best
}
