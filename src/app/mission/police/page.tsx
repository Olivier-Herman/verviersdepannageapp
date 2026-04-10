// src/app/mission/police/page.tsx
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import PoliceClient         from './PoliceClient'

export default async function PolicePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  return <PoliceClient />
}
