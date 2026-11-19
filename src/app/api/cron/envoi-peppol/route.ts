// src/app/api/cron/envoi-peppol/route.ts — chaque nuit : fiches clients inscrites sur Peppol réglées « par Peppol »
// (Olivier 19/11/2026, voir src/lib/facturation/peppol-envoi.ts). Un échec doit se voir.

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { aligneEnvoiPeppol } from '@/lib/facturation/peppol-envoi'

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const detail = await aligneEnvoiPeppol()
    return NextResponse.json({ ok: true, corriges: detail.reduce((n, d) => n + d.corriges.length, 0), detail })
  } catch (e: any) {
    console.error('[cron envoi-peppol]', e?.message || e)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
