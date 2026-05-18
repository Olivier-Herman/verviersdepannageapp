'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, FileText, DollarSign, Settings, ClipboardCheck, Radio, Bell, ShieldCheck, Receipt } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/admin/users',          label: 'Utilisateurs',   icon: Users },
  { href: '/admin/documents',      label: 'Documents',      icon: FileText },
  { href: '/admin/dispatch',       label: 'Dispatch',       icon: Radio },
  { href: '/admin/decharges',      label: 'Décharges',      icon: ShieldCheck },
  { href: '/admin/check-vehicule', label: 'Check Véhicule', icon: ClipboardCheck },
  { href: '/admin/cash',           label: 'Caisses',        icon: DollarSign },
  { href: '/admin/tarifs',         label: 'Tarifs',         icon: Receipt },
  { href: '/admin/notifications',  label: 'Notifications',  icon: Bell },
  { href: '/admin/settings',       label: 'Paramètres',     icon: Settings },
]

export default function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="flex overflow-x-auto gap-1 px-4 py-2 bg-surface-2 border-b scrollbar-hide">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href)
        return (
          <Link key={href} href={href}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
              active
                ? 'bg-brand text-white'
                : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
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
