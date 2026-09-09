// Layout des pages PROTÉGÉES de l'espace client garage (accueil, demande,
// mission, profil). La garde est ICI, côté serveur (getServerSession), et non
// plus dans le middleware : le 09/09/2026, CP Recycling se connectait bien
// (accueil OK, API OK) mais chaque clic sur « Nouvelle demande » le renvoyait
// sur /login — le middleware edge ne lisait pas son jeton alors que le serveur
// le lisait. Les pages publiques (login, activate) et set-password restent
// hors de ce groupe. Olivier 2026-09-09.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import GarageHeader          from '../GarageHeader'

export const dynamic = 'force-dynamic'

export default async function GarageAppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/garage/login')
  const u = session.user as any
  if (u.role !== 'garage') redirect('/dashboard')
  if (u.mustChangePassword) redirect('/garage/set-password')
  return (
    <div className="min-h-screen bg-gray-50">
      <GarageHeader userName={session.user?.name || session.user?.email || ''} />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  )
}
