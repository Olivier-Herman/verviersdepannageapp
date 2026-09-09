'use client'

// Barre réduite (64 px) du menu v3 — lot 3 (Olivier 09/09/2026 : « la barre
// réduite garde tout »). Avant, replier la barre retombait sur la liste plate
// v1. Ici : un pictogramme par module avec son compteur ; un module à sections
// ouvre un volet flottant à côté (clic ou survol), un module plat est un lien.
// Mêmes permissions que le menu déplié (buildNavTree sur les items filtrés).

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { T } from '@/lib/i18n/T'
import { type NavItem } from './nav-items'
import { buildNavTree, landingHref, findActiveModule, findActiveSectionHref, type BuiltModule } from './nav-tree'

export default function AppNavMini({ items, userRole, userModules, badges = {}, onOpenPalette }: {
  items: NavItem[]; userRole: string; userModules: string[]; badges?: Record<string, number>; onOpenPalette?: () => void
}) {
  const pathname = usePathname()
  const modules  = useMemo(() => buildNavTree(items, userRole, userModules), [items, userRole, userModules])
  const active   = useMemo(() => findActiveModule(modules, pathname), [modules, pathname])
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [top, setTop] = useState(0)
  const navRef = useRef<HTMLElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const modBadge = (m: BuiltModule) => m.href ? (badges[m.href] || 0) : m.visibleSections.reduce((s, x) => s + (badges[x.href] || 0), 0)
  const openFor = (m: BuiltModule, el: HTMLElement) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    const navTop = navRef.current?.getBoundingClientRect().top ?? 0
    setTop(el.getBoundingClientRect().top - navTop + (navRef.current?.scrollTop ?? 0))
    setOpenKey(m.key)
  }
  const scheduleClose = () => { closeTimer.current = setTimeout(() => setOpenKey(null), 250) }
  useEffect(() => { setOpenKey(null) }, [pathname])
  const openMod = openKey ? modules.find(m => m.key === openKey) : null

  return (
    <nav ref={navRef} className="flex-1 py-3 px-2 overflow-y-auto flex flex-col gap-0.5 relative" aria-label="Menu principal (réduit)">
      {onOpenPalette && (
        <button type="button" onClick={onOpenPalette} title="Aller à… (⌘K)" aria-label="Ouvrir la palette Aller à"
          className="group relative flex items-center justify-center rounded-md px-2 py-2.5 mb-1 text-ink-secondary hover:text-ink hover:bg-surface-hover">
          <Search size={17} />
        </button>
      )}
      {modules.map(m => {
        const href = landingHref(m); if (!href) return null
        const badge = modBadge(m)
        const isActive = active?.key === m.key
        const hasKids = m.visibleSections.filter(s => s.href !== href).length > 0
        const cls = `group relative flex items-center justify-center rounded-md px-2 py-2.5 transition-colors ${isActive ? 'bg-brand-soft text-brand' : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'}`
        const inner = (
          <span className="relative text-base">
            {m.icon}
            {badge > 0 && <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-brand text-white text-[9px] font-bold flex items-center justify-center">{badge > 99 ? '99+' : badge}</span>}
          </span>
        )
        return hasKids ? (
          <button key={m.key} type="button" className={cls} aria-haspopup="menu" aria-expanded={openKey === m.key}
            onClick={e => openKey === m.key ? setOpenKey(null) : openFor(m, e.currentTarget)}
            onMouseEnter={e => openFor(m, e.currentTarget)} onMouseLeave={scheduleClose}
            title={m.label}>
            {inner}
          </button>
        ) : (
          <Link key={m.key} href={href} className={cls} title={m.label} onMouseEnter={() => setOpenKey(null)}>
            {inner}
          </Link>
        )
      })}

      {/* Volet des sections du module survolé / cliqué */}
      {openMod && (
        <div role="menu" style={{ top }} onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current) }} onMouseLeave={scheduleClose}
          className="absolute left-full ml-1 z-50 min-w-[210px] bg-surface border rounded-xl shadow-xl p-1.5">
          <Link href={landingHref(openMod) || '#'} className="block px-3 pt-1.5 pb-1 text-xs font-bold uppercase tracking-wide text-ink-muted hover:text-ink">
            {openMod.icon} {openMod.i18nKey ? <T k={openMod.i18nKey} /> : openMod.label}
          </Link>
          {openMod.visibleSections.map(s => {
            const isActive = findActiveSectionHref(openMod, pathname) === s.href
            const b = badges[s.href] || 0; const Icon = s.icon
            return (
              <Link key={s.href} href={s.href} role="menuitem"
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium ${isActive ? 'bg-brand-soft text-brand' : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'}`}>
                {Icon && <Icon size={15} className="flex-shrink-0 opacity-70" />}
                <span className="flex-1 min-w-0 truncate">{s.i18nKey ? <T k={s.i18nKey} /> : s.label}</span>
                {b > 0 && <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">{b > 99 ? '99+' : b}</span>}
              </Link>
            )
          })}
        </div>
      )}
    </nav>
  )
}
