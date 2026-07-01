// src/app/api/fines/[id]/odoo-status/route.ts
//
// POST /api/fines/[id]/odoo-status
//   Rafraîchit le n° + statut de la facture fournisseur Odoo liée à l'amende
//   (brouillon → comptabilisée → payée). Accès : admin / superadmin / facturation.
//
// Olivier 2026-07-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { refreshFineOdooStatus } from '@/lib/fines/odoo-bill'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role || ''
  const modules: string[] = Array.isArray(user?.modules) ? user.modules : []
  if (!user || (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const res = await refreshFineOdooStatus(sb, params.id)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, odoo_move_name: res.move_name, odoo_move_status: res.status })
}
