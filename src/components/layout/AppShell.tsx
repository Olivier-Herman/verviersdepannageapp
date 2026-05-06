'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import VehicleCheckBanner from '@/components/check-vehicule/VehicleCheckBanner'
import { filterNavItems } from './nav-items'
import MobileNavDrawer from './MobileNavDrawer'
import { useTheme } from '@/components/theme/ThemeProvider'

interface AppShellProps {
  children:     React.ReactNode
  title:        string
  backHref?:    string
  headerExtra?: React.ReactNode
  userRole?:    string
  userName?:    string
  userModules?: string[]
}

export default function AppShell({
  children,
  title,
  backHref = '/dashboard',
  headerExtra,
  userRole = '',
  userName = '',
  userModules = [],
}: AppShellProps) {
  const pathname = usePathname()
  const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
  const visibleNav = filterNavItems({ userModules, userRole })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { theme, toggleTheme, mounted } = useTheme()

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex">

      {/* ── SIDEBAR DESKTOP ─────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-64 min-h-screen bg-[#1A1A1A] border-r border-[#2a2a2a] flex-shrink-0 fixed top-0 left-0 h-full z-30">
        <div className="px-6 py-5 border-b border-[#2a2a2a]">
          <Link href="/dashboard">
            <img src="/logo.jpg" alt="Verviers Dépannage" className="h-10 w-auto object-contain" />
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto flex flex-col gap-0.5">
          {visibleNav.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? 'bg-brand/10 text-white border border-brand/20'
                    : 'text-zinc-400 hover:text-white hover:bg-[#2a2a2a]'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="px-3 py-4 border-t border-[#2a2a2a]">
          <div className="flex items-center gap-1 mb-1">
            <Link href="/profil"
              className="flex-1 flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#2a2a2a] transition-all group min-w-0">
              <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate group-hover:text-brand transition-colors">{userName}</p>
                <p className="text-zinc-500 text-xs capitalize">{userRole}</p>
              </div>
            </Link>
            <button
              onClick={toggleTheme}
              aria-label={theme === 'light' ? 'Basculer en mode sombre' : 'Basculer en mode clair'}
              title={theme === 'light' ? 'Basculer en mode sombre' : 'Basculer en mode clair'}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-[#2a2a2a] transition-all flex-shrink-0">
              {mounted && (theme === 'light' ? <Moon size={16} /> : <Sun size={16} />)}
            </button>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all w-full"
          >
            <span className="text-base">🚪</span>
            Déconnexion
          </button>
        </div>
      </aside>

      {/* ── CONTENU PRINCIPAL ────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:ml-64 min-h-screen">

        {/* Header mobile */}
        <div className="lg:hidden bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-3 safe-top sticky top-0 z-20">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => setDrawerOpen(true)}
              aria-label="Ouvrir le menu"
              className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-xl flex-shrink-0 active:bg-[#333]">
              ☰
            </button>
            <Link href="/dashboard" className="flex-1 flex justify-center">
              <img src="/logo.jpg" alt="VD" className="h-8 w-auto object-contain" />
            </Link>
            <Link href={backHref}
              className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg flex-shrink-0">
              ←
            </Link>
          </div>
          <h1 className="text-white font-bold text-lg">{title}</h1>
          {headerExtra}
        </div>

        {/* Drawer mobile (shared) */}
        <MobileNavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          userName={userName}
          userRole={userRole}
          userModules={userModules}
        />

        {/* Header desktop */}
        <div className="hidden lg:block bg-[#1A1A1A] border-b border-[#2a2a2a] px-8 py-5 sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <h1 className="text-white font-bold text-2xl">{title}</h1>
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
