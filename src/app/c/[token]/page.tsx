// src/app/c/[token]/page.tsx
//
// Page PUBLIQUE ouverte par le client en scannant le QR du chauffeur : il
// remplit lui-même ses coordonnées (FR / NL / EN / DE), qui arrivent sur le
// formulaire d'encaissement du chauffeur. Le jeton (uuid, 30 min, usage
// unique) vaut autorisation. Hors matcher middleware. Olivier 19/09/2026.
import ClientCaptureClient from './ClientCaptureClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vos coordonnées — Verviers Dépannage', robots: { index: false, follow: false } }

export default function ClientCapturePage({ params }: { params: { token: string } }) {
  return <ClientCaptureClient token={params.token} gmKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''} />
}
