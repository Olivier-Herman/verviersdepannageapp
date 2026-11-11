'use client'

// En-tête des écrans de Réglages (Olivier 11/11/2026, maquette validée :
// https://claude.ai/artifact/691RdVeV3wwexScKXUZaSo) : retour, bandeau de la couleur de la
// rubrique avec le titre de l'écran (les <h1> propres aux pages sont masqués, voir
// globals.css « .reglages-contenu »), emplacement pour les chiffres de l'écran
// (<BandeauChiffres>), onglets en pastilles. Les onglets sont les pages existantes, à leur
// adresse habituelle (src/lib/admin/reglages.ts). Rien sur la page Réglages elle-même.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { ecranDe } from '@/lib/admin/reglages'
import { DEGRADE, VISUEL, VISUEL_DEFAUT } from '@/lib/admin/reglages-visuel'
import { ID_BANDEAU_CHIFFRES } from '@/components/admin/BandeauChiffres'

export default function AdminNav({ obd = false, superadmin = false }: { obd?: boolean; superadmin?: boolean }) {
  const pathname = usePathname() || ''
  if (pathname === '/admin') return null
  return <EnTeteReglages pathname={pathname} obd={obd} superadmin={superadmin} />
}

/** Affichage de l'en-tête pour une adresse donnée (séparé pour pouvoir le tester). */
export function EnTeteReglages({ pathname, obd, superadmin }: { pathname: string; obd: boolean; superadmin: boolean }) {

  const trouve = ecranDe(pathname, { superadmin, obd })
  const v = trouve ? (VISUEL[trouve.visuel] || VISUEL_DEFAUT) : VISUEL_DEFAUT
  const Icon = v.icon
  const plusieurs = !!trouve && trouve.ecran.onglets.length > 1

  return (
    <nav aria-label="Réglages" className="px-4 pt-3 pb-1 lg:px-0 lg:pt-0 space-y-3 max-w-[1800px]">
      <Link href="/admin"
        className="inline-flex items-center gap-1 min-h-[44px] pl-2.5 pr-4 rounded-full bg-surface border border-strong shadow-card text-sm font-semibold text-ink hover:border-ink-faint">
        <ChevronLeft size={18} /> Réglages
      </Link>

      {trouve && (
        <div className={`relative overflow-hidden rounded-3xl p-5 lg:p-6 text-white bg-gradient-to-br shadow-lg ${DEGRADE[v.couleur]}`}>
          <Icon aria-hidden size={170} strokeWidth={1.1} className="pointer-events-none absolute -right-6 -bottom-12 text-white/15" />
          <div className="relative flex flex-wrap items-center gap-4">
            <span className="w-14 h-14 lg:w-16 lg:h-16 rounded-2xl flex items-center justify-center bg-white/20 ring-1 ring-white/30 flex-shrink-0">
              <Icon size={28} />
            </span>
            <div className="flex-1 min-w-[180px]">
              <p className="font-display font-bold text-2xl lg:text-3xl leading-tight tracking-tight">{trouve.ecran.label}</p>
              <p className="text-white/90 text-sm mt-0.5">
                {plusieurs ? `${trouve.rubrique} · ${trouve.ecran.onglets.length} onglets` : (trouve.ecran.desc || trouve.rubrique)}
              </p>
            </div>
            <div id={ID_BANDEAU_CHIFFRES} className="flex flex-wrap gap-2 lg:gap-3 empty:hidden" />
          </div>
        </div>
      )}

      {plusieurs && (
        <div role="tablist" className="flex gap-2 overflow-x-auto [contain:inline-size] pb-1 scrollbar-hide">
          {trouve!.ecran.onglets.map(o => {
            const actif = o.href === trouve!.actif
            return (
              <Link key={o.href} href={o.href} role="tab" aria-selected={actif}
                className={`flex items-center min-h-[46px] px-5 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${
                  actif
                    ? `text-white bg-gradient-to-br shadow-md ${DEGRADE[v.couleur]}`
                    : 'bg-surface border border-strong text-ink-secondary hover:text-ink hover:border-ink-faint'
                }`}>
                {o.label}
              </Link>
            )
          })}
        </div>
      )}
    </nav>
  )
}
