// Layout commun aux pages /garage (sauf login/activate qui sont publics).
// Inclut header avec logo, selecteur d entite et menu user.
// Olivier 2026-06-02.

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import GarageHeader          from './GarageHeader'

export const dynamic = 'force-dynamic'

export default async function GarageLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  // login + activate gerent leur propre auth — pas de redirection ici car
  // le middleware s en occupe. Mais on garde une garde additionnelle :
  if (!session) {
    // Redirect ne se declenche que si la page est protegee (cf middleware)
    return <>{children}</>
  }
  return (
    <div className="min-h-screen bg-gray-50">
      <GarageHeader userName={session.user?.name || session.user?.email || ''} />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  )
}
