// src/app/releve/[token]/page.tsx — page publique du « Relevé des dossiers ouverts » d'une assistance (Olivier
// 28/10/2026, maquette F1DZojG1RjQxDVs9xtuV7w) : lien personnel du mail, 90 jours, sans compte. Factures relues en direct.
import { notFound } from 'next/navigation'
import { releveParJeton } from '@/lib/facturation/releves'
import ReleveClient from './ReleveClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Relevé des dossiers ouverts — Verviers Dépannage', robots: { index: false, follow: false } }

export default async function Page({ params }: { params: { token: string } }) {
  const r = await releveParJeton(params.token)
  if (!r) notFound()
  return <ReleveClient token={params.token} releve={r.releve} date={r.date} />
}
