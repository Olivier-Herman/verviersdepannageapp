import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import CashClient from './CashClient'

export default async function CashPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  return <CashClient userName={session.user.name || session.user.email || ''} />
}
