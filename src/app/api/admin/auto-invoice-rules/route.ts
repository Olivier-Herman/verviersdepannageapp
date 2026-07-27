// src/app/api/admin/auto-invoice-rules/route.ts
//
// GET  → { rules, sources } : règles de facturation auto + liste des sources.
// POST → { source, type: 'dsp'|'rem', enabled } : bascule une règle.
// Réservé admin / superadmin. Olivier 2026-07-27.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { getAutoInvoiceRules, setAutoInvoiceRules, getAutoInvoiceDelayHours, setAutoInvoiceDelayHours, AUTO_INVOICE_TYPES } from '@/lib/facturation/auto-invoice'

export const dynamic = 'force-dynamic'

function isAdmin(session: any) {
  // Superadmin uniquement (facturation auto = réglage sensible).
  return (session?.user as any)?.role === 'superadmin'
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const rules = await getAutoInvoiceRules(sb)
  const delayHours = await getAutoInvoiceDelayHours(sb)
  const { data: catalog } = await sb.from('mission_source_catalog')
    .select('key, label, active').order('label')
  const sources = (catalog || [])
    .filter((c: any) => c.active !== false)
    .map((c: any) => ({ key: c.key, label: c.label || c.key }))
  return NextResponse.json({ rules, sources, delayHours })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const sb = createAdminClient()

  // Réglage du délai (heures après clôture).
  if (body?.delayHours != null) {
    const h = Number(body.delayHours)
    if (!Number.isFinite(h) || h < 0 || h > 72) return NextResponse.json({ error: 'délai 0-72h' }, { status: 400 })
    await setAutoInvoiceDelayHours(sb, h)
    return NextResponse.json({ ok: true, delayHours: h })
  }

  const source  = String(body?.source || '')
  const type    = AUTO_INVOICE_TYPES.some(t => t.key === body?.type) ? body.type : null
  const enabled = !!body?.enabled
  if (!source || !type) return NextResponse.json({ error: 'source + type valide requis' }, { status: 400 })

  const rules = await getAutoInvoiceRules(sb)
  rules[source] = { ...(rules[source] || {}), [type]: enabled }
  await setAutoInvoiceRules(sb, rules)
  return NextResponse.json({ ok: true, rules })
}
