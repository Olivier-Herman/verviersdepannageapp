// src/app/api/facturation/import-towsoft/route.ts
//
// POST /api/facturation/import-towsoft { towsoft_num }
//
// Olivier 2026-06-12 : importe une fiche TowSoft (uniquement presente chez
// TowSoft) dans VD Soft en statut 'to_invoice' pour pouvoir la facturer via
// la modale habituelle. Dedup par external_id TS-<num>.
//
// Acces : admin / superadmin / module facturation.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { importTowsoftForBilling } from '@/lib/towsoft/import-for-billing'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

function checkAccess(session: any): boolean {
  if (!session) return false
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  return ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!checkAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const towsoftNum = String(body.towsoft_num || '').trim()
  if (!towsoftNum) return NextResponse.json({ error: 'towsoft_num requis' }, { status: 400 })

  const result = await importTowsoftForBilling(towsoftNum)
  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Import échoué' }, { status: 502 })
  }
  return NextResponse.json(result)
}
