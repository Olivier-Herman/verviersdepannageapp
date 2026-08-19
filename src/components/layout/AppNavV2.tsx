'use client'

// Menu navigable (flag `nav_menu_v2`).
//
//   Zone fixe en haut = raccourcis épinglés (cf PINNED_HREFS), toujours visibles.
//   Dessous = la liste COMPLÈTE des modules. Un module à sections se déplie en
//   accordéon juste en dessous de lui : la liste des modules reste visible, donc
//   passer d'un module à l'autre coûte toujours un seul clic.
//   (Olivier 2026-08-12 : le menu à 2 panes qui glissaient obligeait à revenir en
//   arrière pour changer de module — abandonné au profit de l'accordéon.)
//
// Ne remplace QUE la liste du menu : le reste du shell (logo, footer, header, et
// surtout toute la zone opérationnelle à droite) est strictement inchangé.
// Les permissions viennent de filterNavItems() → aucun accès gagné ni perdu.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Search, X } from 'lucide-react'
import { T } from '@/lib/i18n/T'
import { type NavItem } from './nav-items'
import {
  buildNavTree, splitPinned, landingHref, findActiveModule, findActiveSectionHref,
  type BuiltModule,
} from './nav-tree'

// Easing iOS de la maquette validée.
const EASE = '[transition-timing-function:cubic-bezier(.32,.72,0,1)]'

interface Props {
  items:       NavItem[]                    // déjà filtrés (filterNavItems)
  userRole:    string
  userModules: string[]
  badges?:     Record<string, number>
  /** Rendu mobile (drawer) : padding un peu plus généreux. */
  variant?:    'sidebar' | 'drawer'
  /** Appelé à chaque navigation (ferme le drawer mobile). */
  onNavigate?: () => void
}

export default function AppNavV2({
  items, userRole, userModules, badges = {}, variant = 'sidebar', onNavigate,
}: Props) {
  const pathname = usePathname()
  const modules  = useMemo(() => buildNavTree(items, userRole, userModules), [items, userRole, userModules])
  const { pinned, rest } = useMemo(() => splitPinned(modules), [modules])
  const active   = useMemo(() => findActiveModule(modules, pathname), [modules, pathname])

  // Module de l'URL courante, s'il a des sections (clé stable : évite de replier
  // l'accordéon à chaque re-render de l'AppShell).
  const activeKey = active && active.visibleSections.length > 0 ? active.key : null

  // Un seul module déplié à la fois — celui de la page courante par défaut.
  const [openKey, setOpenKey] = useState<string | null>(activeKey)
  useEffect(() => { if (activeKey) setOpenKey(activeKey) }, [activeKey])

  // ── Recherche : filtre le menu en direct (module OU une de ses sections). ──
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const searching = q.length > 0

  // Un module correspond si son libellé matche → on garde toutes ses sections ;
  // sinon on ne garde que les sections dont le libellé matche. Rien → écarté.
  const filterMod = (mod: BuiltModule): BuiltModule | null => {
    if (!searching) return mod
    if (mod.label.toLowerCase().includes(q)) return mod
    const secs = mod.visibleSections.filter(s => s.label.toLowerCase().includes(q))
    return secs.length ? { ...mod, visibleSections: secs } : null
  }
  const filterList = (list: BuiltModule[]) =>
    searching ? list.flatMap(m => { const r = filterMod(m); return r ? [r] : [] }) : list

  const pad    = variant === 'drawer' ? 'px-3 py-3' : 'px-3 py-4'
  const rowPad = variant === 'drawer' ? 'px-3 py-3' : 'px-3 py-2.5'

  const moduleBadge = (mod: BuiltModule) =>
    mod.href
      ? (badges[mod.href] || 0)
      : mod.visibleSections.reduce((sum, s) => sum + (badges[s.href] || 0), 0)

  /** Un module + ses sections dépliées. Même rendu épinglé ou dans la liste. */
  const ModuleBlock = ({ mod }: { mod: BuiltModule }) => {
    const badge = moduleBadge(mod)
    const href  = landingHref(mod)
    const label = mod.i18nKey ? <T k={mod.i18nKey} /> : mod.label
    // La ligne du module ouvre déjà sa page par défaut : on ne répète pas cette
    // page dans le sous-menu (sinon « Dispatch » apparaissait deux fois).
    const kids     = mod.visibleSections.filter(s => s.href !== href)
    const hasKids  = kids.length > 0
    // En recherche : les modules affichés sont dépliés d'office (on voit les sous-menus).
    const expanded = hasKids && (searching || openKey === mod.key)
    if (!href) return null

    // Page courante = la page par défaut du module → la ligne est active.
    // Page courante = une sous-section → c'est elle qui est surlignée, la ligne
    // du module reste seulement mise en évidence (pas de double surlignage).
    const activeSection = findActiveSectionHref(mod, pathname)
    const inModule      = active?.key === mod.key
    const rowActive     = inModule && (!activeSection || activeSection === href)

    return (
      <div>
        <Link
          href={href}
          onClick={() => { setOpenKey(hasKids ? mod.key : null); onNavigate?.() }}
          className={`group relative flex items-center gap-3 rounded-md text-sm font-medium transition-colors ${rowPad} ${
            rowActive ? 'bg-brand-soft text-brand'
              : inModule ? 'text-ink hover:bg-surface-hover'
              : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
          }`}
        >
          <span className="text-base">{mod.icon}</span>
          <span className="flex-1 min-w-0 truncate">{label}</span>
          {badge > 0 && <Badge n={badge} />}
          {hasKids && (
            // Le chevron seul déplie/replie sans naviguer.
            <button
              type="button"
              onClick={e => { e.preventDefault(); e.stopPropagation(); setOpenKey(expanded ? null : mod.key) }}
              aria-label={expanded ? `Replier ${mod.label}` : `Déplier ${mod.label}`}
              aria-expanded={expanded}
              className="flex-shrink-0 -mr-1 p-0.5 rounded hover:bg-ink/10 transition-colors"
            >
              <ChevronRight
                size={15}
                className={`opacity-50 group-hover:opacity-100 transition-transform duration-200 ${EASE} ${
                  expanded ? 'rotate-90' : ''
                }`}
              />
            </button>
          )}
        </Link>

        {/* Sections — hauteur animée (grid 0fr → 1fr), rien à calculer en JS. */}
        {hasKids && (
          <div
            className={`grid transition-[grid-template-rows] duration-300 ${EASE} ${
              expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            }`}
          >
            <div className="overflow-hidden">
              <div className="flex flex-col gap-0.5 pt-0.5 pb-1 pl-4 ml-1.5 border-l">
                {kids.map(section => {
                  const isActive = activeSection === section.href
                  const sBadge   = badges[section.href] || 0
                  const Icon     = section.icon
                  return (
                    <Link
                      key={section.href}
                      href={section.href}
                      onClick={onNavigate}
                      tabIndex={expanded ? undefined : -1}
                      className={`flex items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors ${
                        variant === 'drawer' ? 'px-3 py-2.5' : 'px-3 py-2'
                      } ${
                        isActive ? 'bg-brand-soft text-brand' : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
                      }`}
                    >
                      {Icon && <Icon size={15} className="flex-shrink-0 opacity-70" />}
                      <span className="flex-1 min-w-0 truncate">
                        {section.i18nKey ? <T k={section.i18nKey} /> : section.label}
                      </span>
                      {sBadge > 0 && <Badge n={sBadge} />}
                    </Link>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const shownPinned = filterList(pinned)
  const shownRest   = filterList(rest)
  const noResult    = searching && shownPinned.length === 0 && shownRest.length === 0

  return (
    <nav className={`flex-1 flex flex-col overflow-hidden ${pad}`} aria-label="Menu principal">

      {/* ── RECHERCHE : filtre le menu en direct ───────────── */}
      <div className="flex-shrink-0 relative mb-2">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Rechercher un menu…"
          aria-label="Rechercher dans le menu"
          className="w-full rounded-md border bg-surface-2 text-sm text-ink placeholder:text-ink-muted pl-8 pr-8 py-2 focus:outline-none focus:border-brand"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Effacer la recherche"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-ink-muted hover:text-ink hover:bg-surface-hover"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── RACCOURCIS ÉPINGLÉS ─────────────────────────────
          Zone fixe : ce qu'on utilise tout le temps, toujours en haut. */}
      {shownPinned.length > 0 && (
        <div className="flex-shrink-0 max-h-[50%] overflow-y-auto flex flex-col gap-0.5 pb-2 mb-2 border-b">
          {shownPinned.map(mod => <ModuleBlock key={mod.key} mod={mod} />)}
        </div>
      )}

      {/* ── MODULES ────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5">
        {shownRest.map(mod => <ModuleBlock key={mod.key} mod={mod} />)}
        {noResult && (
          <p className="px-3 py-4 text-sm text-ink-muted">Aucun menu ne correspond à « {query.trim()} ».</p>
        )}
      </div>
    </nav>
  )
}

function Badge({ n }: { n: number }) {
  return (
    <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
      {n > 99 ? '99+' : n}
    </span>
  )
}
