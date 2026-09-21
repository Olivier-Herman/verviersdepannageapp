// src/app/api/cron/facturation-paiements/route.ts
//
// Facturation — temps 3 « Le paiement » (Olivier 16-21/09/2026). Toutes les
// 2 h : (1) lit dans Odoo le statut « payée » des factures liées aux fiches
// et pose paid_at (le dossier passe « Terminé » sans clic) ; (2) relance le
// client facturé à J+15 puis J+30 après l'échéance (seulement si le réglage
// « relance_facture_mode » vaut « on »). Logique dans lib/facturation/paiements.ts.
// Trace du dernier passage dans app_settings (facturation_paiements_last_run)
// pour qu'un cron muet se voie à l'écran.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { syncInvoicePayments, sendInvoiceReminders } from '@/lib/facturation/paiements'

export const dynamic     = 'force-dynamic'
export const fetchCache  = 'force-no-store'   // jamais de snapshot Data Cache sur les lectures PostgREST (même piège que verify-invoices)
export const maxDuration = 120

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  const summary: any = { at: new Date().toISOString(), ok: true }
  try {
    summary.payments = await syncInvoicePayments(sb)
  } catch (e: any) { summary.ok = false; summary.payments_error = e?.message || String(e) }
  try {
    summary.reminders = await sendInvoiceReminders(sb)
  } catch (e: any) { summary.ok = false; summary.reminders_error = e?.message || String(e) }
  // app_settings.value est du TEXTE : toujours sérialisé, toujours JSON.parse à la lecture.
  try { await sb.from('app_settings').upsert({ key: 'facturation_paiements_last_run', value: JSON.stringify(summary), updated_at: summary.at }, { onConflict: 'key' }) } catch { /* best-effort */ }
  return NextResponse.json(summary, { status: summary.ok ? 200 : 502 })
}
