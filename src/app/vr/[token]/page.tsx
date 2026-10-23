// src/app/vr/[token]/page.tsx — page PUBLIQUE du client pour le contrat du véhicule de remplacement VAB
// (Olivier 23/10/2026). Ouverte en scannant le QR du chauffeur ; le jeton vaut autorisation. Hors matcher middleware.
import VrClient from './VrClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Véhicule de remplacement — Verviers Dépannage', robots: { index: false, follow: false } }

export default function VrPage({ params }: { params: { token: string } }) {
  return <VrClient token={params.token} gmKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''} />
}
