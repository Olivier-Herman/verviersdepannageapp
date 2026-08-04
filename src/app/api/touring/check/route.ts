// src/app/api/touring/check/route.ts
//
// Module « Check Touring » (superadmin). Liste des dossiers Touring hors comex à
// faire trancher, rafraîchissement (rapprochement auto + reconstruction), et
// application des réponses de Touring (semi-validation).

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { buildTouringCheckList } from '@/lib/touring/check-list'
import { reconcileHorsComexWithAccords } from '@/lib/touring/accord-reconcile'
import { applyCheckItem } from '@/lib/touring/check-apply'
import { persistCheckList, bumpCheckSignal } from '@/lib/touring/check-persist'
import { getCheckToken, rotateCheckToken, getCheckEmail, checkLink } from '@/lib/touring/check-config'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function superadmin() {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!user || user.role !== 'superadmin') return null
  return user
}

export async function GET() {
  if (!(await superadmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const [{ data: rows }, token, email] = await Promise.all([
    sb.from('touring_check_dossiers').select('*').neq('status', 'dismissed').order('intervention_date', { ascending: false }),
    getCheckToken(sb),
    getCheckEmail(sb),
  ])
  const items = rows || []
  const counts = {
    total:    items.length,
    pending:  items.filter((r: any) => r.status === 'pending').length,
    answered: items.filter((r: any) => r.status === 'answered').length,
    applied:  items.filter((r: any) => r.status === 'applied').length,
  }
  return NextResponse.json({ items, counts, link: checkLink(token), email })
}

export async function POST(req: Request) {
  const user = await superadmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const action = body?.action

  if (action === 'refresh') {
    const reconcile = await reconcileHorsComexWithAccords(sb, user.id)
    const items = await buildTouringCheckList(sb)
    await persistCheckList(sb, items)
    return NextResponse.json({ ok: true, reconcile: { scanned: reconcile.scanned, reconciled: reconcile.reconciled }, count: items.length })
  }

  if (action === 'reconcile') {
    const reconcile = await reconcileHorsComexWithAccords(sb, user.id)
    return NextResponse.json({ ok: true, reconcile })
  }

  if (action === 'apply') {
    const id = String(body?.id || '')
    const { data: item } = await sb.from('touring_check_dossiers').select('*').eq('id', id).maybeSingle()
    if (!item) return NextResponse.json({ error: 'introuvable' }, { status: 404 })
    if (item.status !== 'answered') return NextResponse.json({ error: 'aucune réponse à appliquer' }, { status: 409 })
    const outcome = await applyCheckItem(sb, item, user.id)
    await sb.from('touring_check_dossiers').update({
      status: outcome.ok ? 'applied' : 'answered',
      applied_at: outcome.ok ? new Date().toISOString() : null,
      applied_by: outcome.ok ? user.id : null,
      applied_result: outcome.result,
    }).eq('id', id)
    await bumpCheckSignal(sb, 'applied')
    return NextResponse.json({ ok: outcome.ok, result: outcome.result })
  }

  if (action === 'dismiss') {
    const id = String(body?.id || '')
    await sb.from('touring_check_dossiers').update({ status: 'dismissed' }).eq('id', id)
    await bumpCheckSignal(sb, 'dismissed')
    return NextResponse.json({ ok: true })
  }

  if (action === 'rotate') {
    const token = await rotateCheckToken(sb)
    return NextResponse.json({ ok: true, link: checkLink(token) })
  }

  return NextResponse.json({ error: 'action inconnue' }, { status: 400 })
}
