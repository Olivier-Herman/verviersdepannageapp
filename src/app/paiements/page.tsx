// src/app/paiements/page.tsx — Paiements fournisseurs (Olivier 16/10/2026).
// Olivier trie et ajoute à la liste d'attente ; Momo choisit chaque jour ouvrable ce qui part dans le lot.
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { accesPaiements }   from '@/lib/paiements/acces'
import { SOCIETES }         from '@/lib/paiements/fournisseurs'
import PaiementsClient      from './PaiementsClient'

export const dynamic = 'force-dynamic'

export default async function PaiementsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const acc = await accesPaiements(session)
  if (!acc.lot) redirect('/dashboard?error=access_denied')
  const u = session.user as any
  return <PaiementsClient
    societes={SOCIETES.map(s => ({ id: s.id, label: s.label }))} peutTrier={acc.tri}
    userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userModules={u.modules || []} />
}
