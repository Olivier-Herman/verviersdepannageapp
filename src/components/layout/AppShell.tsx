'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useState } from 'react'
import { Moon, Sun, LogOut, ArrowLeft, Menu } from 'lucide-react'
import VehicleCheckBanner from '@/components/check-vehicule/VehicleCheckBanner'
import { filterNavItems } from './nav-items'
import MobileNavDrawer from './MobileNavDrawer'
import { useTheme } from '@/components/theme/ThemeProvider'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'

interface AppShellProps {
  children:     React.ReactNode
  title:        string
  backHref?:    string
  headerExtra?: React.ReactNode
  userRole?:    string
  userName?:    string
  userEmail?:   string
  userId?:      string
  userModules?: string[]
}

export default function AppShell({
  children,
  title,
  backHref = '/dashboard',
  headerExtra,
  userRole = '',
  userName = '',
  userEmail,
  userId,
  userModules = [],
}: AppShellProps) {
  const pathname = usePathname()
  const visibleNav = filterNavItems({ userModules, userRole })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { theme, toggleTheme, mounted } = useTheme()

  return (
    <div className="min-h-screen flex">

      {/* ── SIDEBAR DESKTOP ─────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-64 min-h-screen bg-surface border-r flex-shrink-0 fixed top-0 left-0 h-full z-30">
        <div className="px-6 py-5 border-b">
          <Link href="/dashboard">
            <img src="/logo.jpg" alt="Verviers Dépannage" className="h-10 w-auto object-contain" />
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto flex flex-col gap-0.5">
          {visibleNav.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-brand-soft text-brand'
                    : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="px-3 py-4 border-t">
          <div className="flex items-center gap-1 mb-1">
            <Link href="/profil"
              className="flex-1 flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-hover transition-colors min-w-0">
              <Avatar name={userName || '?'} userId={userId} email={userEmail} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-ink text-sm font-medium truncate">{userName}</p>
                <p className="text-ink-faint text-xs capitalize">{userRole}</p>
              </div>
            </Link>
            <button
              onClick={toggleTheme}
              aria-label={theme === 'light' ? 'Basculer en mode sombre' : 'Basculer en mode clair'}
              title={theme === 'light' ? 'Basculer en mode sombre' : 'Basculer en mode clair'}
              className="w-9 h-9 flex items-center justify-center rounded-md text-ink-secondary hover:text-ink hover:bg-surface-hover transition-colors flex-shrink-0">
              {mounted && (theme === 'light' ? <Moon size={16} /> : <Sun size={16} />)}
            </button>
          </div>
          <Button
            variant="ghost"
            fullWidth
            iconLeft={<LogOut size={14} />}
            onClick={() => signOut({ callbackUrl: '/login' })}
          >
            Déconnexion
          </Button>
        </div>
      </aside>

      {/* ── CONTENU PRINCIPAL ────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:ml-64 min-h-screen">

        {/* Header mobile */}
        <div className="lg:hidden bg-surface border-b px-4 pt-12 pb-3 safe-top sticky top-0 z-20">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => setDrawerOpen(true)}
              aria-label="Ouvrir le menu"
              className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-md text-ink flex-shrink-0">
              <Menu size={18} />
            </button>
            <Link href="/dashboard" className="flex-1 flex justify-center">
              <img src="/logo.jpg" alt="VD" className="h-8 w-auto object-contain" />
            </Link>
            <Link href={backHref}
              aria-label="Retour"
              className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-md text-ink flex-shrink-0">
              <ArrowLeft size={16} />
            </Link>
          </div>
          <h1 className="font-display text-ink font-bold text-lg">{title}</h1>
          {headerExtra}
        </div>

        {/* Drawer mobile (shared) */}
        <MobileNavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          userName={userName}
          userRole={userRole}
          userEmail={userEmail}
          userId={userId}
          userModules={userModules}
        />

        {/* Header desktop */}
        <div className="hidden lg:block bg-surface border-b px-8 py-5 sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-ink font-bold text-2xl">{title}</h1>
            {headerExtra && <div className="flex-1 ml-8">{headerExtra}</div>}
          </div>
        </div>

        {/* Bannière check véhicule */}
        <VehicleCheckBanner />

        {/* Contenu */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
