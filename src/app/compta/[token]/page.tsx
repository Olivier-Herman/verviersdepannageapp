// Page publique d'un dossier comptable (lien personnel de la comptable, sans compte).
import { notFound } from 'next/navigation'
import { verifyDossierToken, loadDossier } from '@/lib/compta/dossier'
import DossierClient from './DossierClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Dossier comptable — Verviers Dépannage', robots: { index: false, follow: false } }

export default async function Page({ params }: { params: { token: string } }) {
  const id = verifyDossierToken(params.token)
  if (!id) notFound()
  const d = await loadDossier(id)
  if (!d) notFound()
  return <DossierClient token={params.token} dossier={d} />
}
