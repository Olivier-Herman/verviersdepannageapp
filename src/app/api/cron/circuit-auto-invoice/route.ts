// src/app/api/cron/circuit-auto-invoice/route.ts
//
// Facture 100% auto les devis Circuit dont TOUTES les prestations sont passées
// (prestation_date < aujourd'hui) et non encore facturées. Crée + comptabilise +
// envoie la facture Odoo (invoiceCircuitOrder), puis marque les prestations.
//
// GET (CRON_SECRET). ?order_id=<id> pour ne traiter qu'UN devis (validation).
// Olivier 2026-07-29.

import { NextResponse }        from 'next/server'
import { createAdminClient }   from '@/lib/supabase'
import { invoiceCircuitOrder } from '@/lib/circuit/invoice'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const onlyOrder = Number(new URL(req.url).searchParams.get('order_id')) || null
  const sb = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  // Prestations non facturées, avec devis Odoo.
  const { data: rows } = await sb.from('circuit_prestations')
    .select('id, prestation_date, odoo_sale_order_id, odoo_sale_order_name, invoiced_at')
    .is('invoiced_at', null)
    .not('odoo_sale_order_id', 'is', null)
    .limit(2000)

  // Regroupe par devis ; éligible si TOUTES ses prestations sont passées.
  const byOrder = new Map<number, { name: string | null; ids: string[]; allPast: boolean }>()
  for (const r of (rows || [])) {
    const oid = Number(r.odoo_sale_order_id)
    if (!byOrder.has(oid)) byOrder.set(oid, { name: r.odoo_sale_order_name, ids: [], allPast: true })
    const g = byOrder.get(oid)!
    g.ids.push(r.id)
    if (!(r.prestation_date < today)) g.allPast = false
  }

  const eligible = [...byOrder.entries()].filter(([oid, g]) => g.allPast && (!onlyOrder || oid === onlyOrder))

  const details: any[] = []
  let invoiced = 0, failed = 0
  const now = new Date().toISOString()

  for (const [oid, g] of eligible) {
    const res = await invoiceCircuitOrder(oid)
    if (res.ok) {
      invoiced++
      // Marque toutes les prestations de ce devis comme facturées.
      await sb.from('circuit_prestations').update({
        invoiced_at: now, invoice_number: res.invoiceNumber || null, updated_at: now,
      }).eq('odoo_sale_order_id', oid).is('invoiced_at', null)
      details.push({ order: g.name || oid, invoice: res.invoiceNumber, posted: res.posted })
    } else {
      failed++
      details.push({ order: g.name || oid, error: res.error })
    }
  }

  const summary = { at: now, today, eligible: eligible.length, invoiced, failed, details: details.slice(0, 40) }
  await sb.from('app_settings').upsert({ key: 'circuit_auto_invoice_last_run', value: summary }, { onConflict: 'key' }).then(() => {}, () => {})
  console.log('[circuit-auto-invoice]', JSON.stringify({ eligible: eligible.length, invoiced, failed }))
  return NextResponse.json({ ok: true, ...summary })
}
