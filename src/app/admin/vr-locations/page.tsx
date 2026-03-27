// src/app/admin/vr-locations/page.tsx
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import VrLocationsClient     from './VrLocationsClient'

export const dynamic = 'force-dynamic'

export default async function VrLocationsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const supabase = createAdminClient()
  const { data } = await supabase.from('vr_locations').select('*').order('sort_order')
  return <VrLocationsClient initialData={data || []} />
}
