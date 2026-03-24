import { getServerSession } from 'next-auth'
import { authOptions, isAdmin } from '@/lib/auth'
import { redirect } from 'next/navigation'
import CheckVehiculeSettingsClient from './CheckVehiculeSettingsClient'

export default async function CheckVehiculeSettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!isAdmin(session.user)) redirect('/dashboard')
  return <CheckVehiculeSettingsClient />
}
