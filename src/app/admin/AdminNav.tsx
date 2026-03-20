'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/admin/users',    label: 'Utilisateurs', icon: '👥' },
  { href: '/admin/settings', label: 'Listes',       icon: '⚙️' },
]

export default function AdminNav() {
  const path = usePathname()

  return (
    <>
      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-5 pt-12 pb-3 safe-top">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/dashboard" className="text-zinc-500 hover:text-white text-sm">← Dashboard</Link>
        </div>
        <h1 className="text-white font-bold text-xl tracking-wide">Administration</h1>
      </div>

      {/* Tabs */}
      <div className="flex bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 gap-1">
        {NAV.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              path.startsWith(item.href)
                ? 'border-brand text-white'
                : 'border-transparent text-zinc-500 hover:text-white'
            }`}
          >
            <span className="text-base">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </div>
    </>
  )
}
