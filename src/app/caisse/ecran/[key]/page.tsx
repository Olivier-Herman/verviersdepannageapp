// src/app/caisse/ecran/[key]/page.tsx
//
// Page KIOSQUE écran client (face-comptoir). Publique (la tablette l'ouvre sans
// login) — n'affiche que ce que l'encaissement y pousse. Olivier 2026-07-28.

import type { Metadata } from 'next'
import EcranClient from './EcranClient'

export const dynamic = 'force-dynamic'

// Manifest dédié « Comptoir » : installable en app plein écran (fenêtre dédiée,
// paysage), distinct de l'app VD Soft. Le start_url embarque l'agent eID local.
export const metadata: Metadata = {
  manifest: '/comptoir.webmanifest',
  title: 'VD Soft — Comptoir',
}

export default function EcranClientPage({ params }: { params: { key: string } }) {
  return <EcranClient displayKey={params.key} />
}
