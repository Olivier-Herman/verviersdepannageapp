'use client'
// src/app/fourriere/parc/[id]/ParcInventaireClient.tsx
//
// Olivier 2026-06-03 : wrapper qui ajoute :
//   - un bandeau "Recherche fourriere" + tuiles parcs en haut pour naviguer
//     facilement entre les 5 parcs
//   - delegue le rendu inventaire au FourriereClient existant (depotName +
//     depotZoneKeys pour restreindre l affichage).

import Link from 'next/link'
import { ArrowLeft, Building2, Star } from 'lucide-react'
import FourriereClient from '../../FourriereClient'

interface Depot {
  id:               string
  name:             string
  address:          string | null
  is_default_parc:  boolean
}

interface Props {
  depot:       Depot
  depotZones:  { key: string; label: string | null }[]
  allDepots:   { id: string; name: string }[]
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
}

export default function ParcInventaireClient({ depot, depotZones, allDepots, userRole, userName, userEmail, userModules }: Props) {
  const zoneKeys = depotZones.map(z => z.key)
  return (
    <div>
      {/* Bandeau navigation parcs */}
      <div className="bg-surface border-b px-4 lg:px-6 py-3 flex items-center gap-3 flex-wrap">
        <Link href="/fourriere"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink text-xs font-medium transition">
          <ArrowLeft size={13} /> Recherche
        </Link>
        <div className="h-5 w-px bg-ink/15"></div>
        <div className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0">
          {allDepots.map(d => {
            const active = d.id === depot.id
            return (
              <Link key={d.id} href={`/fourriere/parc/${d.id}`}
                className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                  active
                    ? 'bg-brand text-white border-brand shadow-sm'
                    : 'bg-surface-2 text-ink-secondary border hover:text-ink hover:bg-surface-hover'
                }`}
                title={active ? `Parc actuel : ${d.name}` : `Aller au parc ${d.name}`}
              >
                <Building2 size={12} />
                {d.name}
              </Link>
            )
          })}
        </div>
      </div>

      <FourriereClient
        userRole={userRole}
        userName={userName}
        userEmail={userEmail || null}
        userModules={userModules}
        depotName={depot.name}
        depotZoneKeys={zoneKeys}
      />
    </div>
  )
}
