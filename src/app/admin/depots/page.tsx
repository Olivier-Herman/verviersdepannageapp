// src/app/admin/depots/page.tsx
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import DepotsAdminClient     from './DepotsAdminClient'

export const dynamic = 'force-dynamic'

export default async function DepotsAdminPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()
  const { data: depots } = await supabase
    .from('depots')
    .select('*')
    .order('sort_order')

  // Olivier 2026-06-02 PM : passer la cle Google explicitement pour charger
  // l autocomplete Places. Sans ca le champ adresse n a pas la recherche.
  const googleMapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''

  return <DepotsAdminClient initialDepots={depots || []} googleMapsKey={googleMapsKey} />
}
