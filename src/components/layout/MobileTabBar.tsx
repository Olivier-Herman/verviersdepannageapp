'use client'

// Barre du bas sur téléphone — menu v3, lot 3 (Olivier 09/09/2026). Les 4
// premières pages « Maintenant » du rôle, avec leurs compteurs, et un bouton
// Menu qui ouvre le tiroir habituel. Ne s'affiche que si le rôle a une zone
// « Maintenant » (les chauffeurs, sans réglage, ne la voient pas).

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMemo } from 'react'
import { Menu } from 'lucide-react'
import { T } from '@/lib/i18n/T'
import { type NavItem } from './nav-items'
import { buildNavTree } from './nav-tree'

export default function MobileTabBar({ items, userRole, userModules, now, badges = {}, onOpenMenu }: {
  items: NavItem[]; userRole: string; userModules: string[]; now: string[]; badges?: Record<string, number>; onOpenMenu: () => void
}) {
  const pathname = usePathname()
  const modules = useMemo(() => buildNavTree(items, userRole, userModules), [items, userRole, userModules])
  const tabs = useMemo(() => {
    const out: { href: string; label: React.ReactNode; icon: React.ReactNode }[] = []
    for (const h of now) {
      for (const m of modules) {
        if (m.href === h) { out.push({ href: h, label: m.i18nKey ? <T k={m.i18nKey} /> : m.label, icon: <span className="text-xl leading-none">{m.icon}</span> }); break }
        const s = m.visibleSections.find(x => x.href === h)
        if (s) { const Icon = s.icon; out.push({ href: h, label: s.i18nKey ? <T k={s.i18nKey} /> : s.label, icon: Icon ? <Icon size={20} /> : <span className="text-xl leading-none">{m.icon}</span> }); break }
      }
      if (out.length >= 4) break
    }
    return out
  }, [now, modules])
  if (tabs.length === 0) return null
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t safe-bottom" aria-label="Raccourcis">
      <div className="grid gap-0.5 px-1 pt-1.5 pb-2" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
        {tabs.map(t => {
          const active = pathname === t.href || (t.href !== '/' && pathname.startsWith(t.href + '/'))
          const b = badges[t.href] || 0
          return (
            <Link key={t.href} href={t.href}
              className={`relative flex flex-col items-center gap-0.5 rounded-lg py-1 text-[10.5px] font-medium leading-tight ${active ? 'text-brand' : 'text-ink-muted'}`}>
              {t.icon}
              <span className="max-w-full truncate px-0.5">{t.label}</span>
              {b > 0 && <span className="absolute top-0 right-[18%] min-w-[16px] h-[16px] px-1 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">{b > 99 ? '99+' : b}</span>}
            </Link>
          )
        })}
        <button type="button" onClick={onOpenMenu} className="flex flex-col items-center gap-0.5 rounded-lg py-1 text-[10.5px] font-medium leading-tight text-ink-muted" aria-label="Ouvrir le menu">
          <Menu size={20} /><span>Menu</span>
        </button>
      </div>
    </nav>
  )
}
