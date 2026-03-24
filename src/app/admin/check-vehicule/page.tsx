import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { isAdminOrDispatcher } from '@/lib/auth'
import AdminCheckVehiculeClient from './AdminCheckVehiculeClient'

export default async function AdminCheckVehiculePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!isAdminOrDispatcher(session.user)) redirect('/dashboard')
  return <AdminCheckVehiculeClient />
}
