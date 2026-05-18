// src/app/v/[id]/page.tsx
// Fiche fourriere mobile, accedee depuis le QR code colle sur le vehicule.
// Format URL : /v/{helpdesk_ticket_id}
//
// Accessible aux users authentifies avec permission "fourriere" (ou admin/
// superadmin). Pas de PIN comme dans Verviers-QR : permissions module a la
// place.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import VehicleFourriereClient from './VehicleFourriereClient'

export const dynamic = 'force-dynamic'

export default async function VehicleFourrierePage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(`/v/${params.id}`)}`)

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) redirect('/dashboard?error=fourriere_required')

  return (
    <VehicleFourriereClient
      ticketId={params.id}
      userName={user.name || ''}
      userEmail={user.email || ''}
    />
  )
}
