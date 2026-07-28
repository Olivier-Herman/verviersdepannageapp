// src/app/caisse/ecran/[key]/page.tsx
//
// Page KIOSQUE écran client (face-comptoir). Publique (la tablette l'ouvre sans
// login) — n'affiche que ce que l'encaissement y pousse. Olivier 2026-07-28.

import EcranClient from './EcranClient'

export const dynamic = 'force-dynamic'

export default function EcranClientPage({ params }: { params: { key: string } }) {
  return <EcranClient displayKey={params.key} />
}
