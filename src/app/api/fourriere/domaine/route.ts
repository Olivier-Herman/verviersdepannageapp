// src/app/api/fourriere/domaine/route.ts
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD → tableau Domaine (jours facturables État).
// Accès : admin / superadmin / module fourriere.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { computeDomaineBilling } from '@/lib/fourriere/domaine-billing'
import { pollVenteEpaves } from '@/lib/domaine/vente-epaves-intake'
import { createDomaineQuarterInvoice } from '@/lib/domaine/invoice-vente-epaves'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  const role = u.role || ''
  const modules: string[] = u.modules || []
  return ['admin', 'superadmin'].includes(role) || modules.includes('fourriere')
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const from = (searchParams.get('from') || '').slice(0, 10)
  const to   = (searchParams.get('to')   || '').slice(0, 10)
  if (!from || !to) return NextResponse.json({ error: 'Période (from/to) requise' }, { status: 400 })

  const sb = createAdminClient()
  const result = await computeDomaineBilling(sb, from, to)
  return NextResponse.json({ ok: true, ...result })
}

// POST { action:'sync' }            → capture les mails « Vente d'épaves »
//      { action:'invoice', from,to,ref? } → facture le trimestre (superadmin)
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const u = session!.user as any
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  if (action === 'sync') {
    const summary = await pollVenteEpaves()
    return NextResponse.json({ ok: true, summary })
  }

  if (action === 'invoice') {
    if (u.role !== 'superadmin') return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })
    const from = String(body.from || '').slice(0, 10)
    const to   = String(body.to   || '').slice(0, 10)
    if (!from || !to) return NextResponse.json({ error: 'Période (from/to) requise' }, { status: 400 })
    const res = await createDomaineQuarterInvoice({ from, to, ref: body.ref || null, actorUserId: u.id })
    if (!res.ok) return NextResponse.json({ error: res.error || 'Échec facturation' }, { status: 400 })
    return NextResponse.json(res)
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
