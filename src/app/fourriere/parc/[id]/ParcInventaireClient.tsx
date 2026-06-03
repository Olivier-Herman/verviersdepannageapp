'use client'
// src/app/fourriere/parc/[id]/ParcInventaireClient.tsx
//
// Olivier 2026-06-03 : wrapper qui ajoute le breadcrumb "← Tous les parcs"
// et delegue le rendu inventaire au FourriereClient existant (avec props
// depotName + depotZoneKeys pour restreindre l affichage).

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
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
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
}

export default function ParcInventaireClient({ depot, depotZones, userRole, userName, userEmail, userModules }: Props) {
  const zoneKeys = depotZones.map(z => z.key)
  return (
    <div className="relative">
      <div className="absolute top-4 left-4 lg:top-6 lg:left-6 z-10">
        <Link href="/fourriere"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface/90 backdrop-blur border rounded-lg text-ink-secondary hover:text-ink hover:bg-surface-hover text-xs font-medium transition shadow-sm">
          <ArrowLeft size={13} /> Recherche fourrière
        </Link>
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
