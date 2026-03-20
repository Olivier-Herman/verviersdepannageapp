import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import EncaissementClient from './EncaissementClient'

export default async function EncaissementPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()

  const [{ data: motifs }, { data: paymentModes }] = await Promise.all([
    supabase.from('list_items').select('value, label').eq('list_type', 'motif').eq('active', true).order('sort_order'),
    supabase.from('list_items').select('value, label').eq('list_type', 'payment_mode').eq('active', true).order('sort_order'),
  ])

  return (
    <EncaissementClient
      motifs={motifs || []}
      paymentModes={paymentModes || []}
    />
  )
}
