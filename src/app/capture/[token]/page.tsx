// src/app/capture/[token]/page.tsx
//
// Page MOBILE ouverte en scannant le QR affiché sur la fiche : photos de la
// pièce d'identité / du CMR / du bon Informex, ou signature de l'attestation.
// Publique : le jeton (usage unique, 15 min) tient lieu d'accès.
import CaptureClient from './CaptureClient'

export const dynamic = 'force-dynamic'

export default function CapturePage({ params }: { params: { token: string } }) {
  return <CaptureClient token={params.token} />
}
