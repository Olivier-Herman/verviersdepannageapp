// Page PUBLIQUE de supervision TGR (responsable Touring), gatée par jeton.
// Hors matcher middleware → pas d'auth. Olivier 2026-07-11.
import SupervClient from './SupervClient'

export const dynamic = 'force-dynamic'

export default function TgrSupervisionPage({
  searchParams,
}: {
  searchParams: { token?: string }
}) {
  return <SupervClient token={searchParams.token || ''} />
}
