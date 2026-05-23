// src/app/admin/labels/test-print/page.tsx
//
// UI admin pour tester le nouveau flow d impression ZPL en parallele du
// flow actuel, sans risque de casser la prod.
//
// Pour un ticket Odoo donne, permet de :
//   - Visualiser le ZPL compose cote VD Soft
//   - Voir le rendu PNG via labelary.com (sans imprimer)
//   - Lancer l impression via /print (ANCIEN flow, intact)
//   - Lancer l impression via /print-raw (NOUVEAU flow, ZPL compose VD Soft)
//   - Comparer les deux etiquettes physiques cote a cote
//
// Une fois validees identiques, on pourra basculer la prod sur le nouveau
// flow et supprimer la composition ZPL cote PC.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import TestPrintClient      from './TestPrintClient'

export const dynamic = 'force-dynamic'

export default async function TestPrintPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const isAdmin = ['admin', 'superadmin'].some(r => (user.roles || [user.role]).includes(r))
  if (!isAdmin) redirect('/dashboard?error=access_denied')

  return <TestPrintClient />
}
