// src/app/api/fourriere/saisies/[id]/justinvoice/route.ts
//
// Dépose la créance d'un état de frais accepté sur JustInvoice (logique partagée
// dans lib/justinvoice/deposit.ts — aussi utilisée par l'automate en mode Auto).
// Accès : admin / superadmin / module fourriere. Olivier 2026-08-10 / 2026-09-03.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { depositEtatFrais }  from '@/lib/justinvoice/deposit'

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
  const res = await depositEtatFrais(sb, params.id, efId)
  if (!res.ok) return NextResponse.json({ error: res.error, raw: res.raw }, { status: res.raw ? 502 : 400 })
  return NextResponse.json({ ok: true, ref: res.ref, numero: res.numero })
}
