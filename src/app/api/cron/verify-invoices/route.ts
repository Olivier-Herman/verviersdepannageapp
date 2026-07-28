// src/app/api/cron/verify-invoices/route.ts
//
// Réconciliation AUTOMATIQUE (cron roulant, toutes les 30 min) : appelle
// « Vérification facturation Odoo » sans intervention. Toute fiche to_invoice
// dont la facture Odoo liée est POSTÉE passe en completed (sortie de la liste
// à facturer) → la liste se nettoie toute seule au fil des facturations
// (auto ou manuelles). Olivier 2026-07-27.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Base URL STABLE : en cron Vercel, req.url ne pointe pas vers l'URL publique
  // utilisable → le self-fetch échouait. Même correctif que auto-invoice.
  const baseUrl = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
  const url = `${baseUrl}/api/facturation/verify-invoices`

  const summary: any = { at: new Date().toISOString() }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.NEXTAUTH_SECRET || '' },
      body: JSON.stringify({}),   // pas de mission_ids → réconcilie toutes les fiches liées
    })
    const j = await r.json().catch(() => ({}))
    summary.ok = r.ok
    summary.http = r.status
    summary.result = j?.summary || null            // { completed, draft, none }
    summary.completed_refs = (j?.completed || []).slice(0, 30).map((x: any) => x.number || x.ref)
    // Trace (diagnostic) : prouve que le cron PLANIFIÉ tourne + ce qu'il fait.
    try {
      const sb = createAdminClient()
      await sb.from('app_settings').upsert({ key: 'verify_invoices_last_run', value: summary }, { onConflict: 'key' })
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: r.ok, ...j })
  } catch (e: any) {
    summary.ok = false
    summary.error = e?.message || 'échec'
    try { const sb = createAdminClient(); await sb.from('app_settings').upsert({ key: 'verify_invoices_last_run', value: summary }, { onConflict: 'key' }) } catch {}
    return NextResponse.json({ ok: false, error: e?.message || 'échec' }, { status: 502 })
  }
}
