'use client'

// En-tête des pages de Réglages (option C, Olivier 11/11/2026) : retour vers la page
// Réglages, titre de l'écran et ses onglets. Remplace l'ancien menu du haut à 43 liens.
// Les onglets sont les pages existantes, à leur adresse habituelle (src/lib/admin/reglages.ts) :
// un ancien lien ouvre directement le bon onglet. Rien sur la page Réglages elle-même.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { ecranDe } from '@/lib/admin/reglages'

export default function AdminNav({ obd = false, superadmin = false }: { obd?: boolean; superadmin?: boolean }) {
  const pathname = usePathname() || ''
  if (pathname === '/admin') return null

  const trouve = ecranDe(pathname, { superadmin, obd })

  return (
    <nav aria-label="Réglages" className="px-4 pt-3 pb-1 lg:px-0 lg:pt-0 space-y-2">
      <Link href="/admin"
        className="inline-flex items-center gap-1 min-h-[44px] -ml-1 pr-3 text-sm font-medium text-ink-secondary hover:text-ink">
        <ChevronLeft size={18} /> Réglages
      </Link>
      {trouve && trouve.ecran.onglets.length > 1 && (
        <div>
          <p className="text-ink font-bold text-lg leading-tight mb-2">{trouve.ecran.label}</p>
          <div role="tablist" className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {trouve.ecran.onglets.map(o => {
              const actif = o.href === trouve.actif
              return (
                <Link key={o.href} href={o.href} role="tab" aria-selected={actif}
                  className={`flex items-center min-h-[44px] px-4 rounded-xl text-sm font-semibold whitespace-nowrap border transition-colors ${
                    actif ? 'bg-brand/10 border-brand text-brand' : 'bg-surface border-strong text-ink-secondary hover:text-ink hover:border-brand/40'
                  }`}>
                  {o.label}
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </nav>
  )
}
