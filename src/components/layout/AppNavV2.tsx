'use client'

// Menu navigable à 2 niveaux qui glissent (flag `nav_menu_v2`).
//
//   Niveau 1 = modules ; un module à sections affiche un chevron › et fait GLISSER
//   le menu vers ses sections, avec « ‹ Modules » en haut pour revenir.
//
// Ne remplace QUE la liste du menu : le reste du shell (logo, footer, header, et
// surtout toute la zone opérationnelle à droite) est strictement inchangé.
// Les permissions viennent de filterNavItems() → aucun accès gagné ni perdu.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { T } from '@/lib/i18n/T'
import { type NavItem } from './nav-items'
import { buildNavTree, findActiveModule, findActiveSectionHref, type BuiltModule } from './nav-tree'

// Easing iOS de la maquette validée.
const SLIDE = 'transition-transform duration-300 [transition-timing-function:cubic-bezier(.32,.72,0,1)]'

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
  const active   = useMemo(() => findActiveModule(modules, pathname), [modules, pathname])

  // Module de l'URL courante, s'il a des sections (clé stable : évite de refermer
  // la pane à chaque re-render de l'AppShell).
  const activeKey = active && active.visibleSections.length > 0 ? active.key : null

  // Pane ouverte : le module courant si on est dans une de ses sections.
  const [openKey, setOpenKey] = useState<string | null>(activeKey)

  // Navigation vers un autre module → on se recale sur la pane du module courant.
  useEffect(() => { setOpenKey(activeKey) }, [activeKey])

  const openModule = openKey ? modules.find(m => m.key === openKey) || null : null
  const slid       = !!openModule
  const pad        = variant === 'drawer' ? 'px-3 py-3' : 'px-3 py-4'
  const rowPad     = variant === 'drawer' ? 'px-3 py-3' : 'px-3 py-2.5'

  const moduleBadge = (mod: BuiltModule) =>
    mod.href
      ? (badges[mod.href] || 0)
      : mod.visibleSections.reduce((sum, s) => sum + (badges[s.href] || 0), 0)

  return (
    <nav className={`flex-1 overflow-hidden ${pad}`} aria-label="Menu principal">
      <div className={`flex h-full w-[200%] ${SLIDE}`} style={{ transform: slid ? 'translateX(-50%)' : 'translateX(0)' }}>

        {/* ── PANE 1 — MODULES ───────────────────────────── */}
        <div className="w-1/2 h-full overflow-y-auto flex flex-col gap-0.5 pr-0.5" aria-hidden={slid}>
          {modules.map(mod => {
            const badge   = moduleBadge(mod)
            const isHere  = active?.key === mod.key
            const label   = mod.i18nKey ? <T k={mod.i18nKey} /> : mod.label
            const cls = `group relative flex items-center gap-3 rounded-md text-sm font-medium transition-colors ${rowPad} ${
              isHere ? 'bg-brand-soft text-brand' : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
            }`

            // Module plat → lien direct, comme aujourd'hui.
            if (mod.href) {
              return (
                <Link key={mod.key} href={mod.href} onClick={onNavigate} className={cls} tabIndex={slid ? -1 : undefined}>
                  <span className="text-base">{mod.icon}</span>
                  <span className="flex-1 min-w-0 truncate">{label}</span>
                  {badge > 0 && <Badge n={badge} />}
                </Link>
              )
            }

            // Module à sections → fait glisser le menu.
            return (
              <button
                key={mod.key}
                type="button"
                onClick={() => setOpenKey(mod.key)}
                className={`${cls} w-full text-left`}
                tabIndex={slid ? -1 : undefined}
                aria-expanded={false}
              >
                <span className="text-base">{mod.icon}</span>
                <span className="flex-1 min-w-0 truncate">{label}</span>
                {badge > 0 && <Badge n={badge} />}
                <ChevronRight size={15} className="flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
              </button>
            )
          })}
        </div>

        {/* ── PANE 2 — SECTIONS DU MODULE ────────────────── */}
        <div className="w-1/2 h-full overflow-y-auto flex flex-col gap-0.5 pl-0.5" aria-hidden={!slid}>
          {openModule && (
            <>
              <button
                type="button"
                onClick={() => setOpenKey(null)}
                className={`flex items-center gap-2 rounded-md text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors ${rowPad}`}
                tabIndex={slid ? undefined : -1}
              >
                <ChevronLeft size={14} className="flex-shrink-0" />
                Modules
              </button>

              <div className={`flex items-center gap-2 ${variant === 'drawer' ? 'px-3 py-2' : 'px-3 py-1.5'}`}>
                <span className="text-base">{openModule.icon}</span>
                <span className="text-ink font-semibold text-sm truncate">
                  {openModule.i18nKey ? <T k={openModule.i18nKey} /> : openModule.label}
                </span>
              </div>

              {openModule.visibleSections.map(section => {
                const isActive = findActiveSectionHref(openModule, pathname) === section.href
                const badge    = badges[section.href] || 0
                const Icon     = section.icon
                return (
                  <Link
                    key={section.href}
                    href={section.href}
                    onClick={onNavigate}
                    tabIndex={slid ? undefined : -1}
                    className={`flex items-center gap-3 rounded-md text-sm font-medium transition-colors ${rowPad} ${
                      isActive ? 'bg-brand-soft text-brand' : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
                    }`}
                  >
                    {Icon && <Icon size={16} className="flex-shrink-0 opacity-70" />}
                    <span className="flex-1 min-w-0 truncate">
                      {section.i18nKey ? <T k={section.i18nKey} /> : section.label}
                    </span>
                    {badge > 0 && <Badge n={badge} />}
                  </Link>
                )
              })}
            </>
          )}
        </div>
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
