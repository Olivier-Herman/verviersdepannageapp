'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { filterNavItems } from './nav-items'
import AppNavV2 from './AppNavV2'
import { useTheme } from '@/components/theme/ThemeProvider'
import { useOnDutyPing } from '@/hooks/useOnDutyPing'
import { T } from '@/lib/i18n/T'
import { UserBlock, StatusToggle, FooterActions } from './AppShell'

interface Props {
  open:         boolean
  onClose:      () => void
  userName:     string
  userRole:     string
  userEmail?:   string
  userId?:      string
  userModules:  string[]
  navBadges?:   Record<string, number>
  /** Flag `nav_menu_v2` résolu par l'AppShell (évite un second fetch). */
  navV2?:       boolean
}

export default function MobileNavDrawer({ open, onClose, userName, userRole, userEmail, userId, userModules, navBadges = {}, navV2 = false }: Props) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const userNavOrder = (session?.user as any)?.navOrder as string[] | null | undefined
  const items = filterNavItems({ userModules, userRole, userNavOrder })
  const { theme, toggleTheme, mounted } = useTheme()
  const { onDuty, setOnDuty, isLockedByDuty } = useOnDutyPing()

  // Bloque le scroll du body quand le drawer est ouvert
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Ferme à l'Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="lg:hidden fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside className="relative flex flex-col w-72 max-w-[85vw] bg-surface border-r h-full">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <Link
            href="/dashboard"
            onClick={onClose}
            title="Retour au dashboard"
            className="inline-block hover:opacity-80 transition-opacity"
          >
            <img src="/logo.jpg" alt="VD Soft" className="h-9 w-auto object-contain" />
          </Link>
          <button
            onClick={onClose}
            aria-label="Fermer le menu"
            className="w-9 h-9 flex items-center justify-center bg-surface-hover rounded-md text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {/* Items — menu navigable si le flag nav_menu_v2 est actif, sinon liste plate */}
        {navV2 ? (
          <AppNavV2
            items={items}
            userRole={userRole}
            userModules={userModules}
            badges={navBadges}
            variant="drawer"
            onNavigate={onClose}
          />
        ) : (
        <nav className="flex-1 px-3 py-3 overflow-y-auto flex flex-col gap-0.5">
          {items.map(item => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            const badge = navBadges[item.href] || 0
            return (
              <Link key={item.href} href={item.href} onClick={onClose}
                className={`flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-brand-soft text-brand'
                    : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
                }`}>
                <span className="text-base">{item.icon}</span>
                {item.i18nKey ? <T k={item.i18nKey} /> : item.label}
                {badge > 0 && <span className="ml-auto min-w-[18px] h-[18px] px-1.5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">{badge > 99 ? '99+' : badge}</span>}
              </Link>
            )
          })}
        </nav>
        )}

        {/* Footer 3 zones — sous-composants partagés avec AppShell */}
        <div className="px-2 py-2 border-t space-y-1">
          <UserBlock
            userName={userName}
            userRole={userRole}
            userId={userId}
            userEmail={userEmail}
            onClick={onClose}
          />
          <StatusToggle onDuty={onDuty} setOnDuty={setOnDuty} isLockedByDuty={isLockedByDuty} />
          <FooterActions theme={theme} toggleTheme={toggleTheme} mounted={mounted} onClose={onClose} />
        </div>
      </aside>
    </div>
  )
}
