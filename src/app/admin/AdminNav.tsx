'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'

const NAV = [
  { href: '/admin/users',     label: 'Utilisateurs', icon: '👥' },
  { href: '/admin/documents', label: 'Documents',    icon: '📁' },
  { href: '/admin/tgr',       label: 'TGR',          icon: '🛡️' },
  { href: '/admin/cash',      label: 'Caisses',      icon: '💰' },
  { href: '/admin/settings',  label: 'Paramètres',   icon: '⚙️' },
]

export default function AdminNav() {
  const path = usePathname()

  return (
    <>
      {/* ─── MOBILE ─── */}
      <div className="lg:hidden">
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-5 pt-12 pb-3">
          <div className="flex items-center gap-3 mb-3">
            <Link href="/dashboard" className="text-zinc-500 hover:text-white text-sm">← Dashboard</Link>
          </div>
          <Link href="/dashboard">
            <img src="/logo.jpg" alt="Verviers Dépannage" className="h-8 w-auto object-contain" />
          </Link>
        </div>
        <div className="flex bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 gap-1 overflow-x-auto">
          {NAV.map(item => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2
                          transition-colors whitespace-nowrap ${
                path.startsWith(item.href)
                  ? 'border-brand text-white'
                  : 'border-transparent text-zinc-500 hover:text-white'
              }`}>
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      {/* ─── DESKTOP ─── */}
      <aside className="hidden lg:flex flex-col w-64 min-h-screen bg-[#1A1A1A]
                        border-r border-[#2a2a2a] flex-shrink-0">
        <div className="px-6 py-6 border-b border-[#2a2a2a]">
          <Link href="/dashboard">
            <img src="/logo.jpg" alt="Verviers Dépannage" className="h-10 w-auto object-contain" />
          </Link>
          <p className="text-zinc-600 text-xs mt-2">Administration</p>
        </div>

        <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
          <p className="text-zinc-600 text-xs font-medium uppercase tracking-wider px-3 mb-2">Gestion</p>
          {NAV.map(item => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm
                          font-medium transition-all ${
                path.startsWith(item.href)
                  ? 'bg-brand/10 text-white border border-brand/20'
                  : 'text-zinc-400 hover:text-white hover:bg-[#2a2a2a]'
              }`}>
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          ))}

          <div className="mt-4 border-t border-[#2a2a2a] pt-4">
            <p className="text-zinc-600 text-xs font-medium uppercase tracking-wider px-3 mb-2">Navigation</p>
            <Link href="/dashboard"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm
                         font-medium text-zinc-400 hover:text-white hover:bg-[#2a2a2a] transition-all">
              <span className="text-lg">🏠</span>Dashboard
            </Link>
            <Link href="/encaissements"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm
                         font-medium text-zinc-400 hover:text-white hover:bg-[#2a2a2a] transition-all">
              <span className="text-lg">📊</span>Mouvements
            </Link>
          </div>
        </nav>

        <div className="px-3 py-4 border-t border-[#2a2a2a]">
          <button onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm
                       text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all w-full">
            <span className="text-lg">🚪</span>Déconnexion
          </button>
        </div>
      </aside>
    </>
  )
}
