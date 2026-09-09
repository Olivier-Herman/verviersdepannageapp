// src/app/chantiers/page.tsx
//
// Module « Chantiers » — le tableau des chantiers VD Soft : en cours, en
// attente, terminés, en sommeil. Superadmin uniquement. La page charge l'état
// côté serveur pour s'afficher pleine, puis le client le tient à jour.
// Olivier 09/09/2026 : « place-le-moi dans mon app, visibilité superadmin ».

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isSuperadminSession, type Chantier, type ChantierLog } from '@/lib/chantiers'
import AppShell              from '@/components/layout/AppShell'
import ChantiersClient       from './ChantiersClient'

export const dynamic = 'force-dynamic'

export default async function ChantiersPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!isSuperadminSession(session)) redirect('/dashboard?error=access_denied')
  const u = session.user as any

  const sb = createAdminClient()
  const [{ data: chantiers, error: dbErr }, { data: logs }] = await Promise.all([
    sb.from('chantiers').select('id, key, title, tag, status, note, position, created_at, updated_at, updated_by')
      .order('status').order('position').order('created_at'),
    sb.from('chantier_logs').select('id, chantier_id, at, actor, text').order('at', { ascending: false }).limit(40),
  ])

  return (
    <AppShell title="Chantiers" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={u.role || ''} userModules={u.modules || []}>
      <ChantiersClient initial={(chantiers || []) as Chantier[]} initialLogs={(logs || []) as ChantierLog[]}
        dbError={dbErr ? (/does not exist|schema cache/i.test(dbErr.message)
          ? 'La table des chantiers n\'existe pas encore : passe la migration 202609091900_chantiers.sql dans Supabase.'
          : dbErr.message) : null} />
    </AppShell>
  )
}
