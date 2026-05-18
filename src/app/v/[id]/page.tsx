// src/app/v/[id]/page.tsx
// Fiche fourriere mobile, accedee depuis le QR code colle sur le vehicule.
// Format URL : /v/{helpdesk_ticket_id}
//
// Autorisation :
//  - Lecture (page + GET /api/helpdesk/[id]) : tout user authentifie. Permet
//    a n importe quel chauffeur de scanner et consulter les infos.
//  - Actions (transfert / Domaine / Scratch / impression) : reservees aux
//    users avec le module "fourriere" actif (ou admin / superadmin). Les
//    boutons sont masques cote UI pour les autres + les endpoints POST
//    refusent eux-memes en cas d acces direct (defense in depth).

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
  const canEdit =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')

  return (
    <VehicleFourriereClient
      ticketId={params.id}
      userName={user.name || ''}
      userEmail={user.email || ''}
      canEdit={canEdit}
    />
  )
}
