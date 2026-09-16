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

import {
  Radio, Plus, Repeat, FolderCheck, Search, FileWarning, FileText,
  Mail, Trash2, ScanLine, AlertTriangle, Map as MapIcon, Landmark, Receipt, ShieldCheck, Shield,
  ClipboardList, BarChart3, LayoutGrid, CreditCard, Wallet, Users, CalendarDays,
  Megaphone, Contact, TrendingUp, Settings, Store, Building2, Bot, ClipboardCheck,
  CalendarClock, Send, Link2, type LucideIcon,
} from 'lucide-react'
import { type NavItem } from './nav-items'

export interface NavSection {
  href:     string
  label:    string
  i18nKey?: string
  /** Icône affichée devant le libellé dans la pane niveau 2. */
  icon?:    LucideIcon
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

/**
 * MENU « ESPACES » (Olivier 16/09/2026, artefact 9ixpMfEKpDLGxfx3y15Fnn) — pilote
 * Olivier + Jona via le flag `nav_espaces` ; les autres gardent NAV_TREE.
 * Un espace = un métier. Les outils techniques sortent du menu métier
 * (Réglages → Outils). Mêmes `requires` que NAV_ITEMS : aucun accès gagné ni perdu.
 * Le Dashboard reste une page d'accueil pratique (Olivier) : il garde la 1re place.
 */
export const NAV_TREE_ESPACES: NavModule[] = [
  {
    key: 'operations', label: 'Opérations', icon: '📡',
    sections: [
      { href: '/dispatch',           label: 'Dispatch',           icon: Radio,       requires: '/dispatch' },
      { href: '/dispatch/new',       label: 'Nouvelle mission',   icon: Plus,        requires: '/dispatch' },
      { href: '/relivraison',        label: 'Relivraison',        icon: Repeat,      requires: '/relivraison' },
      { href: '/reception',          label: 'Réception',          icon: Contact,     requires: '/reception' },
      { href: '/garde',              label: 'Planning de garde',  icon: ShieldCheck, requires: '/garde' },
      { href: '/francofolies',       label: 'Francofolies',       icon: CalendarDays, requires: '/francofolies' },
      // Agent mécano : outil de terrain, pas un réglage (Jona le voyait à plat).
      { href: '/matthieu',           label: 'La tête à Matthieu', icon: Bot,         requires: '/matthieu' },
    ],
  },
  {
    key: 'fourriere', label: 'Fourrière', icon: '🚓',
    // 16/09/2026 : 10 sections → 4 (Parc · Documents · Facturation · Sorties).
    // Plan, Scanner, Non localisés et la recherche avancée sont des VUES de Parc
    // (barre en haut de l'écran), plus des entrées de menu.
    sections: [
      { href: '/fourriere',                      label: 'Parc',                   icon: Search,        requires: '/fourriere' },
      { href: '/fourriere/requisitoires',        label: 'Réquisitoires',          icon: FileText,      requires: '/fourriere', heading: 'Documents' },
      { href: '/fourriere/saisies',              label: 'États de frais',         icon: FileWarning,   requires: '/fourriere', heading: 'Facturation' },
      { href: '/fourriere/sorties',              label: 'Sorties',                icon: Trash2,        requires: '/fourriere', heading: 'Sorties' },
    ],
  },
  {
    key: 'facturation', label: 'Facturation', icon: '🧾',
    sections: [
      { href: '/facturation/dossiers', label: 'À facturer',               icon: FolderCheck,  requires: '/facturation' },
      { href: '/facturation',          label: 'Liste par fiche (ancienne)', icon: Receipt,    requires: '/facturation' },
      { href: '/missions-terminees',   label: 'Missions terminées',       icon: FolderCheck,  i18nKey: 'nav.finished', requires: '/missions-terminees' },
      { href: '/admin/amendes',        label: 'Amendes',                  icon: AlertTriangle, requires: '/admin/amendes' },
      { href: '/facturation/touring',  label: 'Touring',                  icon: Shield,       requires: '/facturation', heading: 'Assisteurs' },
      { href: '/facturation/allianz',  label: 'Clôture Allianz',          icon: ShieldCheck,  requires: '/facturation' },
      { href: '/services/tgr',         label: 'TGR Touring',              icon: Shield,       i18nKey: 'nav.services_tgr', requires: '/services/tgr' },
      { href: '/admin/tgr',            label: 'TGR Gestion',              icon: ClipboardList, requires: '/admin/tgr' },
      { href: '/stats/touring',        label: 'Stats Touring',            icon: BarChart3,    requires: '/stats' },
    ],
  },
  {
    key: 'finance', label: 'Finance', icon: '💵',
    sections: [
      { href: '/finance',                label: 'Vue d\'ensemble', icon: LayoutGrid, requires: '/finance' },
      { href: '/stats',                  label: 'Statistiques',    icon: BarChart3,  requires: '/stats' },
      { href: '/encaissement',           label: 'Encaisser',       icon: CreditCard, requires: '/finance', requiresModules: ['encaissement'], heading: 'Caisse' },
      { href: '/encaissements',          label: 'Mouvements',      icon: BarChart3,  requires: '/finance', requiresModules: ['encaissements'] },
      { href: '/caisse',                 label: 'Ma caisse',       icon: Wallet,     requires: '/finance', requiresModules: ['caisse'] },
      { href: '/avance-fonds',           label: 'Avances de fonds', icon: FileText,  requires: '/finance', requiresModules: ['avance_fonds'], heading: 'Clients' },
      { href: '/relances',               label: 'Relances clients', icon: Send,      requires: '/finance', requiresModules: ['relances'] },
      { href: '/finance/reconciliation', label: 'Réconciliation',  icon: Link2,      requires: '/finance', superadminOnly: true },
    ],
  },
  {
    key: 'equipe', label: 'Équipe', icon: '👥',
    sections: [
      { href: '/personnel',                   label: 'Personnel',          icon: Users,          requires: '/personnel' },
      { href: '/personnel/conges',            label: 'Congés',             icon: CalendarDays,   requires: '/personnel' },
      { href: '/personnel/annonces',          label: 'Annonces',           icon: Megaphone,      requires: '/personnel' },
      { href: '/personnel/repertoire',        label: 'Répertoire',         icon: Contact,        requires: '/personnel' },
      { href: '/personnel/rentabilite',       label: 'Rentabilité',        icon: TrendingUp,     requires: '/personnel' },
      { href: '/personnel/garde',             label: 'Configuration garde', icon: Settings,      requires: '/personnel' },
      { href: '/ma-paie',                     label: 'Mes prestations',    icon: ClipboardList,  requires: '/ma-paie' },
      { href: '/check-vehicule',              label: 'Check véhicule',     icon: ClipboardCheck, i18nKey: 'nav.check', requires: '/check-vehicule', heading: 'Véhicules' },
      { href: '/check-vehicule/convocations', label: 'Convocations CT',    icon: CalendarClock,  requires: '/check-vehicule' },
    ],
  },
  {
    key: 'achats', label: 'Achats', icon: '📦',
    sections: [
      { href: '/achats',              label: 'Vue d\'ensemble', icon: LayoutGrid, requires: '/achats' },
      { href: '/achats/marche',       label: 'Marché',          icon: Store,      requires: '/achats' },
      { href: '/achats/fournisseurs', label: 'Fournisseurs',    icon: Building2,  requires: '/achats' },
      { href: '/achats/devis',        label: 'Devis',           icon: FileText,   requires: '/achats' },
      { href: '/achats/assistant',    label: 'Assistant achat', icon: Bot,        requires: '/achats' },
    ],
  },
  {
    key: 'reglages', label: 'Réglages', icon: '⚙️',
    sections: [
      { href: '/admin',        label: 'Administration',      icon: Settings,  requires: '/admin' },
      { href: '/journal',      label: 'Journal',             icon: FileText,  requires: '/journal',     superadminOnly: true, heading: 'Outils' },
      { href: '/chantiers',    label: 'Chantiers',           icon: ClipboardList, requires: '/chantiers', superadminOnly: true },
      { href: '/admin/flux2',  label: 'Flux 2',              icon: Settings,  requires: '/admin/flux2', superadminOnly: true },
      { href: '/mail-agent',   label: 'Agent Mail',          icon: Mail,      requires: '/mail-agent',  superadminOnly: true },
      { href: '/assistant',    label: 'Assistant IA',        icon: Bot,       requires: '/assistant',   superadminOnly: true },
      { href: '/admin/axa',    label: 'AXA go&assist',       icon: Shield,    requires: '/dispatch',    superadminOnly: true },
    ],
  },
]
/** Raccourcis épinglés du menu « Espaces » : accueil, recherche, Dispatch (Olivier 16/09/2026), les deux écrans chauffeur. */
export const PINNED_ESPACES: string[] = ['/dashboard', '/recherche', '/dispatch', '/mission', '/missions-dispo']

/** Modules à sections. Les modules plats sont dérivés automatiquement de NAV_ITEMS. */
export const NAV_TREE: NavModule[] = [
  {
    key: 'dispatch', label: 'Dispatch', icon: '📡',
    sections: [
      { href: '/dispatch',           label: 'Dispatch',           icon: Radio,       requires: '/dispatch' },
      { href: '/dispatch/new',       label: 'Nouvelle mission',   icon: Plus,        requires: '/dispatch' },
      { href: '/relivraison',        label: 'Relivraison',        icon: Repeat,      requires: '/relivraison' },
      { href: '/missions-terminees', label: 'Missions terminées', icon: FolderCheck, i18nKey: 'nav.finished', requires: '/missions-terminees' },
      { href: '/journal',            label: 'Journal',            icon: FileText,    requires: '/dispatch', superadminOnly: true },
      { href: '/admin/axa',           label: 'AXA go&assist',      icon: Shield,      requires: '/dispatch', superadminOnly: true },
    ],
  },
  // Pas de groupe « Mes Missions » : ce sont les deux écrans les plus utilisés du
  // chauffeur (Olivier 2026-08-11) — ils restent au niveau 1, accessibles en un clic.
  {
    key: 'fourriere', label: 'Fourrière', icon: '🚓',
    sections: [
      { href: '/fourriere',                     label: 'Recherche & parcs',     icon: Search,        requires: '/fourriere' },
      { href: '/fourriere/saisies',             label: 'États de frais',        icon: FileWarning,   requires: '/fourriere' },
      { href: '/fourriere/requisitoires',       label: 'Réquisitoires',         icon: FileText,      requires: '/fourriere' },
      { href: '/fourriere/relance-requisitoire', label: 'Relance réquisitoires', icon: Mail,         requires: '/fourriere' },
      { href: '/fourriere/destruction',         label: 'Sortie AVP',            icon: Trash2,        requires: '/fourriere' },
      { href: '/fourriere/destruction/dossiers', label: 'Dossiers de destruction', icon: FolderCheck, requires: '/fourriere' },
      { href: '/fourriere/inventaire',          label: 'Inventaire',            icon: ScanLine,      requires: '/fourriere' },
      { href: '/fourriere/non-localises',       label: 'Non-localisés',         icon: AlertTriangle, requires: '/fourriere' },
      { href: '/fourriere/plan',                label: 'Plan du parc',          icon: MapIcon,           requires: '/fourriere' },
      { href: '/fourriere/domaine',             label: 'Domaine',               icon: Landmark,      requires: '/fourriere', superadminOnly: true },
    ],
  },
  {
    key: 'facturation', label: 'Facturation', icon: '🧾',
    sections: [
      { href: '/facturation',          label: 'Facturation',            icon: Receipt,       requires: '/facturation' },
      { href: '/facturation/dossiers', label: 'Facturation par dossier', icon: FolderCheck,   requires: '/facturation', superadminOnly: true },
      { href: '/facturation/allianz', label: 'Clôture Allianz', icon: ShieldCheck,   requires: '/facturation' },
      { href: '/facturation/touring', label: 'Touring',         icon: Shield,        requires: '/facturation' },
      { href: '/admin/amendes',       label: 'Amendes',         icon: AlertTriangle, requires: '/admin/amendes' },
    ],
  },
  {
    // /finance est un hub : ses 5 tuiles sont de vraies pages, chacune gardée par
    // son propre module (cf src/app/finance/FinanceClient.tsx). On remonte ces
    // tuiles en sections, avec exactement le même gating.
    key: 'finance', label: 'Finance', icon: '💵',
    sections: [
      { href: '/finance',       label: 'Vue d\'ensemble', icon: LayoutGrid, requires: '/finance' },
      { href: '/encaissement',  label: 'Encaissement',    icon: CreditCard, requires: '/finance', requiresModules: ['encaissement'] },
      { href: '/encaissements', label: 'Mouvements',      icon: BarChart3,  requires: '/finance', requiresModules: ['encaissements'] },
      { href: '/caisse',        label: 'Ma Caisse',       icon: Wallet,     requires: '/finance', requiresModules: ['caisse'] },
      { href: '/avance-fonds',  label: 'Avance de fonds', icon: FileText,   requires: '/finance', requiresModules: ['avance_fonds'] },
      { href: '/relances',      label: 'Relance Client',  icon: Send,       requires: '/finance', requiresModules: ['relances'] },
      // Olivier 2026-08-14 : en rodage → superadmin, comme la tuile et l'API.
      { href: '/finance/reconciliation', label: 'Réconciliation', icon: Link2, requires: '/finance', superadminOnly: true },
    ],
  },
  {
    key: 'touring', label: 'Touring', icon: '🛡️',
    sections: [
      { href: '/services/tgr',  label: 'TGR Touring',   icon: Shield,        i18nKey: 'nav.services_tgr', requires: '/services/tgr' },
      { href: '/admin/tgr',     label: 'TGR Gestion',   icon: ClipboardList, requires: '/admin/tgr' },
      { href: '/stats/touring', label: 'Stats Touring', icon: BarChart3,     requires: '/stats' },
    ],
  },
  {
    key: 'personnel', label: 'Gestion du personnel', icon: '👤',
    sections: [
      { href: '/personnel',             label: 'Personnel',           icon: Users,        requires: '/personnel' },
      { href: '/personnel/conges',      label: 'Congés',              icon: CalendarDays, requires: '/personnel' },
      { href: '/personnel/annonces',    label: 'Annonces',            icon: Megaphone,    requires: '/personnel' },
      { href: '/personnel/repertoire',  label: 'Répertoire',          icon: Contact,      requires: '/personnel' },
      { href: '/personnel/rentabilite', label: 'Rentabilité',         icon: TrendingUp,   requires: '/personnel' },
      { href: '/garde',                 label: 'Planning de garde',   icon: ShieldCheck,  requires: '/garde' },
      { href: '/personnel/garde',       label: 'Configuration garde', icon: Settings,     requires: '/personnel' },
    ],
  },
  {
    // Module jeune, appelé à grossir : il garde son propre niveau 1.
    key: 'achats', label: 'Gestion Achat', icon: '📦',
    sections: [
      { href: '/achats',              label: 'Vue d\'ensemble', icon: LayoutGrid, requires: '/achats' },
      { href: '/achats/marche',       label: 'Marché',          icon: Store,      requires: '/achats' },
      { href: '/achats/fournisseurs', label: 'Fournisseurs',    icon: Building2,  requires: '/achats' },
      { href: '/achats/devis',        label: 'Devis',           icon: FileText,   requires: '/achats' },
      { href: '/achats/assistant',    label: 'Assistant achat', icon: Bot,        requires: '/achats' },
    ],
  },
  {
    key: 'check-vehicule', label: 'Check Véhicule', i18nKey: 'nav.check', icon: '🔧',
    sections: [
      { href: '/check-vehicule',              label: 'Check Véhicule',  icon: ClipboardCheck, i18nKey: 'nav.check', requires: '/check-vehicule' },
      { href: '/check-vehicule/convocations', label: 'Convocations CT', icon: CalendarClock,  requires: '/check-vehicule' },
    ],
  },
]

/**
 * Raccourcis épinglés en tête du menu, hors de la zone qui défile.
 *
 * VIDE depuis le passage à l'accordéon (Olivier 2026-08-12) : la liste complète
 * des modules restant visible en permanence, une zone fixe faisait doublon — et
 * chacun ordonne déjà son menu par drag & drop dans /profil (`userNavOrder`).
 * Le mécanisme reste en place : remettre un href ici (ex. '/recherche', ou la
 * page d'atterrissage d'un module comme '/dispatch') réaffiche la zone, avec
 * les permissions du user respectées.
 */
export const PINNED_HREFS: string[] = []

/** Hrefs de NAV_ITEMS déjà couverts par un module de l'arbre (ne pas re-lister à plat). */
const COVERED = new Set(
  NAV_TREE.flatMap(m => (m.sections || []).map(s => s.requires)),
)
const COVERED_ESPACES = new Set(
  NAV_TREE_ESPACES.flatMap(m => (m.sections || []).map(s => s.requires)),
)

export interface BuiltModule extends NavModule {
  /** Sections réellement visibles pour ce user (vide si module plat). */
  visibleSections: NavSection[]
}

/**
 * Construit le menu à 2 niveaux à partir des items DÉJÀ filtrés par filterNavItems().
 * `visible` doit être le résultat de filterNavItems() (ordre personnalisé inclus).
 */
export function buildNavTree(visible: NavItem[], userRole: string, userModules: string[] = [], espaces = false): BuiltModule[] {
  const TREE    = espaces ? NAV_TREE_ESPACES : NAV_TREE
  const covered = espaces ? COVERED_ESPACES : COVERED
  const isSuperadmin = userRole === 'superadmin'
  // Même convention que les hubs (Finance…) : le module 'admin' ouvre toutes les tuiles.
  const isAdmin      = isSuperadmin || userModules.includes('admin') || userRole === 'admin'
  const visibleHrefs = new Set(visible.map(i => i.href))
  const byHref = new Map(visible.map(i => [i.href, i]))
  const rank = new Map(visible.map((i, idx) => [i.href, idx]))

  const modules: { mod: BuiltModule; order: number }[] = []

  // 1) Modules à sections
  for (const mod of TREE) {
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
    if (covered.has(item.href)) continue
    modules.push({
      mod: {
        key: item.href, label: item.label, i18nKey: item.i18nKey, icon: item.icon,
        href: item.href, visibleSections: [],
      },
      order: rank.get(item.href) ?? Number.MAX_SAFE_INTEGER,
    })
  }

  // Menu « Espaces » : l'ordre des espaces est FIXE (métier), pas celui du user ;
  // les items plats restants (accueil, aide…) passent après.
  if (espaces) {
    const fixed = new Map(NAV_TREE_ESPACES.map((m, i) => [m.key, i]))
    return modules
      .sort((a, b) => (fixed.has(a.mod.key) && fixed.has(b.mod.key)) ? fixed.get(a.mod.key)! - fixed.get(b.mod.key)!
        : fixed.has(a.mod.key) ? -1 : fixed.has(b.mod.key) ? 1 : a.order - b.order)
      .map(m => m.mod)
  }
  return modules.sort((a, b) => a.order - b.order).map(m => m.mod)
}

/** Page d'atterrissage d'un module (lien direct, ou 1re section pour un groupe). */
export function landingHref(mod: BuiltModule): string | undefined {
  return mod.href ?? mod.visibleSections[0]?.href
}

/**
 * Sépare les raccourcis épinglés (zone fixe en haut) du reste du menu (les panes
 * qui glissent). Les raccourcis sortent dans l'ordre de PINNED_HREFS.
 */
export function splitPinned(modules: BuiltModule[], espaces = false): { pinned: BuiltModule[]; rest: BuiltModule[] } {
  // Menu « Espaces » : un raccourci épinglé peut viser une SECTION (ex. /dispatch
  // dans Opérations) — on fabrique alors un lien direct sans retirer l'espace de
  // la liste. Un module plat épinglé (Dashboard, Recherche…) monte tel quel.
  if (espaces) {
    const pinned: BuiltModule[] = []
    const used = new Set<string>()
    for (const h of PINNED_ESPACES) {
      const flat = modules.find(m => m.href === h)
      if (flat) { pinned.push(flat); used.add(flat.key); continue }
      for (const m of modules) {
        const sec = m.visibleSections.find(x => x.href === h)
        if (sec) { pinned.push({ key: `pin:${h}`, label: sec.label, i18nKey: sec.i18nKey, icon: m.icon, href: h, visibleSections: [] }); break }
      }
    }
    return { pinned, rest: modules.filter(m => !used.has(m.key)) }
  }
  const PIN = PINNED_HREFS
  const isPinned = (mod: BuiltModule) => {
    const href = landingHref(mod)
    return !!href && PIN.includes(href)
  }
  const pinned = PIN
    .map(href => modules.find(m => landingHref(m) === href))
    .filter((m): m is BuiltModule => !!m)
  return { pinned, rest: modules.filter(m => !isPinned(m)) }
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
