// src/app/appel/page.tsx — ouverte par Teams quand un agent décroche un appel extérieur (réglage « ouvrir une
// application pour les appels entrants » de la stratégie d'appel Teams, adresse /appel?tel={phone}). Olivier 24/11/2026.
// Une fiche évidente pour ce numéro (numéro retenu, ou une seule fiche en cours) → elle s'ouvre directement.
// Sinon : choix parmi les fiches du numéro, ou recherche ; le choix retient le numéro pour la fiche.
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import AppShell from '@/components/layout/AppShell'
import { peutVoirAppels, fichesDuNumero, ficheEvidente, libelleFiche, numeroLisible, motifNumero } from '@/lib/appels-fiches'
import AppelClient from './AppelClient'

export const dynamic = 'force-dynamic'

export default async function AppelPage({ searchParams }: { searchParams?: { tel?: string; choisir?: string } }) {
  const tel = String(searchParams?.tel || '').trim()
  const session = await getServerSession(authOptions)
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent('/appel?tel=' + tel)}`)
  const u = session.user as any
  if (!peutVoirAppels(u)) redirect('/dashboard?error=access_denied')

  let fiches: Awaited<ReturnType<typeof fichesDuNumero>> = []
  let erreur: string | null = null
  try { fiches = await fichesDuNumero(createAdminClient(), tel) } catch (e: any) { erreur = String(e?.message || e) }
  const evidente = ficheEvidente(fiches)
  if (evidente && !searchParams?.choisir) redirect(`/dispatch/${evidente.id}`)

  return (
    <AppShell title="Appel en cours" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={u.role || ''} userModules={u.modules || []}>
      <AppelClient
        numero={tel} numeroLisible={motifNumero(tel) ? numeroLisible(tel) : ''} erreur={erreur}
        fiches={fiches.slice(0, 8).map(f => ({ id: f.id, ...libelleFiche(f) }))}
      />
    </AppShell>
  )
}
