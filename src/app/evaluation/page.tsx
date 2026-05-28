// Page /evaluation - cachee (pas dans la nav).
// URL partagee manuellement aux testeurs externes.
// User doit etre connecte pour identifier qui fait le test.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import EvaluationClient     from './EvaluationClient'

export const dynamic = 'force-dynamic'

export default async function EvaluationPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/evaluation')

  const user = session.user as any
  return <EvaluationClient userName={user.name || user.email || 'Testeur'} userEmail={user.email || ''} />
}
