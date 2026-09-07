// src/app/admin/diagnostics/page.tsx
//
// Diagnostics (superadmin) — Olivier 07/09/2026, inventaire du code débranché,
// point 26 : les outils de diagnostic existaient mais n'étaient joignables qu'en
// tapant leur URL à la main. Ici : un bouton par outil, le résultat en dessous.
// Rien de nouveau côté serveur, la page appelle les routes existantes.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import DiagnosticsClient    from './DiagnosticsClient'

export const dynamic = 'force-dynamic'

export default async function AdminDiagnosticsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const roles: string[] = Array.isArray(u.roles) ? u.roles : []
  if (u.role !== 'superadmin' && !roles.includes('superadmin')) redirect('/admin?error=access_denied')
  return <DiagnosticsClient />
}
