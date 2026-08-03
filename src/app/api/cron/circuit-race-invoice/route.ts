// src/app/api/cron/circuit-race-invoice/route.ts
//
// Auto-facturation des week-ends de course : dès que le DERNIER jour + 3 est
// passé (délai pour ajouter un supplément), on CONFIRME le devis puis on FACTURE.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc } from '@/lib/odoo'
import { invoiceCircuitOrder } from '@/lib/circuit/invoice'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 120

const DELAI_JOURS = 3

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  const today = new Date(); today.setHours(0, 0, 0, 0)

  const { data: rows } = await sb.from('circuit_race_weekends')
    .select('id, label, days, odoo_sale_order_id, invoiced_at')
    .is('invoiced_at', null).not('odoo_sale_order_id', 'is', null)

  const eligible = (rows || []).filter((w: any) => {
    const dates = (w.days || []).map((d: any) => d.date).filter(Boolean).sort()
    if (!dates.length) return false
    const last = new Date(dates[dates.length - 1] + 'T00:00:00')
    const due = new Date(last); due.setDate(due.getDate() + DELAI_JOURS)
    return due <= today
  })

  let invoiced = 0, failed = 0
  const details: any[] = []
  for (const w of eligible) {
    try {
      const st = (await odooRpc<any[]>('sale.order', 'read', [[w.odoo_sale_order_id]], { fields: ['state'] }))?.[0]?.state
      if (st === 'draft' || st === 'sent') await odooRpc('sale.order', 'action_confirm', [[w.odoo_sale_order_id]])
      const res = await invoiceCircuitOrder(w.odoo_sale_order_id)
      if (!res.ok) { failed++; details.push({ id: w.id, label: w.label, error: res.error }); continue }
      await sb.from('circuit_race_weekends').update({ invoiced_at: new Date().toISOString() }).eq('id', w.id)
      invoiced++; details.push({ id: w.id, label: w.label, invoice: res.invoiceNumber })
    } catch (e: any) { failed++; details.push({ id: w.id, label: w.label, error: String(e?.message || e).slice(0, 200) }) }
  }

  return NextResponse.json({ ok: true, eligible: eligible.length, invoiced, failed, details })
}
