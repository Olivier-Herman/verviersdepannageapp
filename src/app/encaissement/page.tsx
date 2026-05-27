// src/app/encaissement/page.tsx
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import EncaissementClient   from './EncaissementClient'

export default async function EncaissementPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()

  const [{ data: motifs }, { data: paymentModes }] = await Promise.all([
    supabase.from('list_items').select('value, label').eq('list_type', 'motif').eq('active', true).order('sort_order'),
    supabase.from('list_items').select('value, label').eq('list_type', 'payment_mode').eq('active', true).order('sort_order'),
  ])

  // Prefill : depuis mission (lien DriverClient) OU depuis fourriere
  // (bouton "Restituer" dans /recherche). Les deux peuvent co-exister.
  const hasMissionPrefill   = !!searchParams?.prefill_mission_id
  const hasFourrierePrefill = searchParams?.prefill_type === 'fourriere'

  const prefill = (hasMissionPrefill || hasFourrierePrefill) ? {
    mission_id:        searchParams?.prefill_mission_id,
    plate:             searchParams?.prefill_plate      || '',
    brand:             searchParams?.prefill_brand      || '',
    model:             searchParams?.prefill_model      || '',
    amount:            searchParams?.prefill_amount     ? parseFloat(searchParams.prefill_amount) : undefined,
    // Adresse + precision motif precomplets depuis la mission (Olivier 2026-05-26).
    // Evite que le chauffeur re-saisisse manuellement le lieu d intervention et
    // la description (ex: "Mal Garee 2JBY431 - Deplacement avec paiement").
    location:          searchParams?.prefill_location   || '',
    motif_precision:   searchParams?.prefill_motif_precision || '',
    // Olivier 2026-05-27 : label du motif a pre-selectionner (Fix H).
    // L UI essaye de matcher dans la liste motifs[] par label OU value.
    motif_label:       searchParams?.prefill_motif_label || '',
    return_to:         searchParams?.return_to          || (hasFourrierePrefill ? '/recherche' : '/mission'),
    // Fourriere
    type:              searchParams?.prefill_type as 'fourriere' | undefined,
    vehicle_id:        searchParams?.prefill_vehicle_id,
    ticket_id:         searchParams?.prefill_ticket_id,
    entry_date:        searchParams?.prefill_entry_date,
    days:              searchParams?.prefill_days ? parseInt(searchParams.prefill_days, 10) : undefined,
  } : undefined

  const sessionUser = session.user as any

  return (
    <EncaissementClient
      motifs={motifs || []}
      paymentModes={paymentModes || []}
      prefill={prefill}
      userRole={sessionUser.role || ''}
      userName={session.user.name || ''}
      userModules={sessionUser.modules || []}
    />
  )
}
