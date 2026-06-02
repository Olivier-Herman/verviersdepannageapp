'use client'

import Link            from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut }     from 'next-auth/react'
import { GarageEntitySwitcher } from '@/components/garage/GarageEntitySwitcher'

export default function GarageHeader({ userName }: { userName: string }) {
  const pathname = usePathname()
  // Sur login/activate, on n affiche pas le header
  if (pathname?.startsWith('/garage/login') || pathname?.startsWith('/garage/activate')) return null

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
        <Link href="/garage" className="flex items-center gap-2 flex-shrink-0">
          <div className="w-9 h-9 bg-gradient-to-br from-red-600 to-red-800 rounded-lg flex items-center justify-center text-white font-bold text-sm">VD</div>
          <span className="font-bold text-gray-900 hidden sm:inline">VD Soft</span>
        </Link>

        <div className="flex-1">
          <GarageEntitySwitcher />
        </div>

        <Link href="/garage/profil"
          className="text-gray-700 hover:text-red-700 text-sm font-medium px-2 py-1 hidden sm:block"
          title={userName}>
          👤
        </Link>

        <button onClick={() => signOut({ callbackUrl: '/garage/login' })}
          className="text-gray-500 hover:text-red-700 text-sm font-medium px-2 py-1"
          title="Se déconnecter">
          ↪
        </button>
      </div>

      <nav className="bg-white border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 flex gap-1">
          {[
            { href: '/garage',          label: 'Mes missions' },
            { href: '/garage/demande',  label: '+ Nouvelle demande' },
            { href: '/garage/profil',   label: 'Mon profil' },
          ].map(link => {
            const active = pathname === link.href
            return (
              <Link key={link.href} href={link.href}
                className={`px-3 py-2.5 text-sm font-medium border-b-2 transition ${
                  active ? 'border-red-600 text-red-700' : 'border-transparent text-gray-500 hover:text-gray-900'
                }`}>
                {link.label}
              </Link>
            )
          })}
        </div>
      </nav>
    </header>
  )
}
