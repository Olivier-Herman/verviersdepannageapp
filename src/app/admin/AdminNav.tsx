'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, FileText, Truck, DollarSign, Settings, ClipboardCheck, Radio } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/admin/users',          label: 'Utilisateurs',   icon: Users },
  { href: '/admin/documents',      label: 'Documents',      icon: FileText },
  { href: '/admin/tgr',            label: 'TGR',            icon: Truck },
  { href: '/admin/check-vehicule', label: 'Check Véhicule', icon: ClipboardCheck },
  { href: '/admin/cash',           label: 'Caisses',        icon: DollarSign },
  { href: '/admin/missions',       label: 'Missions',       icon: Radio },
  { href: '/admin/settings',       label: 'Paramètres',     icon: Settings },
]

export default function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="flex overflow-x-auto gap-1 px-4 py-2 bg-[#111111] border-b border-border scrollbar-hide">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href)
        return (
          <Link key={href} href={href}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition flex-shrink-0 ${
              active
                ? 'bg-brand text-white'
                : 'text-zinc-400 hover:text-white hover:bg-surface-2'
            }`}
          >
            <Icon size={15} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
