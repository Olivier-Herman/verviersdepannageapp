'use client'
// src/app/fourriere/parc/[id]/ParcInventaireClient.tsx
//
// Olivier 2026-06-03 : delegue le rendu inventaire au FourriereClient existant
// avec en plus le bandeau de tuiles parcs (rendu DANS le content area, entre
// le titre "Fourriere" du AppShell et le header "Parc X").

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
  const parcsNav = allDepots.map(d => ({ id: d.id, name: d.name, active: d.id === depot.id }))
  return (
    <FourriereClient
      userRole={userRole}
      userName={userName}
      userEmail={userEmail || null}
      userModules={userModules}
      depotName={depot.name}
      depotZoneKeys={zoneKeys}
      parcsNav={parcsNav}
    />
  )
}
