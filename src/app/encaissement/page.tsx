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

  // Prefill depuis mission (lien depuis DriverClient)
  const prefill = (searchParams?.prefill_mission_id) ? {
    mission_id: searchParams.prefill_mission_id,
    plate:      searchParams.prefill_plate      || '',
    brand:      searchParams.prefill_brand      || '',
    model:      searchParams.prefill_model      || '',
    amount:     searchParams.prefill_amount     ? parseFloat(searchParams.prefill_amount) : undefined,
    return_to:  searchParams.return_to          || '/mission',
  } : undefined

  return (
    <EncaissementClient
      motifs={motifs || []}
      paymentModes={paymentModes || []}
      prefill={prefill}
    />
  )
}
