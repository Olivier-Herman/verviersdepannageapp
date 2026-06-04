// src/app/api/cron/sync-invoice-urls/route.ts
//
// Cron — pour les missions dont l'employe facturation a saisi un numero de
// facture mais dont l'URL Odoo n'a pas pu etre resolue synchrone (facture pas
// encore creee dans Odoo au moment de la validation), retente la resolution.
//
// Best effort : si toujours pas trouve, on laisse pour la prochaine execution.

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextResponse }            from 'next/server'
import { createAdminClient }       from '@/lib/supabase'
import { resolveInvoiceByNumber }  from '@/lib/odoo-invoice'

const BATCH_SIZE = 50

export async function GET(req: Request) {
  // Olivier 2026-06-03 (audit J-2 W2 KO) : auth Bearer CRON_SECRET.
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()

  const { data: rows, error } = await sb
    .from('incoming_missions')
    .select('id, invoice_number, external_id')
    .not('invoice_number', 'is', null)
    .is('invoice_url', null)
    .order('invoiced_at', { ascending: false, nullsFirst: false })
    .limit(BATCH_SIZE)

  if (error) {
    console.error('[cron sync-invoice-urls]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let resolved = 0
  let failed   = 0
  const errors: string[] = []

  for (const row of rows || []) {
    if (!row.invoice_number) continue
    try {
      const result = await resolveInvoiceByNumber(row.invoice_number)
      if (!result) { failed++; continue }
      const { error: upErr } = await sb
        .from('incoming_missions')
        .update({ invoice_odoo_id: result.id, invoice_url: result.url })
        .eq('id', row.id)
      if (upErr) {
        errors.push(`${row.external_id || row.id.slice(0,8)}: ${upErr.message}`)
        continue
      }
      resolved++
    } catch (e: any) {
      errors.push(`${row.external_id || row.id.slice(0,8)}: ${e.message}`)
    }
  }

  return NextResponse.json({
    ok:        true,
    scanned:   (rows || []).length,
    resolved,
    not_found: failed,
    errors:    errors.slice(0, 10),
  })
}
