// src/app/admin/documents/page.tsx
export const dynamic = 'force-dynamic'

import { createAdminClient } from '@/lib/supabase'
import AdminDocumentsClient  from './AdminDocumentsClient'

export default async function AdminDocumentsPage() {
  const supabase = createAdminClient()

  // Tous les chauffeurs actifs
  const { data: drivers } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('active', true)
    .in('role', ['driver', 'admin', 'superadmin', 'dispatcher'])
    .order('name')

  // Tous les documents
  const { data: documents } = await supabase
    .from('driver_documents')
    .select('*, user:users(name, email)')
    .order('expires_at', { ascending: true })

  return (
    <AdminDocumentsClient
      drivers={drivers || []}
      documents={documents || []}
    />
  )
}
