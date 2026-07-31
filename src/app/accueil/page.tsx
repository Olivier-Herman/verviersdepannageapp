// src/app/accueil/page.tsx
// Borne visiteur — PAGE PUBLIQUE (hors matcher middleware) : le visiteur scanne
// le QR au comptoir, choisit son motif, s'identifie (e-mail ou GSM) et entre
// dans la file d'attente réception. Bilingue FR/EN. Olivier 2026-07-31.

import AccueilClient from './AccueilClient'

export const dynamic  = 'force-dynamic'
export const metadata = { title: 'Accueil visiteur — VD Soft' }

export default function AccueilPage() {
  return <AccueilClient />
}
