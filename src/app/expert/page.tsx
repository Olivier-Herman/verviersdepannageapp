// src/app/expert/page.tsx
//
// Espace expert (PUBLIC) : ouvert en scannant le QR A4 de l'accueil.
// Clé d'appareil mémorisée sur le téléphone ; validation au comptoir.
import ExpertClient from './ExpertClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Experts — Verviers Dépannage' }

export default function ExpertPage() {
  return <ExpertClient />
}
