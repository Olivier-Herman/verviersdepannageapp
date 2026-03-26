// src/app/mission/new/page.tsx
import { getServerSession }       from 'next-auth'
import { authOptions }            from '@/lib/auth'
import { redirect }               from 'next/navigation'
import NewDriverMissionClient     from './NewDriverMissionClient'

export default async function NewDriverMissionPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  return <NewDriverMissionClient />
}
