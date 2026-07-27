// src/app/api/cron/auto-invoice/route.ts
//
// Facturation AUTOMATIQUE (cron roulant). Toutes les 30 min : scanne les missions
// clôturées (to_invoice) depuis > délai (défaut 2h), éligibles (règle source+type
// DSP/REM activée), SÈCHES (pas de parent ni d'enfant relivraison), pas encore
// facturées, et crée la facture brouillon Odoo si un VRAI tarif est présent.
//
// Idempotent (skip si odoo_quote_id/invoice_odoo_id déjà là) → jamais de doublon,
// pas de conflit avec la facturation manuelle. Olivier 2026-07-27.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getAutoInvoiceRules, getAutoInvoiceDelayHours, checkAutoInvoiceEligible } from '@/lib/facturation/auto-invoice'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

const BATCH = 25   // borne par passe (chaque facture = ~2-3s Odoo)

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()
  const rules = await getAutoInvoiceRules(sb)
  const delayH = await getAutoInvoiceDelayHours(sb)

  // Sources ayant AU MOINS une règle active (sinon rien à faire).
  const activeSources = Object.entries(rules).filter(([, r]) => r?.dsp || r?.rem).map(([s]) => s)
  if (activeSources.length === 0) {
    return NextResponse.json({ ok: true, delay_hours: delayH, invoiced: 0, note: 'aucune règle active' })
  }

  const cutoff = new Date(Date.now() - delayH * 3600_000).toISOString()

  // Missions clôturées depuis > délai, sources concernées, pas déjà facturées/devisées.
  const { data: candidates } = await sb.from('incoming_missions')
    .select('id, external_id, source, mission_type, parent_mission_id, completed_at, odoo_quote_id, invoice_odoo_id')
    .eq('status', 'to_invoice')
    .in('source', activeSources)
    .lt('completed_at', cutoff)
    .is('odoo_quote_id', null)
    .is('invoice_odoo_id', null)
    .order('completed_at', { ascending: true })
    .limit(200)

  let eligible = 0, invoiced = 0, noTariff = 0, combined = 0, failed = 0
  const done: string[] = []

  for (const m of (candidates || [])) {
    const check = checkAutoInvoiceEligible(m as any, rules)
    if (!check.eligible) continue
    eligible++
    // Mission sèche : aucune fiche enfant (relivraison).
    const { count: childCount } = await sb.from('incoming_missions')
      .select('id', { count: 'exact', head: true }).eq('parent_mission_id', m.id)
    if (childCount) { combined++; continue }
    if (invoiced >= BATCH) break

    try {
      const url = new URL(`/api/missions/${m.id}/quote`, req.url).toString()
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.NEXTAUTH_SECRET || '' },
        body: JSON.stringify({ mode: 'invoice', requireTariff: true }),
      })
      const j = await r.json().catch(() => ({}))
      if (j?.ok && j.invoice) { invoiced++; done.push(m.external_id || m.id.slice(0, 8)) }
      else if (j?.reason === 'no_tariff') noTariff++
      else failed++
    } catch { failed++ }
  }

  // Compteur de couverture : combien le système a dû facturer (Jona ne l'avait pas fait).
  const summary = { at: new Date().toISOString(), delay_hours: delayH, eligible, invoiced, noTariff, combined, failed, done: done.slice(0, 30) }
  await sb.from('app_settings').upsert({ key: 'auto_invoice_last_run', value: summary }, { onConflict: 'key' }).then(() => {}, () => {})
  console.log('[auto-invoice]', JSON.stringify(summary))

  return NextResponse.json({ ok: true, ...summary })
}
