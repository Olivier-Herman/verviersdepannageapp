'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useEffect } from 'react'
import { Moon, Sun, LogOut, X } from 'lucide-react'
import { filterNavItems } from './nav-items'
import { useTheme } from '@/components/theme/ThemeProvider'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'

interface Props {
  open:         boolean
  onClose:      () => void
  userName:     string
  userRole:     string
  userEmail?:   string
  userId?:      string
  userModules:  string[]
}

export default function MobileNavDrawer({ open, onClose, userName, userRole, userEmail, userId, userModules }: Props) {
  const pathname = usePathname()
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
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside className="relative flex flex-col w-72 max-w-[85vw] bg-surface border-r h-full">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <Link href="/dashboard" onClick={onClose}>
            <img src="/logo.jpg" alt="Verviers Dépannage" className="h-9 w-auto object-contain" />
          </Link>
          <button
            onClick={onClose}
            aria-label="Fermer le menu"
            className="w-9 h-9 flex items-center justify-center bg-surface-hover rounded-md text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {/* Items */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto flex flex-col gap-0.5">
          {items.map(item => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link key={item.href} href={item.href} onClick={onClose}
                className={`flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-brand-soft text-brand'
                    : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
                }`}>
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t">
          <div className="flex items-center gap-1 mb-1">
            <Link href="/profil" onClick={onClose}
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
    </div>
  )
}
