'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useEffect } from 'react'
import { Moon, Sun } from 'lucide-react'
import { filterNavItems } from './nav-items'
import { useTheme } from '@/components/theme/ThemeProvider'

interface Props {
  open:        boolean
  onClose:     () => void
  userName:    string
  userRole:    string
  userModules: string[]
}

export default function MobileNavDrawer({ open, onClose, userName, userRole, userModules }: Props) {
  const pathname = usePathname()
  const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
  const items = filterNavItems({ userModules, userRole })
  const { theme, toggleTheme, mounted } = useTheme()

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
      />

      {/* Drawer */}
      <aside className="relative flex flex-col w-72 max-w-[85vw] bg-[#1A1A1A] border-r border-[#2a2a2a] h-full">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#2a2a2a] flex items-center justify-between">
          <Link href="/dashboard" onClick={onClose}>
            <img src="/logo.jpg" alt="Verviers Dépannage" className="h-9 w-auto object-contain" />
          </Link>
          <button onClick={onClose}
            className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg active:bg-[#333]">
            ✕
          </button>
        </div>

        {/* Items */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto flex flex-col gap-0.5">
          {items.map(item => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link key={item.href} href={item.href} onClick={onClose}
                className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? 'bg-brand/10 text-white border border-brand/20'
                    : 'text-zinc-300 hover:text-white hover:bg-[#2a2a2a]'
                }`}>
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-[#2a2a2a]">
          <div className="flex items-center gap-1 mb-1">
            <Link href="/profil" onClick={onClose}
              className="flex-1 flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#2a2a2a] transition-all min-w-0">
              <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{userName}</p>
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
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-all w-full">
            <span className="text-base">🚪</span>
            Déconnexion
          </button>
        </div>
      </aside>
    </div>
  )
}
