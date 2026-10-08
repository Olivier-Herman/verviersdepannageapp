// Page publique de vérification physique du parc (lien personnel de la fourrière, sans compte).
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import { verifyVerificationToken, loadVerification } from '@/lib/parc/verification'
import VerifClient from './VerifClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vérification du parc — Verviers Dépannage', robots: { index: false, follow: false } }

export default async function Page({ params }: { params: { token: string } }) {
  const id = verifyVerificationToken(params.token)
  if (!id) notFound()
  const v = await loadVerification(createAdminClient(), id)
  if (!v) notFound()
  return <VerifClient token={params.token} title={v.title} initial={v.items} />
}
