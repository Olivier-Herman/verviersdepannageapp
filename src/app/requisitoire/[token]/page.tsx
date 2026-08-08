// Page PUBLIQUE de dépôt du réquisitoire par la police (token = autorisation).
// Hors matcher middleware → pas de login. Olivier 2026-08-08.
import RequisitoireDepotClient from './RequisitoireDepotClient'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Dépôt du réquisitoire — Verviers Dépannage' }

export default function RequisitoireDepotPage({ params }: { params: { token: string } }) {
  return <RequisitoireDepotClient token={params.token} />
}
