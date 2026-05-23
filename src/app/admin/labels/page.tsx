// src/app/admin/labels/page.tsx
//
// Bibliotheque d etiquettes : grille de cards par template, modal d impression
// avec preview labelary + quantite + bouton imprimer.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import LabelsLibraryClient  from './LabelsLibraryClient'
import { LABEL_TEMPLATES }  from '@/lib/print/zpl-templates'

export const dynamic = 'force-dynamic'

export default async function LabelsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const isAdmin = ['admin', 'superadmin'].some(r => (user.roles || [user.role]).includes(r))
  if (!isAdmin) redirect('/dashboard?error=access_denied')

  // Snapshot des templates (donnees serialisables, sans la fonction build)
  const templates = LABEL_TEMPLATES.map(t => ({
    key:         t.key,
    name:        t.name,
    icon:        t.icon,
    category:    t.category,
    description: t.description,
    data_source: t.data_source,
  }))

  return <LabelsLibraryClient templates={templates} />
}
