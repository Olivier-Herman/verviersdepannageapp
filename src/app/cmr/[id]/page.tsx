// src/app/cmr/[id]/page.tsx
//
// Impression CMR (lettre de voiture) en SURIMPRESSION sur la liasse pré-imprimée.
// On n'imprime QUE les données, positionnées aux bonnes cases. Le dispatcher met
// sa liasse CMR vierge (4 feuillets) dans l'imprimante et imprime en 4 exemplaires.
// Olivier 2026-07-07.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import CmrPrintClient        from './CmrPrintClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

function joinNonEmpty(parts: (string | null | undefined)[], sep = ' '): string {
  return parts.map(p => (p || '').trim()).filter(Boolean).join(sep)
}

export default async function CmrPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const hasAccess = ['admin', 'superadmin', 'dispatcher'].some(r => (user.roles || [user.role]).includes(r))
    || (user.modules || []).includes('fourriere') || (user.modules || []).includes('facturation')
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const isNum = /^\d+$/.test(params.id)
  const { data: m } = isNum
    ? await sb.from('incoming_missions').select('*').eq('mission_number', Number(params.id)).single()
    : await sb.from('incoming_missions').select('*').eq('id', params.id).single()
  if (!m) redirect('/dispatch')

  const mm: any = m
  // Mapping des cases CMR (validé Olivier 2026-07-07).
  const fields = {
    // 1 · Expéditeur = client facturé
    expediteur:    joinNonEmpty([mm.billed_to_name || mm.client_name], '\n'),
    // 2 · Destinataire = adresse de destination
    destinataire:  joinNonEmpty([mm.destination_name, mm.destination_address || mm.redelivery_address], '\n'),
    // 3 · Prise en charge = adresse de chargement (lieu d'intervention)
    priseEnCharge: joinNonEmpty([mm.incident_address, mm.incident_city], ', '),
    // 4 · Livraison = adresse de destination
    livraison:     joinNonEmpty([mm.destination_name, mm.destination_address || mm.redelivery_address], '\n'),
    // 10 · Marchandises = véhicule transporté
    marchandises:  joinNonEmpty([
      joinNonEmpty([mm.vehicle_brand, mm.vehicle_model]),
      mm.vehicle_plate ? `Immat. ${mm.vehicle_plate}` : '',
      mm.vehicle_vin ? `VIN ${mm.vehicle_vin}` : '',
    ], '\n'),
    // 12 · Lieu et date d'établissement
    lieuDate:      'Pepinster, le',
    dossier:       joinNonEmpty([mm.dossier_number || mm.external_id]),
  }

  const label = `#${mm.mission_number ?? ''} · ${joinNonEmpty([mm.vehicle_brand, mm.vehicle_model, mm.vehicle_plate])}`

  return <CmrPrintClient fields={fields} label={label} />
}
