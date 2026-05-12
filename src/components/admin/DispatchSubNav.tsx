'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Radio, Percent, Database, MapPin } from 'lucide-react'

const SUB_NAV = [
  { href: '/admin/dispatch',            label: 'Vue d\'ensemble', icon: Radio,    exact: true  },
  { href: '/admin/missions',            label: 'Missions',         icon: Radio                  },
  { href: '/admin/surcharges',          label: 'Majorations',      icon: Percent                },
  { href: '/admin/sources',             label: 'Sources',          icon: Database               },
  { href: '/admin/depots',              label: 'Dépôts',           icon: MapPin                 },
]

export default function DispatchSubNav() {
  const pathname = usePathname()
  return (
    <div className="bg-surface border-b border sticky top-0 z-10">
      <div className="flex overflow-x-auto px-4 py-2 gap-1 scrollbar-hide">
        {SUB_NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition flex-shrink-0 ${
                active
                  ? 'bg-brand text-white'
                  : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
              }`}
            >
              <Icon size={14} />
              {label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
