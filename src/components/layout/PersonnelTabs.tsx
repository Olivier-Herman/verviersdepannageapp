'use client'
// Sous-navigation partagée du module « Gestion du personnel » : une seule entrée
// dans le menu de gauche → onglets internes (segmented control + icônes).

import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Home, Users, Clock, TrendingUp, CalendarDays } from 'lucide-react'

const TABS = [
  { href: '/personnel',             label: 'Accueil',      Icon: Home },
  { href: '/personnel/repertoire',  label: 'Répertoire',   Icon: Users },
  { href: '/prestations',           label: 'Prestations',  Icon: Clock },
  { href: '/personnel/conges',      label: 'Congés',       Icon: CalendarDays },
  { href: '/personnel/rentabilite', label: 'Rentabilité',  Icon: TrendingUp },
]

export default function PersonnelTabs() {
  const path = usePathname()
  const { data: session } = useSession()
  const u = session?.user as any
  const isSuper = u?.role === 'superadmin' || (u?.roles || []).includes('superadmin')
  const tabs = TABS.filter(t => t.href !== '/personnel/rentabilite' || isSuper)   // Rentabilité = superadmin
  return (
    <div className="inline-flex gap-0.5 p-1 bg-surface border rounded-xl mb-6 max-w-full overflow-x-auto">
      {tabs.map(({ href, label, Icon }) => {
        const knownSub = ['/personnel', '/personnel/rentabilite', '/personnel/conges']
        const active = path === href
          || (href === '/personnel/repertoire' && path.startsWith('/personnel/') && !knownSub.includes(path))
        return (
          <a key={href} href={href}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
              active ? 'bg-brand text-white font-medium shadow-sm' : 'text-ink-muted hover:text-ink hover:bg-white/5'}`}>
            <Icon size={15} /> {label}
          </a>
        )
      })}
    </div>
  )
}
