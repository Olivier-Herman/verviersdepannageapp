// src/app/api/cron/verify-invoices/route.ts
//
// Réconciliation AUTOMATIQUE (cron roulant, toutes les 30 min) : appelle
// « Vérification facturation Odoo » sans intervention. Toute fiche to_invoice
// dont la facture Odoo liée est POSTÉE passe en completed (sortie de la liste
// à facturer) → la liste se nettoie toute seule au fil des facturations
// (auto ou manuelles). Olivier 2026-07-27.

import { NextResponse } from 'next/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const url = new URL('/api/facturation/verify-invoices', req.url).toString()
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.NEXTAUTH_SECRET || '' },
      body: JSON.stringify({}),   // pas de mission_ids → réconcilie toutes les fiches liées
    })
    const j = await r.json().catch(() => ({}))
    return NextResponse.json({ ok: r.ok, ...j })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'échec' }, { status: 502 })
  }
}
