// src/app/api/fourriere/saisies/[id]/facture-odoo/route.ts
//
// Crée la facture Odoo (brouillon) du dossier saisie depuis le dernier état de
// frais. L'employé la poste ensuite dans Odoo. Accès : admin/superadmin/fourriere.
// Olivier 2026-08-10.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { createSaisieParquetInvoice } from '@/lib/missions/saisie-odoo-invoice'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const efId = (await req.json().catch(() => ({})))?.ef_id || null
  const res = await createSaisieParquetInvoice(sb, params.id, efId)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, odooId: res.odooId, url: res.url })
}
