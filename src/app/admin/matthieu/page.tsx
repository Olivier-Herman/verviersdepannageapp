import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import MatthieuLogsClient from './MatthieuLogsClient'

export const dynamic = 'force-dynamic'

export default async function AdminMatthieuPage() {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'superadmin') redirect('/dashboard')
  return <MatthieuLogsClient />
}
