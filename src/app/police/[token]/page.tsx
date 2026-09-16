// Portail PUBLIC du policier (jeton signé par policier = autorisation).
// Hors matcher middleware → pas de login. Olivier 16/09/2026.
import PolicePortalClient from './PolicePortalClient'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Espace policier — Verviers Dépannage', robots: { index: false, follow: false } }

export default function PolicePortalPage({ params }: { params: { token: string } }) {
  return <PolicePortalClient token={params.token} />
}
