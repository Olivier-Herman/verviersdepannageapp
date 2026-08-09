// Page PUBLIQUE de dépôt de la validation d'un état de frais (token = autorisation).
// Hors matcher middleware → pas de login. Olivier 2026-08-09.
import SaisieValidationClient from './SaisieValidationClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Validation état de frais — Verviers Dépannage' }

export default function SaisieValidationPage({ params }: { params: { token: string } }) {
  return <SaisieValidationClient token={params.token} />
}
